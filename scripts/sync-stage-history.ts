#!/usr/bin/env bun
// Thin shim — sync logic lives in src/lib/odoo/syncs/stage-history.ts
// so it can also be invoked from the hourly cron route.

import { odooFromEnv } from "@/lib/odoo/client";
import { syncStageHistory } from "@/lib/odoo/syncs/stage-history";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();
const result = await syncStageHistory(odoo, slug, { log: true });
console.log(`[stage-history] result:`, result);
process.exit(0);
