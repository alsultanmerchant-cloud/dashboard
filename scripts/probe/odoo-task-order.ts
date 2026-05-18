// Probe: how does Rwasem order tasks inside a kanban column?
// Fetch project 1539 (Rayana) active tasks in Odoo's DEFAULT order, grouped
// by stage, with the candidate sort fields.
// Run: bun --env-file=.env.local scripts/probe/odoo-task-order.ts
import { odooFromEnv } from "@/lib/odoo/client";

const c = odooFromEnv();
await c.authenticate();

// Odoo's model `_order` for project.task.
const meta = await c.executeKw<Record<string, unknown>>(
  "project.task",
  "fields_get",
  [["sequence"]],
  {},
);
console.log("sequence field meta:", JSON.stringify(meta));

type T = {
  id: number;
  name: string;
  sequence: number;
  stage_id: [number, string] | false;
  priority: string | false;
  date_deadline: string | false;
  write_date: string | false;
};
const rows = await c.searchRead<T>(
  "project.task",
  [["project_id", "=", 1539], ["active", "=", true]],
  ["id", "name", "sequence", "stage_id", "priority", "date_deadline", "write_date"],
  { limit: 200 },
);
const byStage = new Map<string, T[]>();
for (const t of rows) {
  const s = t.stage_id ? t.stage_id[1] : "(none)";
  (byStage.get(s) ?? byStage.set(s, []).get(s)!).push(t);
}
for (const [s, ts] of byStage) {
  console.log(`\n[${s}] — Odoo default order:`);
  for (const t of ts) {
    console.log(
      `  seq=${String(t.sequence).padStart(4)} pri=${t.priority || "-"} dl=${t.date_deadline || "------"} id=${t.id}  ${t.name.slice(0, 28)}`,
    );
  }
}
