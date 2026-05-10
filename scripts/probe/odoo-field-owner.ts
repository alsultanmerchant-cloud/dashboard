// Find which Odoo addon defined a given field on a given model.
import { OdooClient } from "@/lib/odoo/client";

const cfg = {
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
};
const c = new OdooClient(cfg);
await c.authenticate();

const model = process.argv[2] ?? "project.task";
const fieldName = process.argv[3] ?? "design_count";

type FieldRow = {
  id: number;
  name: string;
  field_description: string;
  ttype: string;
  modules: string;
  store: boolean;
  compute: string | false;
  related: string | false;
  depends: string | false;
};
const rows = await c.searchRead<FieldRow>(
  "ir.model.fields",
  [
    ["model", "=", model],
    ["name", "=", fieldName],
  ],
  ["name", "field_description", "ttype", "modules", "store", "compute", "related", "depends"],
  {},
);
console.log(JSON.stringify({ model, field: fieldName, rows }, null, 2));
