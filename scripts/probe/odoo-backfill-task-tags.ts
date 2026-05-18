#!/usr/bin/env bun
// One-shot backfill for the two newly-synced Odoo task fields (migration 0115):
//   • tasks.is_important     ← project.task.ks_mark_important
//   • task_tag_assignments   ← project.task.tag_ids
// Idempotent. The hourly importer keeps them current going forward; this just
// populates existing rows now. Run:
//   bun --env-file=.env.local scripts/probe/odoo-backfill-task-tags.ts

import { supabaseAdmin } from "@/lib/supabase/admin";
import { odooFromEnv } from "@/lib/odoo/client";

const slug = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "rawasm-demo";

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .maybeSingle();
if (!org) throw new Error(`org not found: ${slug}`);
const orgId = org.id as string;

const odoo = odooFromEnv();
await odoo.authenticate();

type OdooTaskRow = { id: number; tag_ids: number[]; ks_mark_important: boolean };
const odooTasks = await odoo.searchRead<OdooTaskRow>(
  "project.task",
  [],
  ["id", "tag_ids", "ks_mark_important"],
  { limit: 50000, context: { active_test: false } },
);
console.log(`[backfill] odoo tasks: ${odooTasks.length}`);

// Supabase tasks: external_id → uuid (paged).
const taskByExt = new Map<number, string>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", "odoo")
    .range(from, from + 999);
  if (error) throw error;
  if (!data || data.length === 0) break;
  for (const r of data) {
    const ext = Number(r.external_id);
    if (Number.isFinite(ext)) taskByExt.set(ext, r.id as string);
  }
  if (data.length < 1000) break;
}
console.log(`[backfill] supabase odoo-tasks: ${taskByExt.size}`);

// project_tags: external_id → uuid.
const tagByExt = new Map<number, string>();
{
  const { data } = await supabaseAdmin
    .from("project_tags")
    .select("id, external_id")
    .eq("organization_id", orgId);
  for (const r of data ?? []) {
    const ext = Number(r.external_id);
    if (Number.isFinite(ext)) tagByExt.set(ext, r.id as string);
  }
}
console.log(`[backfill] project_tags: ${tagByExt.size}`);

// 1) is_important — only the `true` rows need writing (column defaults false).
const importantIds: string[] = [];
for (const t of odooTasks) {
  const uuid = taskByExt.get(t.id);
  if (uuid && t.ks_mark_important === true) importantIds.push(uuid);
}
for (let i = 0; i < importantIds.length; i += 500) {
  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ is_important: true })
    .in("id", importantIds.slice(i, i + 500));
  if (error) console.warn(`[backfill] is_important: ${error.message}`);
}
console.log(`[backfill] is_important=true set on ${importantIds.length} tasks`);

// 2) task_tag_assignments — wipe + reinsert.
const taskUuids = [...taskByExt.values()];
for (let i = 0; i < taskUuids.length; i += 500) {
  const { error } = await supabaseAdmin
    .from("task_tag_assignments")
    .delete()
    .in("task_id", taskUuids.slice(i, i + 500));
  if (error) console.warn(`[backfill] tag delete: ${error.message}`);
}
const tagInserts: { organization_id: string; task_id: string; tag_id: string }[] = [];
for (const t of odooTasks) {
  const uuid = taskByExt.get(t.id);
  if (!uuid) continue;
  for (const odooTagId of Array.isArray(t.tag_ids) ? t.tag_ids : []) {
    const tagUuid = tagByExt.get(odooTagId);
    if (tagUuid) tagInserts.push({ organization_id: orgId, task_id: uuid, tag_id: tagUuid });
  }
}
let inserted = 0;
for (let i = 0; i < tagInserts.length; i += 500) {
  const slice = tagInserts.slice(i, i + 500);
  const { error } = await supabaseAdmin.from("task_tag_assignments").insert(slice);
  if (error) console.warn(`[backfill] tag insert: ${error.message}`);
  else inserted += slice.length;
}
console.log(`[backfill] task_tag_assignments inserted: ${inserted}`);
console.log("[backfill] done.");
