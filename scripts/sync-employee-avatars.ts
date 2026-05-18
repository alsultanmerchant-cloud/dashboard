#!/usr/bin/env bun
// Pull real avatar images from Odoo res.users and persist them into
// employee_profiles.avatar_url so task assignee/follower avatars do not rely
// on a public /web/image route.

import { odooFromEnv } from "@/lib/odoo/client";
import { fetchOdooUsersWithAvatars, odooAvatarDataUrl } from "@/lib/odoo/avatars";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SOURCE = "odoo";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

console.log(`[avatar-sync] target org: ${slug}`);

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();

if (!org) {
  console.error(`[avatar-sync] org not found: ${slug}`);
  process.exit(1);
}

const orgId = org.id as string;
const odoo = odooFromEnv();
const users = await fetchOdooUsersWithAvatars(odoo);
const odooBase = process.env.ODOO_URL?.replace(/\/+$/, "") ?? "";

const { data: profiles, error: profilesError } = await supabaseAdmin
  .from("employee_profiles")
  .select("id, external_id")
  .eq("organization_id", orgId)
  .eq("external_source", SOURCE);

if (profilesError) {
  console.error(`[avatar-sync] failed loading profiles: ${profilesError.message}`);
  process.exit(1);
}

const profileIdByExternalId = new Map<number, string>();
for (const profile of profiles ?? []) {
  if (profile.external_id == null) continue;
  profileIdByExternalId.set(Number(profile.external_id), profile.id as string);
}

let updated = 0;
let skipped = 0;

for (const user of users) {
  const profileId = profileIdByExternalId.get(user.id);
  if (!profileId) {
    skipped += 1;
    continue;
  }

  const avatarUrl =
    odooAvatarDataUrl(user) ??
    (odooBase ? `${odooBase}/web/image/res.users/${user.id}/avatar_1` : null);

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", profileId);

  if (error) {
    console.warn(`[avatar-sync] user ${user.id} (${user.name}): ${error.message}`);
    continue;
  }

  updated += 1;
}

console.log(`[avatar-sync] updated ${updated} employee_profiles`);
console.log(`[avatar-sync] skipped ${skipped} users without local employee_profiles row`);
