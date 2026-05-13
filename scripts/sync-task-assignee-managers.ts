#!/usr/bin/env bun

import { syncTaskAssigneeManagers } from "@/lib/odoo/syncs/task-assignee-managers";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const result = await syncTaskAssigneeManagers(slug, { log: true });
console.log(`[task-assignee-managers] result:`, result);
process.exit(0);
