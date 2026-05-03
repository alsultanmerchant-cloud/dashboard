import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAiEvent } from "@/lib/audit";
import { expandTemplates, type TemplateInput } from "./offsets";
import { listTemplatesForServices } from "@/lib/data/service-categories";

/**
 * T4 task generator. Reads task_templates (+ items) for the selected
 * services/categories, applies the offset engine in src/lib/projects/offsets.ts
 * (week_split aware), then inserts tasks + role-slot assignments.
 *
 * Returns the count of tasks inserted. On any failure mid-flight returns the
 * partial count plus an error message so the caller can decide to surface it.
 */
export async function generateTasksFromCategories(args: {
  organizationId: string;
  projectId: string;
  serviceSelections: {
    serviceId: string;
    weekSplit?: boolean;
    weeks?: number | null;
    /** Optional category filter — if set, only templates with this category. */
    categoryId?: string | null;
  }[];
  projectStartDate: string | null;
  accountManagerEmployeeId?: string | null;
  createdByUserId?: string | null;
}): Promise<{ count: number; error?: string }> {
  if (args.serviceSelections.length === 0) return { count: 0 };

  const start = args.projectStartDate ?? new Date().toISOString().slice(0, 10);
  const serviceIds = Array.from(new Set(args.serviceSelections.map((s) => s.serviceId)));
  const templates = await listTemplatesForServices(args.organizationId, serviceIds);
  if (templates.length === 0) return { count: 0 };

  // Build per-template ExpandInput, picking up the week_split flag from the
  // matching service selection. When a category filter is set, drop templates
  // whose category_id doesn't match.
  const expandInputs = templates
    .filter((t) => {
      const sel = args.serviceSelections.find((s) => s.serviceId === t.service_id);
      if (!sel) return false;
      if (sel.categoryId && t.category_id && sel.categoryId !== t.category_id) return false;
      return true;
    })
    .map((t) => {
      const sel = args.serviceSelections.find((s) => s.serviceId === t.service_id)!;
      const tmplInput: TemplateInput = {
        id: t.id,
        service_id: t.service_id,
        category_id: t.category_id,
        default_owner_position: t.default_owner_position,
        deadline_offset_days: t.deadline_offset_days,
        upload_offset_days: t.upload_offset_days,
        default_followers_positions: t.default_followers_positions,
        items: t.items,
      };
      return {
        template: tmplInput,
        projectStartDate: start,
        weekSplit: sel.weekSplit ?? false,
        weeks: sel.weeks ?? null,
      };
    });

  const generated = expandTemplates(expandInputs);
  if (generated.length === 0) return { count: 0 };

  // Resolve specialists per-service (for the role_slot assignment), reusing
  // the same logic as the existing handover engine.
  const { data: services } = await supabaseAdmin
    .from("services")
    .select(
      `id, default_specialist_employee_id,
       default_department:departments!services_default_department_id_fkey ( head_employee_id )`,
    )
    .eq("organization_id", args.organizationId)
    .in("id", serviceIds);
  const specialistByServiceId = new Map<string, string>();
  for (const s of services ?? []) {
    const dept = Array.isArray(s.default_department) ? s.default_department[0] : s.default_department;
    const specialist = s.default_specialist_employee_id ?? dept?.head_employee_id ?? null;
    if (specialist) specialistByServiceId.set(s.id, specialist);
  }

  const insertPayload = generated.map((g) => ({
    organization_id: args.organizationId,
    project_id: args.projectId,
    service_id: g.serviceId,
    title: g.title,
    description: g.description,
    priority: g.priority,
    due_date: g.deadline,
    planned_date: g.deadline,
    created_from_template_item_id: g.templateItemId ?? null,
    created_by: args.createdByUserId ?? null,
    status: "todo" as const,
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("tasks")
    .insert(insertPayload)
    .select("id, service_id");
  if (error) {
    console.error("[generateTasksFromCategories_failed]", error.message);
    return { count: 0, error: error.message };
  }

  // Role-slot assignments (best-effort).
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
    if (slotErr) console.error("[generateTasksFromCategories_slots_failed]", slotErr.message);
  }

  // ai_event per task.
  await Promise.all(
    (inserted ?? []).map((t) =>
      logAiEvent({
        organizationId: args.organizationId,
        actorUserId: args.createdByUserId ?? null,
        eventType: "TASK_CREATED",
        entityType: "task",
        entityId: t.id,
        payload: { project_id: args.projectId, source: "categories_engine" },
      }),
    ),
  );

  return { count: inserted?.length ?? 0 };
}
