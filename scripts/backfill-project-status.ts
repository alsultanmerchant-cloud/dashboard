#!/usr/bin/env bun
// Re-derive projects.status from Odoo's active flag, undoing the over-eager
// privacy_visibility=portal archive rule. One-shot; safe to re-run.
import { odooFromEnv } from "@/lib/odoo/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const slug = process.argv[2] || "rawasm-demo";
const { data: org } = await supabaseAdmin
  .from("organizations").select("id").eq("slug", slug).single();
if (!org) { console.error("org not found"); process.exit(1); }
const orgId = org.id as string;

const odoo = odooFromEnv();
const rows = await odoo.searchRead<{ id: number; active: boolean }>(
  "project.project",
  [["active", "in", [true, false]]],
  ["id", "active"],
  { limit: 5000, context: { active_test: false } },
);
let toActive = 0, toArchived = 0;
for (const r of rows) {
  const status = r.active ? "active" : "archived";
  const { error, count } = await supabaseAdmin
    .from("projects")
    .update({ status }, { count: "exact" })
    .eq("organization_id", orgId)
    .eq("external_source", "odoo")
    .eq("external_id", String(r.id))
    .neq("status", status);
  if (error) { console.error(`project ${r.id}: ${error.message}`); continue; }
  if (count) {
    if (status === "active") toActive += count; else toArchived += count;
  }
}
console.log(`[status-backfill] -> active: ${toActive}, -> archived: ${toArchived}`);
