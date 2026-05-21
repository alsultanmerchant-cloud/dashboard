#!/usr/bin/env bun
// One-shot backfill: pull project.project.task_count / open_task_count /
// closed_task_count from Odoo and write them to projects.odoo_*_count so the
// dashboard card matches Rwasem's number. Idempotent — safe to re-run.

import { odooFromEnv } from "@/lib/odoo/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SOURCE = "odoo";
const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();
if (!org) {
  console.error(`org ${slug} not found`);
  process.exit(1);
}
const orgId = org.id as string;

const odoo = odooFromEnv();

type Row = {
  id: number;
  task_count?: number;
  open_task_count?: number;
  closed_task_count?: number;
};

const rows = await odoo.searchRead<Row>(
  "project.project",
  [["active", "in", [true, false]]],
  ["id", "task_count", "open_task_count", "closed_task_count"],
  { limit: 5000, context: { active_test: false } },
);

console.log(`[backfill] pulled ${rows.length} projects from Odoo`);

let updated = 0;
for (const r of rows) {
  const { error, count } = await supabaseAdmin
    .from("projects")
    .update(
      {
        odoo_task_count: typeof r.task_count === "number" ? r.task_count : null,
        odoo_open_task_count:
          typeof r.open_task_count === "number" ? r.open_task_count : null,
        odoo_closed_task_count:
          typeof r.closed_task_count === "number" ? r.closed_task_count : null,
      },
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .eq("external_source", SOURCE)
    .eq("external_id", String(r.id));
  if (error) {
    console.error(`project ${r.id}: ${error.message}`);
    continue;
  }
  updated += count ?? 0;
}

console.log(`[backfill] updated ${updated} project rows`);
