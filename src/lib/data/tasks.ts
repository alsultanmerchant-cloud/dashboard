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
  // Sky Light feedback #18 (filter parity): Odoo's "Has Start Date" /
  // "Has End Date" presets. start = planned_date, end = due_date.
  hasStartDate?: boolean;
  hasEndDate?: boolean;
  // True → planned_date IS NULL AND due_date IS NULL. Sky Light "tasks
  // without a deadline" filter. Applied post-fetch so we don't need a new
  // RPC parameter; cheap because the bundle is already capped at LIMIT.
  noDeadline?: boolean;
  // Rwasem-parity additions (migration 0105):
  //   unassigned       — no task_assignees rows
  //   overTimesheets   — logged hours × 60 > allocated_time_minutes
  //   nearTimesheets   — 80% ≤ logged × 60 / allocated < 100%
  unassigned?: boolean;
  overTimesheets?: boolean;
  nearTimesheets?: boolean;
  // Migration 0106 — Rwasem "Archived" pill.
  //   archived         — when true, return ONLY archived tasks
  //                      (default false hides archived everywhere else)
  //   includeArchived  — when true, ignore the archive filter entirely
  //                      (useful for admin/audit views)
  archived?: boolean;
  includeArchived?: boolean;
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
  // tasks.status — surfaced so kanban can group by status (#18 parity).
  status: string;
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
  // PR-F (#3): origin — "odoo" for synced rows, null for dashboard-created.
  external_source?: string | null;
  task_code: string | null;
  project_id: string;
  project_name: string;
  client_name: string | null;
  service: { id: string; name: string; slug: string } | null;
  role_slots: Partial<
    Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
  >;
  // #19: design / edit counts (Sky Light parity).
  design_count: number | null;
  closed_subtask_count: number | null;
  // §5.2: project tags surfaced for client-side group-by.
  tags: Array<{ id: string; name: string; color: number }>;
  created_at: string;
};

const GLOBAL_BOARD_LIMIT = 120;
const PROJECT_BOARD_LIMIT = 400;
const LIST_LIMIT = 200;

// Row shape returned by list_tasks_bundle (migration 0085). Mirrors the
// previous PostgREST embed shape so _loaders.ts and existing callers keep
// working unchanged. project / service are objects (or null), task_assignees
// is an array of { role_type, employee: {...} }.
type TaskBundleRow = {
  id: string;
  title: string;
  status: string;
  stage: string;
  stage_entered_at: string;
  planned_date: string | null;
  progress_percent: number | null;
  expected_progress_percent: number | null;
  progress_slip_percent: number | null;
  allocated_time_minutes: number | null;
  delay_days: number | null;
  task_code: string | null;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
  actual_done_date: string | null;
  created_at: string;
  project_id: string;
  // PR-F (#3): origin — "odoo" for synced rows, null for dashboard-created.
  external_source: string | null;
  // #19: counts surfaced as new task list columns. Both default to 0.
  design_count: number | null;
  closed_subtask_count: number | null;
  project:
    | {
        id: string;
        name: string;
        project_code: string | null;
        client: { id: string; name: string } | null;
      }
    | null;
  service: { id: string; name: string; slug: string } | null;
  tags?: Array<{ id: string; name: string; color: number }>;
  task_assignees: Array<{
    role_type: string;
    employee: { id: string; full_name: string; avatar_url: string | null };
  }>;
};

type TaskBundleResult = { rows: TaskBundleRow[] };

/**
 * Single round-trip task fetch backed by the `list_tasks_bundle` RPC
 * (migration 0085). Replaces the old buildTaskQuery() which made up to three
 * sequential PostgREST calls (project search → FTS → main query) and
 * post-filtered `assignedToEmployeeId` in JavaScript — the latter was a
 * correctness bug because a matching task outside the first `limit` rows
 * would silently disappear.
 */
async function fetchTaskBundle(
  orgId: string,
  filters: TaskFilters,
  limit: number,
): Promise<TaskBundleRow[]> {
  const search = filters.search?.trim();
  const sanitizedSearch = search ? search.replace(/[%,()]/g, " ").trim() : "";

  const { data, error } = await supabaseAdmin.rpc("list_tasks_bundle", {
    p_org_id: orgId,
    p_limit: limit,
    p_status: filters.status?.length ? filters.status : null,
    p_stage: filters.stage?.length ? filters.stage : null,
    p_priority: filters.priority?.length ? filters.priority : null,
    p_project_id: filters.projectId ?? null,
    p_overdue: !!filters.overdue,
    p_due_today: !!filters.dueToday,
    p_behind_schedule: !!filters.behindSchedule,
    p_ahead_schedule: !!filters.aheadSchedule,
    p_critical_delay: !!filters.criticalDelay,
    p_progress_buckets: filters.progressBuckets?.length
      ? filters.progressBuckets
      : null,
    p_starred: !!filters.starred,
    p_followed_by_user_id: filters.followedByUserId ?? null,
    p_assigned_to_employee_id: filters.assignedToEmployeeId ?? null,
    p_search: sanitizedSearch || null,
    p_date_filters: filters.dateFilters?.length ? filters.dateFilters : null,
    p_has_start_date: !!filters.hasStartDate,
    p_has_end_date: !!filters.hasEndDate,
    p_unassigned: !!filters.unassigned,
    p_over_timesheets: !!filters.overTimesheets,
    p_near_timesheets: !!filters.nearTimesheets,
    p_archived: !!filters.archived,
    p_include_archived: !!filters.includeArchived,
  });
  if (error) throw error;
  const bundle = (data ?? { rows: [] }) as TaskBundleResult;
  let rows = bundle.rows;
  if (filters.noDeadline) {
    rows = rows.filter(
      (r) =>
        (r as { planned_date?: string | null }).planned_date == null &&
        (r as { due_date?: string | null }).due_date == null,
    );
  }
  return rows;
}

export async function listTasks(orgId: string, filters: TaskFilters = {}) {
  return fetchTaskBundle(orgId, filters, LIST_LIMIT);
}

export async function listBoardTasks(
  orgId: string,
  filters: TaskFilters = {},
): Promise<BoardTaskData[]> {
  const data = await fetchTaskBundle(
    orgId,
    filters,
    filters.projectId ? PROJECT_BOARD_LIMIT : GLOBAL_BOARD_LIMIT,
  );

  return data.map((t) => {
    const project = t.project;
    const client = project?.client ?? null;
    const service = t.service;
    const role_slots: BoardTaskData["role_slots"] = {};
    for (const ta of t.task_assignees ?? []) {
      const employee = ta.employee;
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
      status: t.status,
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
      external_source: t.external_source ?? null,
      task_code: t.task_code ?? null,
      project_id: project?.id ?? t.project_id,
      project_name: project?.name ?? "—",
      client_name: client?.name ?? null,
      service: service
        ? { id: service.id, name: service.name, slug: service.slug }
        : null,
      role_slots,
      design_count: t.design_count ?? 0,
      closed_subtask_count: t.closed_subtask_count ?? 0,
      tags: t.tags ?? [],
      created_at: t.created_at,
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

// Sky Light feedback #5 — a forgiving "type to find a task" autocomplete.
// Backed by the `search_tasks_typeahead` RPC (migration 0117): arabic FTS +
// pg_trgm similarity so short / partial Arabic words still match. Mirrors
// Odoo's name_search behaviour (substring + relevance ranking).
export type TaskSearchSuggestion = {
  id: string;
  title: string;
  taskCode: string | null;
  stage: string;
  projectName: string | null;
  clientName: string | null;
};

export async function listTaskTitleSuggestions(
  orgId: string,
  query: string,
): Promise<TaskSearchSuggestion[]> {
  const search = query.trim();
  if (!search) return [];

  // Strip characters that break websearch_to_tsquery / similarity input.
  const sanitized = search.replace(/[%,()]/g, " ").trim();
  if (!sanitized) return [];

  const { data, error } = await supabaseAdmin.rpc("search_tasks_typeahead", {
    p_org_id: orgId,
    p_query: sanitized,
    p_limit: 8,
  });
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    taskCode: string | null;
    stage: string;
    projectName: string | null;
    clientName: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    taskCode: row.taskCode ?? null,
    stage: row.stage,
    projectName: row.projectName ?? null,
    clientName: row.clientName ?? null,
  }));
}

export async function getTask(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(`
      *,
      project:projects ( id, name, client:clients ( id, name ) ),
      service:services ( id, name ),
      task_assignees ( id, role_type, employee:employee_profiles!task_assignees_employee_id_fkey ( id, full_name, avatar_url, job_title, position, department:departments!employee_profiles_department_id_fkey ( id, name ) ) )
    `)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getTaskSummary(orgId: string, id: string) {
  // Includes the form-card fields (allocated_time_minutes, progress_*,
  // hold_*, etc.) so /tasks/[id] doesn't need a second `getTask()` round
  // trip inside its TaskFormSection Suspense boundary.
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, title, description, stage, status, priority, planned_date, due_date,
      completed_at, stage_entered_at, project_id, created_by, task_code,
      approval_required, approval_status, first_approver_id,
      approval_requested_at, approval_decided_at, stage_owner_positions,
      actual_done_date, allocated_time_minutes,
      progress_percent, expected_progress_percent, progress_slip_percent,
      delay_days, hold_reason, hold_since, is_important,
      design_count, revision_count,
      project:projects ( id, name, client:clients ( id, name ) ),
      service:services ( id, name, slug ),
      task_tag_assignments ( tag:project_tags ( id, name, color ) ),
      task_assignees ( id, role_type, employee:employee_profiles!task_assignees_employee_id_fkey ( id, full_name, avatar_url, job_title, position, department:departments!employee_profiles_department_id_fkey ( id, name ) ) )
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
