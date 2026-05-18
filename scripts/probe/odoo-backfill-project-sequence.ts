// One-shot backfill: copy Odoo `project.project.sequence` into the dashboard
// `projects.sequence` column (added in migration 0118) so the list order
// matches the Odoo kanban without waiting for a full `sync:odoo` run.
// Run: bun --env-file=.env.local scripts/probe/odoo-backfill-project-sequence.ts
import { odooFromEnv } from "@/lib/odoo/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const c = odooFromEnv();
await c.authenticate();

type Row = { id: number; sequence: number };
const rows = await c.searchRead<Row>(
  "project.project",
  [["active", "in", [true, false]]],
  ["id", "sequence"],
  { limit: 5000, context: { active_test: false } },
);
console.log(`[backfill] fetched ${rows.length} projects from Odoo`);

let updated = 0;
let missing = 0;
for (const r of rows) {
  const seq = typeof r.sequence === "number" ? r.sequence : 10;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?external_source=eq.odoo&external_id=eq.${r.id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ sequence: seq }),
    },
  );
  if (!res.ok) {
    console.error(`  project ${r.id}: HTTP ${res.status} ${await res.text()}`);
    continue;
  }
  const patched = (await res.json()) as unknown[];
  if (patched.length === 0) missing += 1;
  else updated += patched.length;
}
console.log(`[backfill] updated ${updated} rows, ${missing} Odoo projects had no dashboard match`);
