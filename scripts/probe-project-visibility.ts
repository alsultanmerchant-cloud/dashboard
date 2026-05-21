#!/usr/bin/env bun
import { odooFromEnv } from "@/lib/odoo/client";
const odoo = odooFromEnv();
const rows = await odoo.searchRead<{
  id: number;
  active: boolean;
  privacy_visibility: string | false;
}>(
  "project.project",
  [["active", "in", [true, false]]],
  ["id", "active", "privacy_visibility"],
  { limit: 5000, context: { active_test: false } },
);
const c: Record<string, number> = {};
for (const r of rows) {
  const k = `active=${r.active} priv=${String(r.privacy_visibility)}`;
  c[k] = (c[k] ?? 0) + 1;
}
console.log(c);
