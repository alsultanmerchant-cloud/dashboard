#!/usr/bin/env bun
// Thin shim — sync logic lives in src/lib/odoo/syncs/project-members.ts.

import { odooFromEnv } from "@/lib/odoo/client";
import { syncProjectMembers } from "@/lib/odoo/syncs/project-members";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();
const result = await syncProjectMembers(odoo, slug, { log: true });
console.log(`[project-members] result:`, result);
process.exit(0);
