#!/usr/bin/env bun
// sync-project-followers.ts — mirror Odoo mail.followers rows where
// res_model='project.project' into public.project_followers.
//
// Mapping path:
//   mail.followers.partner_id (res.partner.id)
//     → res.users.partner_id  (the user behind the partner, if any)
//     → employee_profiles.external_id (res.users.id we imported earlier)
//     → employee_profiles.id (uuid)
//
// Skips followers whose partner has no res.users (external partners /
// portal accounts can't be employees in our schema).

import { supabaseAdmin } from "@/lib/supabase/admin";
import { odooFromEnv } from "@/lib/odoo/client";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();
if (!org) throw new Error(`org ${slug} not found`);
const orgId = org.id as string;

// 1. Build odoo project id -> supabase project uuid map (paginated).
const projectMap = new Map<number, string>();
{
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("external_source", "odoo")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const p of data) {
      if (p.external_id) {
        const n = Number(p.external_id);
        if (Number.isFinite(n)) projectMap.set(n, p.id as string);
      }
    }
    if (data.length < PAGE) break;
  }
}
console.log(`[project-followers] mapped ${projectMap.size} projects`);

// 2. Build odoo res.users.id -> supabase employee_profiles.id map.
const employeeMap = new Map<number, string>();
{
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("external_source", "odoo")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const e of data) {
      if (e.external_id) {
        const n = Number(e.external_id);
        if (Number.isFinite(n)) employeeMap.set(n, e.id as string);
      }
    }
    if (data.length < PAGE) break;
  }
}
console.log(`[project-followers] mapped ${employeeMap.size} employees (res.users.id → uuid)`);

// 3. Fetch all res.users so we can resolve partner_id → user.id.
type OdooUser = { id: number; partner_id: [number, string] | false };
const users = await odoo.searchRead<OdooUser>(
  "res.users",
  [["share", "=", false]],
  ["id", "partner_id"],
  { limit: 1000 },
);
const partnerToUser = new Map<number, number>();
for (const u of users) {
  const pid = Array.isArray(u.partner_id) ? u.partner_id[0] : null;
  if (pid) partnerToUser.set(pid, u.id);
}
console.log(`[project-followers] partner→user map: ${partnerToUser.size}`);

// 4. Fetch followers in chunks per project (533 total live, well under 1000).
type Follower = {
  id: number;
  res_id: number;
  partner_id: [number, string] | false;
};
const projectIds = Array.from(projectMap.keys());
const CHUNK = 200;
let inserted = 0;
let skipped = 0;
for (let i = 0; i < projectIds.length; i += CHUNK) {
  const slice = projectIds.slice(i, i + CHUNK);
  const followers = await odoo.searchRead<Follower>(
    "mail.followers",
    [
      ["res_model", "=", "project.project"],
      ["res_id", "in", slice],
    ],
    ["id", "res_id", "partner_id"],
    { limit: 5000 },
  );
  if (followers.length === 0) continue;

  const rows = followers
    .map((f) => {
      const projectUuid = projectMap.get(f.res_id);
      if (!projectUuid) return null;
      const partnerId = Array.isArray(f.partner_id) ? f.partner_id[0] : null;
      if (!partnerId) return null;
      const userId = partnerToUser.get(partnerId);
      if (!userId) {
        // Follower's partner isn't backed by a res.users (likely portal /
        // external — Sky Light Operations 1, etc). Skip silently.
        skipped++;
        return null;
      }
      const employeeUuid = employeeMap.get(userId);
      if (!employeeUuid) {
        skipped++;
        return null;
      }
      return {
        organization_id: orgId,
        project_id: projectUuid,
        employee_id: employeeUuid,
        external_source: "odoo",
        external_id: String(f.id),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (rows.length === 0) continue;
  const { error } = await supabaseAdmin
    .from("project_followers")
    .upsert(rows, { onConflict: "organization_id,external_source,external_id" });
  if (error) {
    console.warn(`[project-followers] chunk @${i}: ${error.message}`);
  } else {
    inserted += rows.length;
    console.log(`[project-followers] chunk ${i / CHUNK + 1}: +${rows.length} (total ${inserted})`);
  }
}

console.log(
  `[project-followers] DONE — inserted=${inserted}, skipped=${skipped} (no employee mapping)`,
);
process.exit(0);
