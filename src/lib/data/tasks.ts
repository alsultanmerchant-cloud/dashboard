import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskRoleType, TaskStage } from "@/lib/labels";

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
  // True → progress_slip_percent < -5 (ahead of schedule).
  aheadSchedule?: boolean;
  // True → only tasks with delay_days > 3 (critical SLA breach).
  criticalDelay?: boolean;
  // 0% / 1-99% / 100% buckets driven by progress_percent. Multi-select (OR).
  progressBuckets?: Array<"not_started" | "in_progress" | "completed">;
  // True → priority IN ('urgent','high') — Rwasem "starred" group.
  starred?: boolean;
  // Auth user id whose followed tasks should be included.
  followedByUserId?: string;
  assignedToEmployeeId?: string;
  search?: string;
  // Hierarchical date filters (Rwasem parity). Each entry is one bucket on one
  // field; multiple entries on the SAME field OR together; entries on
  // DIFFERENT fields AND together. Dates are inclusive on `from`, exclusive
  // on `to` (ISO YYYY-MM-DD). Allowed fields are listed in `DATE_FIELDS`.
  dateFilters?: Array<{ field: DateField; from: string; to: string }>;
};

export const DATE_FIELDS = [
  "due_date",
  "actual_done_date",
  "stage_entered_at",
  "created_at",
] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export type BoardTaskData = {
  id: string;
  title: string;
  stage: TaskStage;
  stage_entered_at: string;
  planned_date: string | null;
  due_date: string | null;
  priority: string;
  progress_percent: number | null;
  expected_progress_percent: number | null;
  progress_slip_percent?: number | null;
  allocated_time_minutes?: number | null;
  delay_days?: number | null;
  completed_at?: string | null;
  project_id: string;
  project_name: string;
  client_name: string | null;
  service: { id: string; name: string; slug: string } | null;
  role_slots: Partial<
    Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
  >;
};

function buildTaskQuery(
  orgId: string,
  filters: TaskFilters,
  selectClause: string,
  limit: number,
) {
  const search = filters.search?.trim();
  return (async () => {
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
      .select(selectClause)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

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
    if (filters.aheadSchedule) {
      q = q.neq("stage", "done").lt("progress_slip_percent", -5);
    }
    if (filters.criticalDelay) {
      q = q.neq("stage", "done").gt("delay_days", 3);
    }
    if (filters.progressBuckets?.length && filters.progressBuckets.length < 3) {
      const conds: string[] = [];
      for (const b of filters.progressBuckets) {
        if (b === "not_started") conds.push("progress_percent.eq.0");
        else if (b === "in_progress") conds.push("and(progress_percent.gt.0,progress_percent.lt.100)");
        else if (b === "completed") conds.push("progress_percent.eq.100");
      }
      if (conds.length === 1) {
        const b = filters.progressBuckets[0];
        if (b === "not_started") q = q.eq("progress_percent", 0);
        else if (b === "in_progress") q = q.gt("progress_percent", 0).lt("progress_percent", 100);
        else if (b === "completed") q = q.eq("progress_percent", 100);
      } else if (conds.length > 1) {
        q = q.or(conds.join(","));
      }
    }
    if (filters.starred) {
      q = q.in("priority", ["urgent", "high"]);
    }
    if (filters.dateFilters?.length) {
      const byField = new Map<DateField, Array<{ from: string; to: string }>>();
      for (const f of filters.dateFilters) {
        const arr = byField.get(f.field) ?? [];
        arr.push({ from: f.from, to: f.to });
        byField.set(f.field, arr);
      }
      for (const [field, ranges] of byField) {
        if (ranges.length === 1) {
          const r = ranges[0];
          q = q.gte(field, r.from).lt(field, r.to);
        } else {
          const conds = ranges.map(
            (r) => `and(${field}.gte.${r.from},${field}.lt.${r.to})`,
          );
          q = q.or(conds.join(","));
        }
      }
    }
    if (filters.followedByUserId) {
      const { data: followedRows, error: followedErr } = await supabaseAdmin
        .from("task_followers")
        .select("task_id")
        .eq("user_id", filters.followedByUserId)
        .limit(1000);
      if (followedErr) throw followedErr;
      const ids = (followedRows ?? []).map((r) => r.task_id as string);
      if (ids.length === 0) {
        q = q.eq("id", "00000000-0000-0000-0000-000000000000");
      } else {
        q = q.in("id", ids);
      }
    }
    if (search) {
      const escaped = search.replace(/[%,()]/g, " ").trim();
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
        q = q.eq("id", "00000000-0000-0000-0000-000000000000");
      } else if (idClauses.length === 1) {
        const [field, rest] = idClauses[0].split(".in.");
        q = q.in(field, rest.slice(1, -1).split(","));
      } else {
        q = q.or(idClauses.join(","));
      }
    }

    return q;
  })();
}

export async function listTasks(orgId: string, filters: TaskFilters = {}) {
  const q = await buildTaskQuery(
    orgId,
    filters,
    `
      id, title, status, stage, stage_entered_at, planned_date,
      progress_percent, expected_progress_percent, progress_slip_percent,
      allocated_time_minutes, delay_days, task_code,
      priority, due_date, completed_at, created_at, project_id,
      project:projects ( id, name, project_code, client:clients ( name ) ),
      service:services ( id, name, slug ),
      task_assignees ( role_type, employee:employee_profiles ( id, full_name, avatar_url ) )
    `,
    200,
  );

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

export async function listBoardTasks(
  orgId: string,
  filters: TaskFilters = {},
): Promise<BoardTaskData[]> {
  const q = await buildTaskQuery(
    orgId,
    filters,
    `
      id, title, stage, stage_entered_at, planned_date,
      progress_percent, expected_progress_percent, progress_slip_percent,
      allocated_time_minutes, delay_days,
      priority, due_date, completed_at, project_id,
      project:projects ( id, name, client:clients ( name ) ),
      service:services ( id, name, slug ),
      task_assignees ( role_type, employee:employee_profiles ( id, full_name, avatar_url ) )
    `,
    filters.projectId ? 1000 : 200,
  );

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((t) => {
    const project = Array.isArray(t.project) ? t.project[0] : t.project;
    const client = project && Array.isArray(project.client) ? project.client[0] : project?.client;
    const service = Array.isArray(t.service) ? t.service[0] : t.service;
    const role_slots: BoardTaskData["role_slots"] = {};
    for (const ta of t.task_assignees ?? []) {
      const employee = Array.isArray(ta.employee) ? ta.employee[0] : ta.employee;
      if (!employee) continue;
      role_slots[ta.role_type as TaskRoleType] = {
        id: employee.id,
        full_name: employee.full_name,
        avatar_url: employee.avatar_url,
      };
    }

    return {
      id: t.id,
      title: t.title,
      stage: t.stage as TaskStage,
      stage_entered_at: t.stage_entered_at ?? t.created_at,
      planned_date: t.planned_date ?? null,
      due_date: t.due_date ?? null,
      priority: t.priority,
      progress_percent: t.progress_percent ?? null,
      expected_progress_percent: t.expected_progress_percent ?? null,
      progress_slip_percent: t.progress_slip_percent ?? null,
      allocated_time_minutes: t.allocated_time_minutes ?? null,
      delay_days: t.delay_days ?? null,
      completed_at: t.completed_at ?? null,
      project_id: project?.id ?? t.project_id,
      project_name: project?.name ?? "—",
      client_name: client?.name ?? null,
      service: service
        ? { id: service.id, name: service.name, slug: service.slug }
        : null,
      role_slots,
    };
  });
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
  // Comments come from two sources:
  //   1. Local users (author_user_id = auth.users.id) — resolve via employee_profiles.
  //   2. Odoo chatter (author_user_id is null, external_author_name/avatar set
  //      because the original author is a res.partner with no auth.users row).
  // The migration 0046 made author_user_id nullable for exactly this case.
  const { data, error } = await supabaseAdmin
    .from("task_comments")
    .select(
      "id, body, is_internal, kind, created_at, author_user_id, external_author_name, external_author_avatar_url",
    )
    .eq("organization_id", orgId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const authorIds = Array.from(
    new Set(
      data
        .map((c) => c.author_user_id)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const map = new Map<string, { full_name: string; avatar_url: string | null }>();
  if (authorIds.length > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name, avatar_url")
      .eq("organization_id", orgId)
      .in("user_id", authorIds);
    for (const e of emps ?? []) {
      if (e.user_id)
        map.set(e.user_id, {
          full_name: e.full_name,
          avatar_url: e.avatar_url,
        });
    }
  }
  return data.map((c) => {
    const local = c.author_user_id ? map.get(c.author_user_id) : null;
    return {
      ...c,
      author_name:
        local?.full_name ?? c.external_author_name ?? "موظف",
      author_avatar:
        local?.avatar_url ?? c.external_author_avatar_url ?? null,
    };
  });
}
