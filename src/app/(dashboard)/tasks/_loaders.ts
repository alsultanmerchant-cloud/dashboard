import "server-only";
// Server-side loaders for the new /tasks page (Supabase, not Odoo).
// Adapts listTasks() output into the BoardTask shape used by task-board.tsx
// and into the row shape used by the rich Odoo-style list view.

import {
  listBoardTasks,
  listBoardTasksPage,
  listTasks,
  listTasksPage,
  type TaskFilters,
} from "@/lib/data/tasks";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BoardTask } from "../projects/[id]/task-board";
import type { TaskStage, TaskRoleType } from "@/lib/labels";

export type NextActivitySummary = {
  activity_type: string;
  summary: string | null;
  due_date: string;
};

export type ListTaskRow = BoardTask & {
  status: string;
  due_date: string | null;
  created_at: string;
  client_name: string | null;
  project_name: string;
  project_id: string;
  /** §TASK-LIST-1 — Odoo "Hours Spent" sum over task_timesheets. */
  hours_spent: number;
  /** §TASK-LIST-1 — Odoo "Next Activity" (earliest unresolved task_activity). */
  next_activity: NextActivitySummary | null;
  /** §TASK-LIST-1 — Odoo "Approval Status" pill. */
  approval_status: string | null;
  approval_required: boolean;
};

type RawTask = Awaited<ReturnType<typeof listTasks>>[number];

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

function toListRow(t: RawTask): ListTaskRow | null {
  const project = unwrap(t.project as RawTask["project"]);
  if (!project) return null;
  const client = unwrap((project as { client?: unknown }).client as { name: string } | null);
  const service = unwrap(t.service as RawTask["service"]);

  const role_slots: BoardTask["role_slots"] = {};
  for (const ta of (t.task_assignees ?? []) as Array<{
    role_type: string;
    employee: { id: string; full_name: string; avatar_url: string | null } | { id: string; full_name: string; avatar_url: string | null }[] | null;
  }>) {
    const emp = unwrap(ta.employee);
    if (!emp) continue;
    role_slots[ta.role_type as TaskRoleType] = {
      id: emp.id,
      full_name: emp.full_name,
      avatar_url: emp.avatar_url,
    };
  }

  // Extra Rwasem fields surfaced in the Odoo task overview (allocated time,
  // delay days, completion date, computed progress slip). Plus the new
  // Sky Light parity fields from #19 (design_count / closed_subtask_count).
  const tx = t as RawTask & {
    progress_slip_percent?: number | null;
    allocated_time_minutes?: number | null;
    delay_days?: number | null;
    completed_at?: string | null;
    task_code?: string | null;
    design_count?: number | null;
    closed_subtask_count?: number | null;
    external_source?: string | null;
  };

  return {
    id: t.id,
    title: t.title,
    task_code: tx.task_code ?? null,
    stage: t.stage as TaskStage,
    stage_entered_at: t.stage_entered_at,
    planned_date: t.planned_date,
    due_date: t.due_date,
    priority: t.priority,
    progress_percent: t.progress_percent,
    expected_progress_percent: t.expected_progress_percent,
    progress_slip_percent: tx.progress_slip_percent ?? null,
    allocated_time_minutes: tx.allocated_time_minutes ?? null,
    delay_days: tx.delay_days ?? null,
    completed_at: tx.completed_at ?? null,
    service: service
      ? { id: service.id, name: service.name, slug: service.slug }
      : null,
    project: {
      id: project.id,
      name: project.name,
      client_name: client?.name ?? null,
    },
    role_slots,
    design_count: tx.design_count ?? 0,
    closed_subtask_count: tx.closed_subtask_count ?? 0,
    external_source: tx.external_source ?? null,
    status: t.status,
    created_at: t.created_at,
    client_name: client?.name ?? null,
    project_name: project.name,
    project_id: project.id,
    // §TASK-LIST-1 — placeholders filled by enrichListRows() after the
    // bundle returns. Keeping them on the row keeps the renderer simple.
    hours_spent: 0,
    next_activity: null,
    approval_status: null,
    approval_required: false,
  };
}

// §TASK-LIST-1 — fetch the three Odoo list-only signals in bulk (one query
// each, all grouped by task_id) and merge into the row map. Cheaper than
// adding to the bundle RPC right away; can be folded back into the RPC in
// a future migration once the column set stabilises.
async function enrichListRows(
  orgId: string,
  rows: ListTaskRow[],
): Promise<ListTaskRow[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);

  const [timesheetsRes, activitiesRes, approvalsRes] = await Promise.all([
    supabaseAdmin
      .from("task_timesheets")
      .select("task_id, hours")
      .eq("organization_id", orgId)
      .in("task_id", ids),
    supabaseAdmin
      .from("task_activities")
      .select("task_id, activity_type, summary, due_date")
      .eq("organization_id", orgId)
      .in("task_id", ids)
      .is("completed_at", null)
      .order("due_date", { ascending: true }),
    supabaseAdmin
      .from("tasks")
      .select("id, approval_status, approval_required")
      .eq("organization_id", orgId)
      .in("id", ids),
  ]);

  const hoursByTask = new Map<string, number>();
  for (const row of (timesheetsRes.data ?? []) as Array<{
    task_id: string;
    hours: number | string | null;
  }>) {
    const h = typeof row.hours === "string" ? Number(row.hours) : row.hours;
    if (h == null || !Number.isFinite(h)) continue;
    hoursByTask.set(row.task_id, (hoursByTask.get(row.task_id) ?? 0) + h);
  }

  // First (= earliest due) open activity per task — query is already
  // ordered ascending so the first hit wins.
  const nextActivityByTask = new Map<string, NextActivitySummary>();
  for (const row of (activitiesRes.data ?? []) as Array<{
    task_id: string;
    activity_type: string;
    summary: string | null;
    due_date: string;
  }>) {
    if (!nextActivityByTask.has(row.task_id)) {
      nextActivityByTask.set(row.task_id, {
        activity_type: row.activity_type,
        summary: row.summary,
        due_date: row.due_date,
      });
    }
  }

  const approvalByTask = new Map<string, { status: string | null; required: boolean }>();
  for (const row of (approvalsRes.data ?? []) as Array<{
    id: string;
    approval_status: string | null;
    approval_required: boolean | null;
  }>) {
    approvalByTask.set(row.id, {
      status: row.approval_status,
      required: Boolean(row.approval_required),
    });
  }

  return rows.map((r) => ({
    ...r,
    hours_spent: hoursByTask.get(r.id) ?? 0,
    next_activity: nextActivityByTask.get(r.id) ?? null,
    approval_status: approvalByTask.get(r.id)?.status ?? null,
    approval_required: approvalByTask.get(r.id)?.required ?? false,
  }));
}

export async function loadTasksForGlobalView(
  orgId: string,
  filters: TaskFilters,
): Promise<ListTaskRow[]> {
  const raw = await listTasks(orgId, filters);
  const rows = raw
    .map(toListRow)
    .filter((x): x is ListTaskRow => x !== null);
  return enrichListRows(orgId, rows);
}

export async function loadTasksPageForGlobalView(
  orgId: string,
  filters: TaskFilters,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: ListTaskRow[]; totalCount: number }> {
  const bundle = await listTasksPage(orgId, filters, opts);
  const rows = bundle.rows
    .map(toListRow)
    .filter((x): x is ListTaskRow => x !== null);
  return {
    rows: await enrichListRows(orgId, rows),
    totalCount: bundle.totalCount,
  };
}

export async function loadTaskBoardForGlobalView(
  orgId: string,
  filters: TaskFilters,
): Promise<BoardTask[]> {
  const rows = await listBoardTasks(orgId, filters);
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    task_code: t.task_code ?? null,
    stage: t.stage as TaskStage,
    stage_entered_at: t.stage_entered_at,
    planned_date: t.planned_date,
    due_date: t.due_date,
    priority: t.priority,
    progress_percent: t.progress_percent,
    expected_progress_percent: t.expected_progress_percent,
    progress_slip_percent: t.progress_slip_percent ?? null,
    allocated_time_minutes: t.allocated_time_minutes ?? null,
    delay_days: t.delay_days ?? null,
    current_stage_duration: t.current_stage_duration ?? null,
    sequence: t.sequence ?? 10,
    external_id: t.external_id ?? null,
    completed_at: t.completed_at ?? null,
    status: t.status,
    service: t.service,
    project: {
      id: t.project_id,
      name: t.project_name,
      client_name: t.client_name,
    },
    role_slots: t.role_slots as Partial<
      Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
    >,
    design_count: t.design_count,
    closed_subtask_count: t.closed_subtask_count,
    external_source: t.external_source ?? null,
    tags: t.tags,
    created_at: t.created_at,
  }));
}

export async function loadTaskBoardPageForGlobalView(
  orgId: string,
  filters: TaskFilters,
  opts: {
    limit?: number;
    offset?: number;
    partition?: { by: string; limit: number } | null;
  } = {},
): Promise<{ rows: BoardTask[]; totalCount: number; groupRows: BoardTask[] }> {
  const bundle = await listBoardTasksPage(orgId, filters, opts);
  return {
    // Slim grouping rows for the FULL filtered set — carry only the fields the
    // board's bucketTasksBy reads, so they're cast to BoardTask for counting.
    groupRows: bundle.groupRows as BoardTask[],
    rows: bundle.rows.map((t) => ({
      id: t.id,
      title: t.title,
      task_code: t.task_code ?? null,
      stage: t.stage as TaskStage,
      stage_entered_at: t.stage_entered_at,
      planned_date: t.planned_date,
      due_date: t.due_date,
      priority: t.priority,
      progress_percent: t.progress_percent,
      expected_progress_percent: t.expected_progress_percent,
      progress_slip_percent: t.progress_slip_percent ?? null,
      allocated_time_minutes: t.allocated_time_minutes ?? null,
      delay_days: t.delay_days ?? null,
      current_stage_duration: t.current_stage_duration ?? null,
      sequence: t.sequence ?? 10,
      external_id: t.external_id ?? null,
      completed_at: t.completed_at ?? null,
      status: t.status,
      service: t.service,
      project: {
        id: t.project_id,
        name: t.project_name,
        client_name: t.client_name,
      },
      role_slots: t.role_slots as Partial<
        Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
      >,
      design_count: t.design_count,
      closed_subtask_count: t.closed_subtask_count,
      external_source: t.external_source ?? null,
      tags: t.tags,
      created_at: t.created_at,
    })),
    totalCount: bundle.totalCount,
  };
}
