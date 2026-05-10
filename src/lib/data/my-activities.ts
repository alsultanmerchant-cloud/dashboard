import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Sky Light feedback #15/#17: their Odoo disables the calendar menu and
// expects a personal-activities surface in its place. Our `task_activities`
// table (migration 0060) already stores mail.activity-style reminders
// scoped to (task, employee). This loader returns the rows for one employee
// — open + recently-completed — so /my-activities can render a personal
// calendar and a flat list.

export type MyActivityRow = {
  id: string;
  task_id: string;
  task_code: string | null;
  task_title: string;
  project_id: string | null;
  project_name: string | null;
  activity_type: string;
  summary: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
};

export async function listMyActivities(
  orgId: string,
  employeeId: string,
): Promise<MyActivityRow[]> {
  // We pull both open and recently-completed (last 30 days) so the calendar
  // can show ✓ on past days and the list can render a small "history" tab.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { data, error } = await supabaseAdmin
    .from("task_activities")
    .select(`
      id,
      task_id,
      activity_type,
      summary,
      due_date,
      completed_at,
      created_at,
      task:tasks!task_activities_task_id_fkey (
        task_code,
        title,
        project_id,
        project:projects ( id, name )
      )
    `)
    .eq("organization_id", orgId)
    .eq("assignee_id", employeeId)
    .or(`completed_at.is.null,completed_at.gte.${cutoff.toISOString()}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const t = (Array.isArray(row.task) ? row.task[0] : row.task) as
      | { task_code: string | null; title: string; project_id: string | null; project: unknown }
      | null;
    const rawProject = (t?.project ?? null) as unknown;
    const project =
      Array.isArray(rawProject)
        ? ((rawProject[0] ?? null) as { id: string; name: string } | null)
        : (rawProject as { id: string; name: string } | null);
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      task_code: (t?.task_code as string | null) ?? null,
      task_title: (t?.title as string) ?? "—",
      project_id: project?.id ?? null,
      project_name: project?.name ?? null,
      activity_type: row.activity_type as string,
      summary: row.summary as string,
      due_date: (row.due_date as string | null) ?? null,
      completed_at: (row.completed_at as string | null) ?? null,
      created_at: row.created_at as string,
    };
  });
}
