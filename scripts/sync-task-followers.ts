#!/usr/bin/env bun
// Thin shim — sync logic lives in src/lib/odoo/syncs/task-followers.ts.

import { odooFromEnv } from "@/lib/odoo/client";
import { syncTaskFollowers } from "@/lib/odoo/syncs/task-followers";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();
const result = await syncTaskFollowers(odoo, slug, { log: true });
console.log(`[task-followers] result:`, result);
process.exit(0);
