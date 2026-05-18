// One-shot probe: fetch active projects in Odoo's DEFAULT order (no `order`
// arg → model `_order`) plus the `sequence` field, so we can reproduce the
// kanban ordering in the dashboard.
// Run: bun --env-file=.env.local scripts/probe/odoo-project-order.ts
import { odooFromEnv } from "@/lib/odoo/client";

const c = odooFromEnv();
await c.authenticate();

type Row = { id: number; name: string; sequence: number };
const rows = await c.searchRead<Row>(
  "project.project",
  [["active", "=", true]],
  ["id", "name", "sequence"],
  { limit: 30 },
);
console.log("default-order (first 30):");
for (const r of rows) {
  console.log(`  seq=${String(r.sequence).padStart(4)} id=${r.id}  ${r.name}`);
}

const seqs = rows.map((r) => r.sequence);
const distinct = new Set(seqs);
console.log(`\nsequence values: ${distinct.size} distinct out of ${rows.length}`);
