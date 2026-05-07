#!/usr/bin/env bun
// Probe selection values + rows that have dependencies set.
import { odooFromEnv } from "../src/lib/odoo/client";

async function main() {
  const odoo = odooFromEnv();
  await odoo.authenticate();

  const fields = await odoo.executeKw<Record<string, { type: string; selection?: [string, string][] }>>(
    "project.category.task",
    "fields_get",
    [["dependency_type", "priority", "workflow_type"]],
    { attributes: ["selection", "type"] },
  );
  console.log("dependency_type selection:", fields.dependency_type.selection);
  console.log("priority selection:        ", fields.priority.selection);
  console.log("workflow_type selection:   ", fields.workflow_type.selection);

  // How many have target_task_id or dependency_ids?
  const withTarget = await odoo.executeKw<number>(
    "project.category.task",
    "search_count",
    [[["target_task_id", "!=", false]]],
  );
  console.log("\nRows with target_task_id:", withTarget);

  const sample = await odoo.searchRead<Record<string, unknown>>(
    "project.category.task",
    [["target_task_id", "!=", false]],
    ["id", "name", "task_code", "target_task_id", "dependency_type", "lag_days", "dependency_ids"],
    { limit: 5 },
  );
  console.log("\nSample with target_task_id:");
  console.log(JSON.stringify(sample, null, 2));

  // How many have task_code set?
  const withCode = await odoo.executeKw<number>(
    "project.category.task",
    "search_count",
    [[["task_code", "!=", false]]],
  );
  console.log("\nRows with task_code:", withCode);

  // category_ids in use
  const catRows = await odoo.searchRead<{ id: number; project_categ_id: [number, string] | false }>(
    "project.category.task",
    [],
    ["id", "project_categ_id"],
    { limit: 1000 },
  );
  const cats = new Map<number, { name: string; count: number }>();
  for (const r of catRows) {
    if (!r.project_categ_id) continue;
    const [cid, cname] = r.project_categ_id;
    const cur = cats.get(cid) ?? { name: cname, count: 0 };
    cur.count += 1;
    cats.set(cid, cur);
  }
  console.log("\nCategory distribution:");
  for (const [cid, v] of [...cats.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  cat ${cid}  ×${v.count}  ${v.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
