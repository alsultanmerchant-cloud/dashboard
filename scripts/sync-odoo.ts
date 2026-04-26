#!/usr/bin/env bun
// One-shot Odoo → Supabase importer.
// Usage:
//   bun run scripts/sync-odoo.ts [org-slug]
// Defaults to NEXT_PUBLIC_DEFAULT_ORG_SLUG, then "rawasm-demo".

import { odooFromEnv } from "@/lib/odoo/client";
import { runImport } from "@/lib/odoo/importer";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

console.log(`[odoo-sync] target org: ${slug}`);
const odoo = odooFromEnv();
const summary = await runImport(odoo, slug);

console.log("[odoo-sync] summary:");
console.log(`  employees: ${summary.employees}`);
console.log(`  clients:   ${summary.clients}`);
console.log(`  projects:  ${summary.projects}`);
console.log(`  tasks:     ${summary.tasks}`);
if (summary.errors.length) {
  console.log("[odoo-sync] errors:");
  for (const e of summary.errors) console.log(`  - ${e}`);
  process.exit(1);
}
