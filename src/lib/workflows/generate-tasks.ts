import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAiEvent } from "@/lib/audit";

/**
 * Expand task templates for the given service ids into concrete tasks for the project.
 * Returns the number of tasks created.
 */
export async function generateTasksForProjectFromServices(args: {
  organizationId: string;
  projectId: string;
  serviceIds: string[];
  projectStartDate: string | null;
  createdByUserId?: string | null;
}) {
  if (args.serviceIds.length === 0) return 0;

  const { data: templates } = await supabaseAdmin
    .from("task_templates")
    .select("id, service_id, task_template_items ( id, title, description, default_department_id, default_role_key, offset_days_from_project_start, duration_days, priority )")
    .eq("organization_id", args.organizationId)
    .in("service_id", args.serviceIds)
    .eq("is_active", true);
  if (!templates || templates.length === 0) return 0;

  const start = args.projectStartDate ? new Date(args.projectStartDate) : new Date();

  const rows = templates.flatMap((tmpl) =>
    (tmpl.task_template_items ?? []).map((item) => {
      const due = new Date(start);
      due.setDate(due.getDate() + (item.offset_days_from_project_start ?? 0) + (item.duration_days ?? 1));
      return {
        organization_id: args.organizationId,
        project_id: args.projectId,
        service_id: tmpl.service_id,
        title: item.title,
        description: item.description,
        priority: item.priority ?? "medium",
        due_date: due.toISOString().slice(0, 10),
        created_from_template_item_id: item.id,
        created_by: args.createdByUserId ?? null,
        status: "todo" as const,
      };
    }),
  );

  if (rows.length === 0) return 0;

  const { data: inserted, error } = await supabaseAdmin
    .from("tasks")
    .insert(rows)
    .select("id");
  if (error) {
    console.error("[generateTasks_failed]", error.message);
    return 0;
  }

  // One ai_event per task created — aggregate later in dashboard.
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
