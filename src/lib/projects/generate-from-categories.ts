import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAiEvent } from "@/lib/audit";
import { expandTemplates, type TemplateInput } from "./offsets";
import { listTemplatesForServices } from "@/lib/data/service-categories";
import { buildOwnerResolver } from "@/lib/workflows/resolve-task-owners";
import type { Database } from "@/lib/supabase/types";

type TaskRoleType = Database["public"]["Enums"]["task_role_type"];

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
  // Project-level role slots (migration 0049). When set, they override the
  // service-default specialist for matching service slugs.
  socialSpecialistEmployeeId?: string | null;
  mediaSpecialistEmployeeId?: string | null;
  seoSpecialistEmployeeId?: string | null;
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

  // Resolve specialists per-service. Project-level slots (social / media /
  // seo) win over service defaults when the service slug matches.
  const { data: services } = await supabaseAdmin
    .from("services")
    .select(
      `id, slug, default_specialist_employee_id,
       default_department:departments!services_default_department_id_fkey ( head_employee_id )`,
    )
    .eq("organization_id", args.organizationId)
    .in("id", serviceIds);
  const specialistByServiceId = new Map<string, string>();
  // manager → head of the service's department (org-chart resolution).
  const deptHeadByServiceId = new Map<string, string>();
  for (const s of services ?? []) {
    const dept = Array.isArray(s.default_department) ? s.default_department[0] : s.default_department;
    if (dept?.head_employee_id) deptHeadByServiceId.set(s.id, dept.head_employee_id);
    const slug = ((s as { slug?: string | null }).slug ?? "").toLowerCase();
    let projectOverride: string | null = null;
    if (
      args.socialSpecialistEmployeeId &&
      (slug.includes("social") || slug === "smm" || slug.includes("social-media"))
    ) {
      projectOverride = args.socialSpecialistEmployeeId;
    } else if (
      args.mediaSpecialistEmployeeId &&
      (slug.includes("media-buying") || slug.includes("media_buying") || slug === "media")
    ) {
      projectOverride = args.mediaSpecialistEmployeeId;
    } else if (args.seoSpecialistEmployeeId && slug.includes("seo")) {
      projectOverride = args.seoSpecialistEmployeeId;
    }
    const specialist =
      projectOverride ?? s.default_specialist_employee_id ?? dept?.head_employee_id ?? null;
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
    // Template upload offset → concrete upload date on the generated task, so
    // it lands in the specialist's /uploads queue. null when the template item
    // has no upload offset (the task simply has no upload date).
    upload_due_date: g.uploadDue,
    created_from_template_item_id: g.templateItemId ?? null,
    created_by: args.createdByUserId ?? null,
    status: "todo" as const,
    // Honour the template item's per-stage owner-position mapping. Falls
    // back to the column default (the standard PDF mapping) when the
    // template author hasn't customised it.
    stage_owner_positions: g.stageOwnerPositions ?? null,
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("tasks")
    .insert(insertPayload)
    .select("id, service_id, stage_owner_positions");
  if (error) {
    console.error("[generateTasksFromCategories_failed]", error.message);
    return { count: 0, error: error.message };
  }

  // Role-slot assignments (best-effort). Each task's stage_owner_positions
  // references positions (by slug); resolve position → role → employee.
  type SlotRow = {
    organization_id: string;
    task_id: string;
    employee_id: string;
    role_type: TaskRoleType;
    assigned_by: string | null;
  };
  const resolver = await buildOwnerResolver({
    organizationId: args.organizationId,
    projectId: args.projectId,
    serviceIds,
    accountManagerEmployeeId: args.accountManagerEmployeeId,
    specialistByServiceId,
    deptHeadByServiceId,
  });
  const slotRows: SlotRow[] = [];
  for (const t of inserted ?? []) {
    const slugs = new Set<string>(["account_manager", "specialist"]);
    const sop = (t as { stage_owner_positions?: Record<string, string | null> | null })
      .stage_owner_positions;
    if (sop) {
      for (const v of Object.values(sop)) if (v) slugs.add(v);
    }
    // One slot per structural role — dedupe so two positions sharing a role
    // don't violate the unique(task_id, role_type) index.
    const byRole = new Map<string, string>();
    for (const slug of slugs) {
      const role = resolver.roleOf(slug);
      if (!role || byRole.has(role)) continue;
      const employeeId = resolver.resolve(slug, t.service_id);
      if (employeeId) byRole.set(role, employeeId);
    }
    // Extra people pinned on the service join every one of its tasks.
    for (const ex of resolver.extrasFor(t.service_id)) {
      if (!byRole.has(ex.role)) byRole.set(ex.role, ex.employeeId);
    }
    for (const [role, employeeId] of byRole) {
      slotRows.push({
        organization_id: args.organizationId,
        task_id: t.id,
        employee_id: employeeId,
        role_type: role as TaskRoleType,
        assigned_by: args.createdByUserId ?? null,
      });
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
