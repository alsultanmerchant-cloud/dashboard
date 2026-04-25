import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type TaskFilters = {
  status?: string[];
  priority?: string[];
  projectId?: string;
  overdue?: boolean;
  assignedToEmployeeId?: string;
  search?: string;
};

export async function listTasks(orgId: string, filters: TaskFilters = {}) {
  let q = supabaseAdmin
    .from("tasks")
    .select(`
      id, title, status, priority, due_date, completed_at, created_at, project_id,
      project:projects ( id, name, client:clients ( name ) ),
      service:services ( id, name, slug ),
      task_assignees ( employee:employee_profiles ( id, full_name, avatar_url ) )
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.status?.length) q = q.in("status", filters.status);
  if (filters.priority?.length) q = q.in("priority", filters.priority);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.overdue) {
    const today = new Date().toISOString().slice(0, 10);
    q = q.in("status", ["todo", "in_progress", "review", "blocked"]).lt("due_date", today);
  }
  if (filters.search) q = q.ilike("title", `%${filters.search}%`);

  const { data, error } = await q;
  if (error) throw error;
  let result = data ?? [];

  if (filters.assignedToEmployeeId) {
    result = result.filter((t) =>
      (t.task_assignees ?? []).some((ta) => {
        const e = Array.isArray(ta.employee) ? ta.employee[0] : ta.employee;
        return e?.id === filters.assignedToEmployeeId;
      }),
    );
  }
  return result;
}

export async function getTask(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(`
      *,
      project:projects ( id, name, client:clients ( id, name ) ),
      service:services ( id, name ),
      task_assignees ( id, employee:employee_profiles ( id, full_name, avatar_url, job_title ) )
    `)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listTaskComments(orgId: string, taskId: string) {
  const { data, error } = await supabaseAdmin
    .from("task_comments")
    .select("id, body, is_internal, created_at, author_user_id")
    .eq("organization_id", orgId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const authorIds = Array.from(new Set(data.map((c) => c.author_user_id)));
  const { data: emps } = await supabaseAdmin
    .from("employee_profiles")
    .select("user_id, full_name, avatar_url")
    .eq("organization_id", orgId)
    .in("user_id", authorIds);
  const map = new Map<string, { full_name: string; avatar_url: string | null }>();
  for (const e of emps ?? []) {
    if (e.user_id) map.set(e.user_id, { full_name: e.full_name, avatar_url: e.avatar_url });
  }
  return data.map((c) => ({
    ...c,
    author_name: map.get(c.author_user_id)?.full_name ?? "موظف",
    author_avatar: map.get(c.author_user_id)?.avatar_url ?? null,
  }));
}
