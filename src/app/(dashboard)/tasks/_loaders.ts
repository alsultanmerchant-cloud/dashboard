import "server-only";
// Server-side loaders for the new /tasks page (Supabase, not Odoo).
// Adapts listTasks() output into the BoardTask shape used by task-board.tsx
// and into the row shape used by the rich Odoo-style list view.

import { listBoardTasks, listTasks, type TaskFilters } from "@/lib/data/tasks";
import type { BoardTask } from "../projects/[id]/task-board";
import type { TaskStage, TaskRoleType } from "@/lib/labels";

export type ListTaskRow = BoardTask & {
  status: string;
  due_date: string | null;
  created_at: string;
  client_name: string | null;
  project_name: string;
  project_id: string;
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
    status: t.status,
    created_at: t.created_at,
    client_name: client?.name ?? null,
    project_name: project.name,
    project_id: project.id,
  };
}

export async function loadTasksForGlobalView(
  orgId: string,
  filters: TaskFilters,
): Promise<ListTaskRow[]> {
  const raw = await listTasks(orgId, filters);
  return raw
    .map(toListRow)
    .filter((x): x is ListTaskRow => x !== null);
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
  }));
}
