// Extract Python/XML source files of an installed module by reading
// ir.module.module + ir.attachment (manifest+files are not stored in DB by
// default, but ir.model.data + ir.ui.view + ir.actions + python-defined fields
// can all be reconstructed). Best practical signal: dump the views, actions,
// scheduled crons, and overridden fields the module created.
import { OdooClient } from "@/lib/odoo/client";

const cfg = {
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
};
const c = new OdooClient(cfg);
await c.authenticate();

const module = process.argv[2] ?? "rwasem_project_notification";
console.log("module:", module);

type ModelData = { id: number; module: string; model: string; name: string; res_id: number; noupdate: boolean };
const refs = await c.searchRead<ModelData>(
  "ir.model.data",
  [["module", "=", module]],
  ["module", "model", "name", "res_id", "noupdate"],
  { limit: 200, order: "model, name" },
);
console.log(`\n${refs.length} ir.model.data refs`);
const byModel: Record<string, ModelData[]> = {};
for (const r of refs) (byModel[r.model] ??= []).push(r);
for (const m of Object.keys(byModel).sort()) {
  console.log(`  ${m}: ${byModel[m].length}`);
}

// Pull view arch for all ir.ui.view rows owned by the module.
const viewIds = (byModel["ir.ui.view"] ?? []).map((r) => r.res_id);
if (viewIds.length) {
  type ViewRow = { id: number; name: string; type: string; model: string; arch: string; inherit_id: [number, string] | false };
  const views = await c.executeKw<ViewRow[]>(
    "ir.ui.view",
    "read",
    [viewIds],
    { fields: ["id", "name", "type", "model", "arch", "inherit_id"] },
  );
  await Bun.write(`scripts/probe/out-${module}-views.json`, JSON.stringify(views, null, 2));
  console.log(`wrote out-${module}-views.json (${views.length} views)`);
}

// Pull crons + actions if any.
for (const m of ["ir.cron", "ir.actions.act_window", "ir.actions.server"]) {
  const ids = (byModel[m] ?? []).map((r) => r.res_id);
  if (!ids.length) continue;
  const rows = await c.executeKw<unknown[]>(m, "read", [ids], {});
  await Bun.write(`scripts/probe/out-${module}-${m.replace(/\./g, "_")}.json`, JSON.stringify(rows, null, 2));
  console.log(`wrote out-${module}-${m.replace(/\./g, "_")}.json (${rows.length})`);
}

// And dump fields the module added/overrode on any model.
type IrModelFields = { id: number; name: string; model: string; field_description: string; ttype: string; relation: string | false };
const ownedFieldRefs = (byModel["ir.model.fields"] ?? []).map((r) => r.res_id);
if (ownedFieldRefs.length) {
  const fields = await c.executeKw<IrModelFields[]>(
    "ir.model.fields",
    "read",
    [ownedFieldRefs],
    { fields: ["name", "model", "field_description", "ttype", "relation"] },
  );
  await Bun.write(`scripts/probe/out-${module}-fields.json`, JSON.stringify(fields, null, 2));
  console.log(`wrote out-${module}-fields.json (${fields.length})`);
}
