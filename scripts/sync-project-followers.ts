#!/usr/bin/env bun
// Thin shim — sync logic lives in src/lib/odoo/syncs/project-followers.ts.

import { odooFromEnv } from "@/lib/odoo/client";
import { syncProjectFollowers } from "@/lib/odoo/syncs/project-followers";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();
const result = await syncProjectFollowers(odoo, slug, { log: true });
console.log(`[project-followers] result:`, result);
process.exit(0);
