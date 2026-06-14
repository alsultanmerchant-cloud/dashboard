import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Resolve the auth user ids holding one of the given role keys in an org.
// Recipients for org-level alerts (WhatsApp linking nudges, analysis alerts).
async function userIdsForRoles(orgId: string, roleKeys: string[]): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role:roles!inner(key)")
    .eq("organization_id", orgId)
    .in("role.key", roleKeys);
  const ids = new Set<string>();
  for (const r of (data ?? []) as Array<{ user_id: string | null }>) {
    if (r.user_id) ids.add(r.user_id);
  }
  return [...ids];
}

// Owner only (the historical behaviour for WA-linking nudges).
export function getOwnerUserIds(orgId: string): Promise<string[]> {
  return userIdsForRoles(orgId, ["owner"]);
}

// Owner + admin — recipients for analysis-driven executive alerts.
export function getOwnerAdminUserIds(orgId: string): Promise<string[]> {
  return userIdsForRoles(orgId, ["owner", "admin"]);
}
