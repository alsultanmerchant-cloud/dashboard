#!/usr/bin/env bun
// Odoo → Supabase importer, TASKS phase only.
// Usage: bun run scripts/sync-odoo-tasks.ts [org-slug]
//
// Runs just the `tasks` phase of runImport — it rehydrates the project ID
// maps from already-synced project rows, re-imports every project's tasks,
// and runs the delete-reconciliation pass (ghost + non-Odoo tasks). Use this
// when only task data needs refreshing without re-walking employees /
// clients / projects.
import { odooFromEnv } from "@/lib/odoo/client";
import { runImport } from "@/lib/odoo/importer";

const slug =
  process.argv[2] || process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "rawasm-demo";

console.log(`[odoo-sync] tasks-only sync for org: ${slug}`);
const odoo = odooFromEnv();
const summary = await runImport(odoo, slug, ["tasks"]);

console.log("[odoo-sync] summary:");
console.log(`  tasks:          ${summary.tasks}`);
console.log(`  task assignees: ${summary.taskAssignees}`);
if (summary.errors.length) {
  console.log("[odoo-sync] errors:");
  for (const e of summary.errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("[odoo-sync] done");
