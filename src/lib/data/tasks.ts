import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type TaskFilters = {
  status?: string[];
  stage?: string[];
  priority?: string[];
  projectId?: string;
  overdue?: boolean;
  // True → only tasks with planned_date == today.
  dueToday?: boolean;
  // True → only tasks where progress_slip_percent > 5 (behind schedule).
  behindSchedule?: boolean;
  // True → only tasks with delay_days > 3 (critical SLA breach).
  criticalDelay?: boolean;
  assignedToEmployeeId?: string;
  search?: string;
};

export async function listTasks(orgId: string, filters: TaskFilters = {}) {
  const search = filters.search?.trim();
  let matchingProjectIds: string[] = [];
  if (search) {
    const escaped = search.replace(/[%,()]/g, " ").trim();
    if (escaped) {
      const { data: projectMatches, error: projectErr } = await supabaseAdmin
        .from("projects")
        .select("id")
        .eq("organization_id", orgId)
        .or(`name.ilike.%${escaped}%,store_name.ilike.%${escaped}%`)
        .limit(30);
      if (projectErr) throw projectErr;
      matchingProjectIds = (projectMatches ?? []).map((row) => row.id as string);
    }
  }

  let q = supabaseAdmin
    .from("tasks")
    .select(`
      id, title, status, stage, stage_entered_at, planned_date,
      progress_percent, expected_progress_percent, progress_slip_percent,
      allocated_time_minutes, delay_days, task_code,
      priority, due_date, completed_at, created_at, project_id,
      project:projects ( id, name, project_code, client:clients ( name ) ),
      service:services ( id, name, slug ),
      task_assignees ( role_type, employee:employee_profiles ( id, full_name, avatar_url ) )
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.status?.length) q = q.in("status", filters.status);
  if (filters.stage?.length) q = q.in("stage", filters.stage);
  if (filters.priority?.length) q = q.in("priority", filters.priority);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.overdue) {
    q = q.eq("is_overdue", true);
  }
  if (filters.dueToday) {
    const today = new Date().toISOString().slice(0, 10);
    q = q.neq("stage", "done").eq("planned_date", today);
  }
  if (filters.behindSchedule) {
    q = q.neq("stage", "done").gt("progress_slip_percent", 5);
  }
  if (filters.criticalDelay) {
    q = q.neq("stage", "done").gt("delay_days", 3);
  }
  if (search) {
    const escaped = search.replace(/[%,()]/g, " ").trim();
    // FTS over tasks.search_tsv (title + description, arabic config).
    // Run as a separate query so we can OR its IDs with the project-name
    // match below — PostgREST `.or()` can't safely embed a tsquery string.
    let ftsTaskIds: string[] = [];
    if (escaped) {
      const { data: ftsRows, error: ftsErr } = await supabaseAdmin
        .from("tasks")
        .select("id")
        .eq("organization_id", orgId)
        .textSearch("search_tsv", escaped, { config: "arabic", type: "websearch" })
        .limit(500);
      if (ftsErr) throw ftsErr;
      ftsTaskIds = (ftsRows ?? []).map((r) => r.id as string);
    }
    const idClauses: string[] = [];
    if (ftsTaskIds.length) idClauses.push(`id.in.(${ftsTaskIds.join(",")})`);
    if (matchingProjectIds.length) {
      idClauses.push(`project_id.in.(${matchingProjectIds.join(",")})`);
    }
    if (idClauses.length === 0) {
      // Nothing matched — short-circuit. Filter on a guaranteed-empty id set.
      q = q.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (idClauses.length === 1) {
      const [field, rest] = idClauses[0].split(".in.");
      q = q.in(field, rest.slice(1, -1).split(","));
    } else {
      q = q.or(idClauses.join(","));
    }
  }

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

export async function listTaskSearchSuggestions(orgId: string, query: string) {
  const search = query.trim();
  if (!search) return [];

  const escaped = search.replace(/[%,()]/g, " ").trim();
  if (!escaped) return [];

  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, store_name, client:clients(name)")
    .eq("organization_id", orgId)
    .or(`name.ilike.%${escaped}%,store_name.ilike.%${escaped}%`)
    .order("name", { ascending: true })
    .limit(8);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const client = Array.isArray(row.client) ? row.client[0] : row.client;
    return {
      id: row.id as string,
      projectName: row.name as string,
      storeName: (row.store_name as string | null) ?? null,
      clientName: client?.name ?? null,
    };
  });
}

export async function getTask(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(`
      *,
      project:projects ( id, name, client:clients ( id, name ) ),
      service:services ( id, name ),
      task_assignees ( id, role_type, employee:employee_profiles ( id, full_name, avatar_url, job_title ) )
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
