#!/usr/bin/env bun
// One-shot backfill: pull project.task.create_date (real Odoo creation time)
// from Odoo and write it to tasks.source_created_at so the Executive-Indicators
// historical reconstruction (Overdue during-period / Projects at risk as-of)
// knows when each task actually existed — tasks.created_at is only the local
// sync time. Idempotent — safe to re-run. See migration 0239.
//
// Uses bulk `UPDATE ... FROM (VALUES ...)` via the Supabase Management API
// (fast + atomic per chunk) instead of 13k per-row PostgREST calls.

import { odooFromEnv } from "@/lib/odoo/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SOURCE = "odoo";
const slug =
  process.argv[2] || process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "rawasm-demo";

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  console.error("SUPABASE_ACCESS_TOKEN missing from env");
  process.exit(1);
}
const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)?.[1];
if (!ref) {
  console.error("could not derive project ref from NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}

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

async function runSql(query: string): Promise<void> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

const odoo = odooFromEnv();
type Row = { id: number; create_date?: string | false };
const rows = await odoo.searchRead<Row>(
  "project.task",
  [["active", "in", [true, false]]],
  ["id", "create_date"],
  { limit: 20000, context: { active_test: false } },
);
console.log(`[backfill] pulled ${rows.length} tasks from Odoo`);

const tuples = rows
  .filter((r) => typeof r.create_date === "string")
  .map(
    (r) => `('${String(r.id).replace(/'/g, "''")}','${(r.create_date as string).replace(/'/g, "''")}+00')`,
  );

const CHUNK = 2000;
let done = 0;
for (let i = 0; i < tuples.length; i += CHUNK) {
  const vals = tuples.slice(i, i + CHUNK).join(",");
  await runSql(
    `update public.tasks t set source_created_at = v.cd::timestamptz
     from (values ${vals}) as v(eid, cd)
     where t.external_id = v.eid and t.external_source = '${SOURCE}'
       and t.organization_id = '${orgId}';`,
  );
  done += Math.min(CHUNK, tuples.length - i);
  console.log(`[backfill] ${done}/${tuples.length}…`);
}
console.log(`[backfill] done — wrote source_created_at for ${tuples.length} tasks`);
