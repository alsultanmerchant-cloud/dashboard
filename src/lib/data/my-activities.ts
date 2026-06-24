import "server-only";
import { cache } from "react";
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
        archived_at,
        project_id,
        project:projects ( id, name, status )
      )
    `)
    .eq("organization_id", orgId)
    .eq("assignee_id", employeeId)
    .is("task.archived_at", null)
    .or(`completed_at.is.null,completed_at.gte.${cutoff.toISOString()}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const t = (Array.isArray(row.task) ? row.task[0] : row.task) as
      | { task_code: string | null; title: string; project_id: string | null; project: unknown }
      | null;
    const rawProject = (t?.project ?? null) as unknown;
    const project =
      Array.isArray(rawProject)
        ? ((rawProject[0] ?? null) as { id: string; name: string; status: string } | null)
        : (rawProject as { id: string; name: string; status: string } | null);
    // Skip activities on tasks belonging to archived projects (dropped clients).
    if (project && project.status === "archived") return [];
    return [{
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
    }];
  });
}

async function _listMyOpenActivities(
  orgId: string,
  employeeId: string,
  limit: number,
): Promise<MyActivityRow[]> {
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
        archived_at,
        project_id,
        project:projects ( id, name, status )
      )
    `)
    .eq("organization_id", orgId)
    .eq("assignee_id", employeeId)
    .is("task.archived_at", null)
    .is("completed_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const task = (Array.isArray(row.task) ? row.task[0] : row.task) as
      | { task_code: string | null; title: string; project_id: string | null; project: unknown }
      | null;
    const rawProject = task?.project ?? null;
    const project = Array.isArray(rawProject)
      ? ((rawProject[0] ?? null) as { id: string; name: string; status: string } | null)
      : (rawProject as { id: string; name: string; status: string } | null);
    // Skip activities on archived-project tasks (dropped clients).
    if (project && project.status === "archived") return [];

    return [{
      id: row.id as string,
      task_id: row.task_id as string,
      task_code: task?.task_code ?? null,
      task_title: task?.title ?? "—",
      project_id: project?.id ?? null,
      project_name: project?.name ?? null,
      activity_type: row.activity_type as string,
      summary: row.summary as string,
      due_date: (row.due_date as string | null) ?? null,
      completed_at: null,
      created_at: row.created_at as string,
    }];
  });
}

export const listMyOpenActivities = cache(_listMyOpenActivities);

// Sky Light's `task_activities` table is essentially empty (Odoo never synced
// mail.activity rows), so a pure-activities calendar reads blank. The real,
// dense per-employee schedule lives in `tasks.planned_date` (the upload/work
// deadline — `due_date` is unused/empty across the whole org). This loader
// returns the employee's open tasks AS calendar rows (mapped into the same
// MyActivityRow shape) so /my-activities renders the deadlines they actually
// have. Deduped by task (an employee can hold multiple assignee rows per task).
export async function listMyTaskDeadlines(
  orgId: string,
  employeeId: string,
): Promise<MyActivityRow[]> {
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(`
      task:tasks!inner (
        id,
        task_code,
        title,
        planned_date,
        due_date,
        stage,
        archived_at,
        project_id,
        project:projects ( id, name, status )
      )
    `)
    .eq("organization_id", orgId)
    .eq("employee_id", employeeId)
    .neq("task.stage", "done")
    // Exclude archived tasks (mirrors the cockpit's getMyWork) and tasks that
    // belong to archived projects — Sky Light feedback: /my-activities was
    // surfacing scheduled work for clients dropped long ago (their projects
    // are archived but the planned_date deadlines lingered here).
    .is("task.archived_at", null)
    .not("task.planned_date", "is", null)
    .limit(800);

  if (error) throw error;

  const seen = new Set<string>();
  const rows: MyActivityRow[] = [];
  for (const r of data ?? []) {
    const t = (Array.isArray(r.task) ? r.task[0] : r.task) as
      | {
          id: string;
          task_code: string | null;
          title: string;
          planned_date: string | null;
          due_date: string | null;
          project_id: string | null;
          project: unknown;
        }
      | null;
    if (!t || seen.has(t.id)) continue;
    const rawProject = (t.project ?? null) as unknown;
    const project = Array.isArray(rawProject)
      ? ((rawProject[0] ?? null) as { id: string; name: string; status: string } | null)
      : (rawProject as { id: string; name: string; status: string } | null);
    // Drop tasks whose project is archived (dropped/lost clients). Tasks with
    // no project are kept (personal/unlinked work).
    if (project && project.status === "archived") continue;
    seen.add(t.id);
    const due = t.planned_date ?? t.due_date ?? null;
    rows.push({
      id: `task-${t.id}`,
      task_id: t.id,
      task_code: t.task_code ?? null,
      task_title: t.title ?? "—",
      project_id: project?.id ?? null,
      project_name: project?.name ?? null,
      activity_type: "task",
      summary: t.title ?? "—",
      due_date: due,
      completed_at: null,
      created_at: due ?? "",
    });
  }

  // Also include tasks the employee COMPLETED in the last 30 days. The open
  // query above filters out stage=done, so finished work never appeared and
  // the "مكتملة (آخر 30 يوم)" tile read 0 even when Odoo showed June closures
  // (Sky Light feedback). `actual_done_date` (0059) is populated on every done
  // task — the most reliable completion date — so we land them on the calendar
  // on their completion day with a ✓ and count them as completed.
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffYmd = cutoffDate.toISOString().slice(0, 10);

  const { data: doneData, error: doneError } = await supabaseAdmin
    .from("task_assignees")
    .select(`
      task:tasks!inner (
        id,
        task_code,
        title,
        completed_at,
        actual_done_date,
        archived_at,
        project_id,
        project:projects ( id, name, status )
      )
    `)
    .eq("organization_id", orgId)
    .eq("employee_id", employeeId)
    .eq("task.stage", "done")
    .is("task.archived_at", null)
    .gte("task.actual_done_date", cutoffYmd)
    .limit(500);

  if (doneError) throw doneError;

  for (const r of doneData ?? []) {
    const t = (Array.isArray(r.task) ? r.task[0] : r.task) as
      | {
          id: string;
          task_code: string | null;
          title: string;
          completed_at: string | null;
          actual_done_date: string | null;
          project_id: string | null;
          project: unknown;
        }
      | null;
    if (!t || seen.has(t.id)) continue;
    const rawProject = (t.project ?? null) as unknown;
    const project = Array.isArray(rawProject)
      ? ((rawProject[0] ?? null) as { id: string; name: string; status: string } | null)
      : (rawProject as { id: string; name: string; status: string } | null);
    if (project && project.status === "archived") continue;
    seen.add(t.id);
    const doneOn = t.actual_done_date ?? (t.completed_at ? t.completed_at.slice(0, 10) : null);
    rows.push({
      id: `task-${t.id}`,
      task_id: t.id,
      task_code: t.task_code ?? null,
      task_title: t.title ?? "—",
      project_id: project?.id ?? null,
      project_name: project?.name ?? null,
      activity_type: "task",
      summary: t.title ?? "—",
      due_date: doneOn,
      completed_at: t.completed_at ?? (doneOn ? `${doneOn}T00:00:00+00:00` : null),
      created_at: doneOn ?? "",
    });
  }

  return rows;
}
