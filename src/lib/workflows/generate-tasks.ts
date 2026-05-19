import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAiEvent } from "@/lib/audit";

/**
 * Sky Light / Rwasem auto-task generation.
 *
 * For each service attached to the project we expand its task_templates →
 * task_template_items into concrete tasks. Each task gets:
 *
 *   - planned_date  — derived from project.start_date + offsets per the manual.
 *                     This is the contract-bound deadline (must hit 100%).
 *   - due_date      — kept identical to planned_date for legacy callers.
 *   - stage         — defaults to "new" (the trigger seeds task_stage_history).
 *   - role_slots    — every distinct role referenced by the template item's
 *       stage_owner_positions is resolved to an employee from the org chart
 *       and written to task_assignees, so each phase has a real responsible:
 *         account_manager  ← project's account_manager_employee_id
 *         specialist       ← service.default_specialist_employee_id, or
 *                            the head of service.default_department_id
 *         manager          ← head of service.default_department_id
 *       (agent / supporting_* have no single org-chart position — they are
 *        left for manual assignment.)
 *
 * Returns the number of tasks created.
 */
export async function generateTasksForProjectFromServices(args: {
  organizationId: string;
  projectId: string;
  serviceIds: string[];
  projectStartDate: string | null;
  accountManagerEmployeeId?: string | null;
  createdByUserId?: string | null;
}) {
  if (args.serviceIds.length === 0) return 0;

  // Fetch services with their default-specialist resolution path.
  const { data: services } = await supabaseAdmin
    .from("services")
    .select(
      `id, default_specialist_employee_id,
       default_department:departments!services_default_department_id_fkey ( head_employee_id )`,
    )
    .eq("organization_id", args.organizationId)
    .in("id", args.serviceIds);

  // Per-service org-chart resolution:
  //   specialist  → explicit service specialist, else the department head.
  //   manager     → the head of the service's department.
  const specialistByServiceId = new Map<string, string>();
  const deptHeadByServiceId = new Map<string, string>();
  for (const s of services ?? []) {
    const dept = Array.isArray(s.default_department)
      ? s.default_department[0]
      : s.default_department;
    const specialist =
      s.default_specialist_employee_id ??
      dept?.head_employee_id ??
      null;
    if (specialist) specialistByServiceId.set(s.id, specialist);
    if (dept?.head_employee_id) {
      deptHeadByServiceId.set(s.id, dept.head_employee_id);
    }
  }

  // Pull templates + items for those services.
  const { data: templates } = await supabaseAdmin
    .from("task_templates")
    .select(
      `id, service_id,
       task_template_items (
         id, title, description, default_department_id, default_role_key,
         offset_days_from_project_start, duration_days, priority,
         upload_offset_days_before_deadline, week_index,
         stage_owner_positions
       )`,
    )
    .eq("organization_id", args.organizationId)
    .in("service_id", args.serviceIds)
    .eq("is_active", true);
  if (!templates || templates.length === 0) return 0;

  const start = args.projectStartDate
    ? new Date(args.projectStartDate)
    : new Date();

  // Build the task-insert payload. created_from_template_item_id is preserved
  // so we can later attribute generated tasks back to the rule that produced them.
  type Row = {
    organization_id: string;
    project_id: string;
    service_id: string;
    title: string;
    description: string | null;
    priority: string;
    due_date: string;
    planned_date: string;
    created_from_template_item_id: string;
    created_by: string | null;
    status: "todo";
    stage_owner_positions: Record<string, string | null> | null;
    template_service_id: string; // local field to attribute slot during fan-out
  };

  const rows: Row[] = templates.flatMap((tmpl) =>
    (tmpl.task_template_items ?? []).map((item) => {
      const due = new Date(start);
      due.setDate(
        due.getDate() +
          (item.offset_days_from_project_start ?? 0) +
          (item.duration_days ?? 1),
      );
      const dateStr = due.toISOString().slice(0, 10);
      return {
        organization_id: args.organizationId,
        project_id: args.projectId,
        service_id: tmpl.service_id,
        title: item.title,
        description: item.description,
        priority: item.priority ?? "medium",
        due_date: dateStr,
        planned_date: dateStr,
        created_from_template_item_id: item.id,
        created_by: args.createdByUserId ?? null,
        status: "todo" as const,
        // Carry the template item's per-stage position mapping onto the
        // generated task so the task page can show "owner of current stage"
        // by resolving position → assignee at render time.
        stage_owner_positions:
          (item as { stage_owner_positions?: Record<string, string | null> })
            .stage_owner_positions ?? null,
        template_service_id: tmpl.service_id,
      };
    }),
  );
  if (rows.length === 0) return 0;

  // Insert tasks (strip the local-only field).
  const insertPayload = rows.map(({ template_service_id: _drop, ...row }) => row);
  const { data: inserted, error } = await supabaseAdmin
    .from("tasks")
    .insert(insertPayload)
    .select("id, service_id, stage_owner_positions");
  if (error) {
    console.error("[generateTasks_failed]", error.message);
    return 0;
  }

  // Build role-slot assignments. For each task we resolve every role its
  // stage_owner_positions references (plus specialist + account_manager so
  // the prior behaviour never regresses) to a real employee via the org
  // chart, then write one task_assignees row per resolved role. The
  // task_current_stage_owner view then resolves each phase → that employee.
  type ResolvableRole = "account_manager" | "specialist" | "manager";
  type SlotRow = {
    organization_id: string;
    task_id: string;
    employee_id: string;
    role_type: ResolvableRole;
    assigned_by: string | null;
  };
  // agent / supporting_lead / supporting_agent have no single org-chart
  // position, so they resolve to null and stay unassigned.
  const resolveRole = (
    role: string,
    serviceId: string | null,
  ): string | null => {
    if (role === "account_manager") return args.accountManagerEmployeeId ?? null;
    if (role === "specialist") {
      return serviceId ? specialistByServiceId.get(serviceId) ?? null : null;
    }
    if (role === "manager") {
      return serviceId ? deptHeadByServiceId.get(serviceId) ?? null : null;
    }
    return null;
  };
  const slotRows: SlotRow[] = [];
  for (const t of inserted ?? []) {
    // specialist + account_manager are always considered (legacy behaviour);
    // any extra roles come from the template item's per-phase mapping.
    const roles = new Set<string>(["account_manager", "specialist"]);
    const sop = (t as { stage_owner_positions?: Record<string, string | null> | null })
      .stage_owner_positions;
    if (sop) {
      for (const v of Object.values(sop)) if (v) roles.add(v);
    }
    for (const role of roles) {
      const employeeId = resolveRole(role, t.service_id);
      if (!employeeId) continue;
      slotRows.push({
        organization_id: args.organizationId,
        task_id: t.id,
        employee_id: employeeId,
        role_type: role as ResolvableRole,
        assigned_by: args.createdByUserId ?? null,
      });
    }
  }
  if (slotRows.length > 0) {
    const { error: slotErr } = await supabaseAdmin
      .from("task_assignees")
      .insert(slotRows);
    if (slotErr) {
      console.error("[generateTasks_slots_failed]", slotErr.message);
      // Slots are best-effort; don't fail the whole generation.
    }
  }

  // One ai_event per task created.
  await Promise.all(
    (inserted ?? []).map((t) =>
      logAiEvent({
        organizationId: args.organizationId,
        actorUserId: args.createdByUserId ?? null,
        eventType: "TASK_CREATED",
        entityType: "task",
        entityId: t.id,
        payload: { project_id: args.projectId, source: "template_generation" },
      }),
    ),
  );

  return inserted?.length ?? 0;
}
