// One-shot probe: list installed rwasem_*/aptuem modules so we know what's
// actually live on Sky Light's Odoo, and dump task/project field metadata for
// the gap analysis. Run: bun --env-file=.env.local scripts/probe/odoo-rwasem.ts
import { OdooClient } from "@/lib/odoo/client";

const cfg = {
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
};
const c = new OdooClient(cfg);
const uid = await c.authenticate();
console.log(JSON.stringify({ event: "auth", uid, db: cfg.db, url: cfg.url }));

type Mod = { id: number; name: string; display_name: string; state: string };
const mods = await c.searchRead<Mod>(
  "ir.module.module",
  ["&", ["state", "=", "installed"], "|", ["name", "ilike", "rwasem"], ["name", "ilike", "aptuem"]],
  ["name", "display_name", "state"],
  { limit: 50, order: "name" },
);
console.log(JSON.stringify({ event: "rwasem_modules", count: mods.length, mods }, null, 2));

// Dump task/project field metadata so we can spot non-stock fields added by
// rwasem_*/aptuem addons (manual_progress, floor_id, designs_count, etc).
type FieldsGet = Record<
  string,
  { type: string; string?: string; relation?: string; selection?: unknown[] }
>;
async function dumpFields(model: string, outFile: string) {
  const all = await c.executeKw<FieldsGet>(model, "fields_get", [], {
    attributes: ["type", "string", "relation", "selection"],
  });
  await Bun.write(outFile, JSON.stringify(all, null, 2));
  return Object.keys(all).length;
}
const taskCount = await dumpFields("project.task", "scripts/probe/out-task-fields.json");
const projectCount = await dumpFields("project.project", "scripts/probe/out-project-fields.json");
console.log(
  JSON.stringify(
    { event: "fields_summary", task_field_count: taskCount, project_field_count: projectCount },
    null,
    2,
  ),
);
