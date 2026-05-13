#!/usr/bin/env bun
// Thin shim — sync logic lives in src/lib/odoo/syncs/attachments.ts.

import { odooFromEnv } from "@/lib/odoo/client";
import { syncAttachments } from "@/lib/odoo/syncs/attachments";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();
const result = await syncAttachments(odoo, slug, { log: true });
console.log(`[attachments] result:`, result);
process.exit(0);
