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
 *   - role_slots    —
 *       account_manager  ← project's account_manager_employee_id (if any)
 *       specialist       ← service.default_specialist_employee_id, or
 *                          the head of service.default_department_id
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

  const specialistByServiceId = new Map<string, string>();
  for (const s of services ?? []) {
    const dept = Array.isArray(s.default_department)
      ? s.default_department[0]
      : s.default_department;
    const specialist =
      s.default_specialist_employee_id ??
      dept?.head_employee_id ??
      null;
    if (specialist) specialistByServiceId.set(s.id, specialist);
  }

  // Pull templates + items for those services.
  const { data: templates } = await supabaseAdmin
    .from("task_templates")
    .select(
      `id, service_id,
       task_template_items (
         id, title, description, default_department_id, default_role_key,
         offset_days_from_project_start, duration_days, priority,
         upload_offset_days_before_deadline, week_index
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
    .select("id, service_id");
  if (error) {
    console.error("[generateTasks_failed]", error.message);
    return 0;
  }

  // Build role-slot assignments.
  // - Account Manager: from project.account_manager_employee_id (one value, applied to every task).
  // - Specialist: per-service default (resolved above).
  type SlotRow = {
    organization_id: string;
    task_id: string;
    employee_id: string;
    role_type: "account_manager" | "specialist";
    assigned_by: string | null;
  };
  const slotRows: SlotRow[] = [];
  for (const t of inserted ?? []) {
    if (args.accountManagerEmployeeId) {
      slotRows.push({
        organization_id: args.organizationId,
        task_id: t.id,
        employee_id: args.accountManagerEmployeeId,
        role_type: "account_manager",
        assigned_by: args.createdByUserId ?? null,
      });
    }
    if (t.service_id) {
      const specialistId = specialistByServiceId.get(t.service_id);
      if (specialistId) {
        slotRows.push({
          organization_id: args.organizationId,
          task_id: t.id,
          employee_id: specialistId,
          role_type: "specialist",
          assigned_by: args.createdByUserId ?? null,
        });
      }
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
