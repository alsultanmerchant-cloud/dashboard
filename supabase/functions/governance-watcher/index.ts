// Phase T6 — Governance Watcher edge function.
//
// Cron: daily at 06:00 Asia/Riyadh (set externally via supabase scheduler
// or pg_cron — NOT yet deployed; spec'd here so the contract is checked
// in alongside the SQL).
//
// For every organization, two passes:
//
//   1. missing_log_note —
//        Tasks where stage != 'done' AND no `task_comments` row in the
//        last 7 days. Skip if an open governance_violations row of the
//        same kind already exists for the task.
//
//   2. unowned_task —
//        Tasks where stage != 'done' AND there is no `task_assignees`
//        row at all. Skip if an open governance_violations row of the
//        same kind already exists for the task.
//
// Idempotency: the per-task / per-kind dedupe lookup means re-running the
// watcher within the same day (or after a partial failure) does NOT
// produce duplicates. Resolved rows are NOT counted as duplicates — once
// a head closes a violation and the underlying gap is still present at
// the next daily run, a fresh row is opened.
//
// Mirror logging style of supabase/functions/sla-watcher/index.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type TaskRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  stage: string;
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function loadOpenTasksByOrg(orgId: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, organization_id, project_id, stage")
    .eq("organization_id", orgId)
    .neq("stage", "done");
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

async function hasOpenViolation(
  taskId: string,
  kind: "missing_log_note" | "unowned_task",
): Promise<boolean> {
  const { data, error } = await supabase
    .from("governance_violations")
    .select("id")
    .eq("task_id", taskId)
    .eq("kind", kind)
    .is("resolved_at", null)
    .limit(1);
  if (error) {
    console.error("[governance-watcher] dedupe lookup failed", error.message);
    return true; // fail-closed: don't double-write on read errors
  }
  return (data ?? []).length > 0;
}

async function hasRecentComment(taskId: string, sinceIso: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("task_comments")
    .select("id")
    .eq("task_id", taskId)
    .gte("created_at", sinceIso)
    .limit(1);
  if (error) {
    console.error("[governance-watcher] comments lookup failed", error.message);
    return true; // fail-closed
  }
  return (data ?? []).length > 0;
}

async function hasAnyAssignee(taskId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("task_id", taskId)
    .limit(1);
  if (error) {
    console.error("[governance-watcher] assignees lookup failed", error.message);
    return true; // fail-closed
  }
  return (data ?? []).length > 0;
}

async function insertViolation(
  task: TaskRow,
  kind: "missing_log_note" | "unowned_task",
  note: string,
): Promise<boolean> {
  const { error } = await supabase.from("governance_violations").insert({
    organization_id: task.organization_id,
    kind,
    task_id: task.id,
    project_id: task.project_id,
    note,
  });
  if (error) {
    console.error(
      "[governance-watcher] insert failed",
      task.id,
      kind,
      error.message,
    );
    return false;
  }
  return true;
}

async function processOrg(orgId: string) {
  const tasks = await loadOpenTasksByOrg(orgId);
  const cutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  let missingLogNote = 0;
  let unownedTask = 0;

  for (const task of tasks) {
    // 1. missing_log_note
    try {
      if (!(await hasOpenViolation(task.id, "missing_log_note"))) {
        if (!(await hasRecentComment(task.id, cutoffIso))) {
          const ok = await insertViolation(
            task,
            "missing_log_note",
            "لا توجد ملاحظة (Log Note) خلال آخر 7 أيام",
          );
          if (ok) missingLogNote += 1;
        }
      }
    } catch (e) {
      console.error("[governance-watcher] missing_log_note failed", task.id, (e as Error).message);
    }

    // 2. unowned_task
    try {
      if (!(await hasOpenViolation(task.id, "unowned_task"))) {
        if (!(await hasAnyAssignee(task.id))) {
          const ok = await insertViolation(
            task,
            "unowned_task",
            "لا يوجد منفّذ مُسنَد للمهمة",
          );
          if (ok) unownedTask += 1;
        }
      }
    } catch (e) {
      console.error("[governance-watcher] unowned_task failed", task.id, (e as Error).message);
    }
  }

  return { orgId, taskCount: tasks.length, missingLogNote, unownedTask };
}

async function run() {
  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id");
  if (error) throw error;

  const results = [];
  for (const org of orgs ?? []) {
    try {
      results.push(await processOrg(org.id));
    } catch (e) {
      console.error("[governance-watcher] org failed", org.id, (e as Error).message);
    }
  }
  return { orgs: results };
}

Deno.serve(async () => {
  try {
    const result = await run();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
