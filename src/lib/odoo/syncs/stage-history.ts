// Mirror Odoo `task.stage.time` rows into public.task_stage_history.
// Idempotent: deletes-then-inserts the history for each task batch.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { OdooClient } from "@/lib/odoo/client";

// Stage-name map. The Sky Light Odoo deployment has 178 stages total — most
// of them are personal mail-style buckets (Inbox/Today/This Week/Later) that
// we intentionally skip. What we care about is the project workflow, which
// the team labels in BOTH English (legacy boards) and Arabic (production
// boards). Both keys are required: probe results show the bulk of live
// task.stage.time rows reference the Arabic stage ids.
const ODOO_STAGE_NAME_TO_DASHBOARD: Record<string, string> = {
  // English workflow stages
  New: "new",
  "In Progress": "in_progress",
  "Manager Review": "manager_review",
  "Specialist Review": "specialist_review",
  "Ready to Send": "ready_to_send",
  "Sent to Client": "sent_to_client",
  "Client Changes": "client_changes",
  Done: "done",
  done: "done", // lowercase variant seen in live data
  // Arabic workflow stages (the active boards)
  "جديد": "new",
  "جاري العمل": "in_progress",
  "مراجعة المسؤول": "manager_review",
  "تحت المراجعه": "specialist_review",
  "جاهزة للارسال": "ready_to_send",
  "تم الارسال للعميل": "sent_to_client",
  "تعديلات العميل": "client_changes",
  "تم الاعتماد": "done",
};

export type StageHistorySyncResult = {
  imported: number;
  skipped: number;
  tasksProcessed: number;
};

export async function syncStageHistory(
  odoo: OdooClient,
  orgSlug: string,
  opts: { log?: boolean } = {},
): Promise<StageHistorySyncResult> {
  const log = opts.log ?? false;
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();
  if (!org) throw new Error(`org ${orgSlug} not found`);
  const orgId = org.id as string;

  const taskMap = new Map<number, string>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data: tasks, error } = await supabaseAdmin
      .from("tasks")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("external_source", "odoo")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!tasks || tasks.length === 0) break;
    for (const t of tasks) {
      if (t.external_id) {
        const n = Number(t.external_id);
        if (Number.isFinite(n)) taskMap.set(n, t.id as string);
      }
    }
    if (tasks.length < PAGE) break;
  }
  if (log) console.log(`[stage-history] mapped ${taskMap.size} tasks`);

  type OdooStage = { id: number; name: string };
  const stages = await odoo.searchRead<OdooStage>(
    "project.task.type",
    [],
    ["id", "name"],
    { limit: 1000 },
  );
  const stageEnumById = new Map<number, string>();
  for (const s of stages) {
    const e = ODOO_STAGE_NAME_TO_DASHBOARD[s.name?.trim()];
    if (e) stageEnumById.set(s.id, e);
  }

  type OdooStageTime = {
    id: number;
    task_id: [number, string] | false;
    stage_id: [number, string] | false;
    stage_in_date: string | false;
    stage_out_date: string | false;
    total_duration_seconds: number | false;
  };

  const taskIds = Array.from(taskMap.keys());
  const CHUNK = 500;
  let imported = 0;
  let skipped = 0;
  let tasksProcessed = 0;

  for (let i = 0; i < taskIds.length; i += CHUNK) {
    const slice = taskIds.slice(i, i + CHUNK);
    tasksProcessed += slice.length;
    const rows = await odoo.searchRead<OdooStageTime>(
      "task.stage.time",
      [["task_id", "in", slice]],
      ["id", "task_id", "stage_id", "stage_in_date", "stage_out_date", "total_duration_seconds"],
      { limit: 10000, order: "task_id, stage_in_date" },
    );
    if (rows.length === 0) continue;

    // Rows arrive ordered by (task_id, stage_in_date), so for each task the
    // first row is the genuine creation (from_stage = null) and every later
    // row's from_stage is the previous row's stage. Without this chaining
    // every transition would land with from_stage = null and the activity
    // feed would render each one as a duplicate "task created" event.
    const prevStageByTask = new Map<string, string>();
    const upserts = rows
      .map((r) => {
        const tid = Array.isArray(r.task_id) ? r.task_id[0] : null;
        const sid = Array.isArray(r.stage_id) ? r.stage_id[0] : null;
        if (!tid || !sid) return null;
        const taskUuid = taskMap.get(tid);
        const stageEnum = stageEnumById.get(sid);
        if (!taskUuid || !stageEnum) {
          skipped++;
          return null;
        }
        const enteredAt = typeof r.stage_in_date === "string" ? r.stage_in_date : null;
        const exitedAt = typeof r.stage_out_date === "string" ? r.stage_out_date : null;
        if (!enteredAt) return null;
        const fromStage = prevStageByTask.get(taskUuid) ?? null;
        prevStageByTask.set(taskUuid, stageEnum);
        return {
          organization_id: orgId,
          task_id: taskUuid,
          from_stage: fromStage,
          to_stage: stageEnum,
          entered_at: enteredAt,
          exited_at: exitedAt,
          duration_seconds:
            typeof r.total_duration_seconds === "number"
              ? Math.round(r.total_duration_seconds)
              : null,
          moved_by: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (upserts.length === 0) continue;
    const taskUuids = Array.from(new Set(upserts.map((u) => u.task_id)));

    const { error: delErr } = await supabaseAdmin
      .from("task_stage_history")
      .delete()
      .in("task_id", taskUuids);
    if (delErr) {
      if (log) console.warn(`[stage-history] delete chunk @${i}: ${delErr.message}`);
      continue;
    }

    const BATCH = 500;
    for (let j = 0; j < upserts.length; j += BATCH) {
      const batch = upserts.slice(j, j + BATCH);
      const { error } = await supabaseAdmin
        .from("task_stage_history")
        .insert(batch);
      if (error) {
        if (log) console.warn(`[stage-history] insert chunk @${i}/${j}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }
  }

  if (log) console.log(`[stage-history] DONE — ${imported} inserted, ${skipped} skipped`);
  return { imported, skipped, tasksProcessed };
}
