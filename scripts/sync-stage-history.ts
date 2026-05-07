#!/usr/bin/env bun
// sync-stage-history.ts — mirror Odoo `task.stage.time` rows (34,910 live)
// into public.task_stage_history. Each Odoo row has stage_in_date,
// stage_out_date, total_duration_seconds and a stage_id; we fan out per
// stage entry into our table.
//
// Idempotent on (organization_id, task_id, from/to_stage, entered_at).

import { supabaseAdmin } from "@/lib/supabase/admin";
import { odooFromEnv } from "@/lib/odoo/client";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();
if (!org) throw new Error(`org ${slug} not found`);
const orgId = org.id as string;

// Map Odoo task id -> Supabase task uuid (paginated; .select() defaults to 1000)
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
console.log(`[stage-history] mapped ${taskMap.size} tasks`);

// Map Odoo stage_id -> dashboard task_stage enum value via stage name lookup.
type OdooStage = { id: number; name: string };
const stages = await odoo.searchRead<OdooStage>(
  "project.task.type",
  [],
  ["id", "name"],
  { limit: 1000 },
);
const ODOO_STAGE_NAME_TO_DASHBOARD: Record<string, string> = {
  New: "new",
  "In Progress": "in_progress",
  "Manager Review": "manager_review",
  "Specialist Review": "specialist_review",
  "Ready to Send": "ready_to_send",
  "Sent to Client": "sent_to_client",
  "Client Changes": "client_changes",
  Done: "done",
};
const stageEnumById = new Map<number, string>();
for (const s of stages) {
  const e = ODOO_STAGE_NAME_TO_DASHBOARD[s.name?.trim()];
  if (e) stageEnumById.set(s.id, e);
}
console.log(`[stage-history] mapped ${stageEnumById.size} stages with enum match`);

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

for (let i = 0; i < taskIds.length; i += CHUNK) {
  const slice = taskIds.slice(i, i + CHUNK);
  const rows = await odoo.searchRead<OdooStageTime>(
    "task.stage.time",
    [["task_id", "in", slice]],
    [
      "id", "task_id", "stage_id",
      "stage_in_date", "stage_out_date", "total_duration_seconds",
    ],
    { limit: 10000, order: "task_id, stage_in_date" },
  );
  if (rows.length === 0) continue;

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
      return {
        organization_id: orgId,
        task_id: taskUuid,
        from_stage: null,
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

  // Upsert in 200-row batches; conflict key is "task_id, to_stage, entered_at"
  // (we don't have a single unique index covering this combo, so use insert
  // ignore via on_conflict false). To keep idempotency on re-runs, delete
  // any existing rows for the slice's tasks first if and only if we have
  // matching re-import data — simplest correct approach is delete+insert
  // per task batch.
  const taskUuids = Array.from(new Set(upserts.map((u) => u.task_id)));

  // Wipe existing history for these tasks then insert fresh.
  const { error: delErr } = await supabaseAdmin
    .from("task_stage_history")
    .delete()
    .in("task_id", taskUuids);
  if (delErr) {
    console.warn(`[stage-history] delete chunk @${i}: ${delErr.message}`);
    continue;
  }

  const BATCH = 500;
  for (let j = 0; j < upserts.length; j += BATCH) {
    const batch = upserts.slice(j, j + BATCH);
    const { error } = await supabaseAdmin
      .from("task_stage_history")
      .insert(batch);
    if (error) {
      console.warn(`[stage-history] insert chunk @${i}/${j}: ${error.message}`);
    } else {
      imported += batch.length;
    }
  }
  console.log(
    `[stage-history] chunk ${i / CHUNK + 1}: tasks=${slice.length}, history rows=${upserts.length}, total inserted=${imported}`,
  );
}

console.log(`[stage-history] DONE — ${imported} rows inserted, ${skipped} skipped (no stage match)`);
process.exit(0);
