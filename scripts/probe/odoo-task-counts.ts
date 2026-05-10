// Sample task rows from Odoo to understand what design_count and
// closed_subtask_count actually carry on Sky Light's data.
import { OdooClient } from "@/lib/odoo/client";

const cfg = {
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
};
const c = new OdooClient(cfg);
await c.authenticate();

type Row = {
  id: number;
  name: string;
  display_name: string;
  design_count?: number;
  closed_subtask_count?: number;
  subtask_count?: number;
  child_ids?: number[];
};

// Pull a healthy sample of recent tasks across projects.
const rows = await c.searchRead<Row>(
  "project.task",
  [["active", "=", true]],
  ["id", "name", "display_name", "design_count", "closed_subtask_count", "subtask_count", "child_ids"],
  { limit: 80, order: "id desc" },
);
console.log(JSON.stringify({
  event: "sample",
  total_pulled: rows.length,
  with_design: rows.filter(r => (r.design_count ?? 0) > 0).length,
  with_closed_subtasks: rows.filter(r => (r.closed_subtask_count ?? 0) > 0).length,
  design_max: Math.max(...rows.map(r => r.design_count ?? 0)),
  edits_max: Math.max(...rows.map(r => r.closed_subtask_count ?? 0)),
}, null, 2));

const hits = rows.filter(r => (r.design_count ?? 0) > 0 || (r.closed_subtask_count ?? 0) > 0).slice(0, 12);
console.log(JSON.stringify(hits, null, 2));

// Cross-check: count rows globally with design_count > 0.
const totalWithDesign = await c.executeKw<number>(
  "project.task",
  "search_count",
  [[["design_count", ">", 0]]],
  {},
);
const totalWithEdits = await c.executeKw<number>(
  "project.task",
  "search_count",
  [[["closed_subtask_count", ">", 0]]],
  {},
);
console.log(JSON.stringify({ event: "global_counts", total_with_design: totalWithDesign, total_with_closed_subtasks: totalWithEdits }, null, 2));
