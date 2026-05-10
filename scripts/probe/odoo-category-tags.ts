// Probe Sky Light's Odoo to understand category_id + tag_ids on
// project.project and project.task. Dumps the catalog and prevalence so we
// know whether the team's "multi-package" feedback (#12) maps to:
//   (a) project.category (1-N) + project.tags (M-N)
//   (b) some other field we haven't surfaced yet.
import { OdooClient } from "@/lib/odoo/client";

const cfg = {
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
};
const c = new OdooClient(cfg);
await c.authenticate();

// 1. Categories on project.project (or project.category if it's a separate model).
const ppFields = await c.executeKw<Record<string, { type: string; relation?: string; string?: string }>>(
  "project.project",
  "fields_get",
  [],
  { attributes: ["type", "relation", "string"] },
);
const interesting = Object.entries(ppFields)
  .filter(([k]) => /(category|tag|package)/i.test(k))
  .map(([k, v]) => ({ field: k, ...v }));
console.log(JSON.stringify({ event: "project_fields_categorical", interesting }, null, 2));

// 2. List the project.category catalog if the model exists.
try {
  const cats = await c.searchRead<{ id: number; name: string; project_count?: number }>(
    "project.category",
    [],
    ["id", "name"],
    { limit: 50, order: "name" },
  );
  console.log(JSON.stringify({ event: "project_category_catalog", count: cats.length, cats: cats.slice(0, 30) }, null, 2));
} catch (e) {
  console.log("no project.category model:", (e as Error).message);
}

// 3. Tags catalog on project.task (project.tags is the stock Odoo model).
try {
  const tags = await c.searchRead<{ id: number; name: string; color?: number }>(
    "project.tags",
    [],
    ["id", "name", "color"],
    { limit: 60, order: "name" },
  );
  console.log(JSON.stringify({ event: "project_tags_catalog", count: tags.length, tags: tags.slice(0, 40) }, null, 2));
} catch (e) {
  console.log("no project.tags model:", (e as Error).message);
}

// 4. How many projects have a non-null category_id? Sample which categories.
try {
  const ptFields = await c.executeKw<Record<string, { type: string; relation?: string }>>(
    "project.project",
    "fields_get",
    [["category_id"]],
    { attributes: ["type", "relation"] },
  );
  if (ptFields.category_id) {
    const total = await c.executeKw<number>("project.project", "search_count", [[]], {});
    const withCat = await c.executeKw<number>(
      "project.project",
      "search_count",
      [[["category_id", "!=", false]]],
      {},
    );
    const sample = await c.searchRead<{
      id: number;
      name: string;
      category_id: [number, string] | false;
      tag_ids: number[];
    }>(
      "project.project",
      [["category_id", "!=", false]],
      ["id", "name", "category_id", "tag_ids"],
      { limit: 8 },
    );
    console.log(JSON.stringify({ event: "project_category_usage", total, with_category: withCat, sample }, null, 2));
  }
} catch (e) {
  console.log("category_id usage probe failed:", (e as Error).message);
}
