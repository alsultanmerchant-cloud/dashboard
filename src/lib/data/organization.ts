import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function listRolesWithPermissions(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("roles")
    .select("id, key, name, description, is_system, role_permissions ( permission:permissions ( id, key, description ) )")
    .eq("organization_id", orgId)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listAllPermissions() {
  const { data, error } = await supabaseAdmin
    .from("permissions")
    .select("id, key, description")
    .order("key");
  if (error) throw error;
  return data ?? [];
}

export async function listOrgRoleOptions(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("roles")
    .select("id, key, name")
    .eq("organization_id", orgId)
    .neq("key", "owner")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getEmployeeRoleAssignments(orgId: string, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { roleKey: string; roleName: string }[]>();
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role:roles ( key, name )")
    .eq("organization_id", orgId)
    .in("user_id", userIds);
  const map = new Map<string, { roleKey: string; roleName: string }[]>();
  for (const r of data ?? []) {
    const role = Array.isArray(r.role) ? r.role[0] : r.role;
    if (!role || !r.user_id) continue;
    if (!map.has(r.user_id)) map.set(r.user_id, []);
    map.get(r.user_id)!.push({ roleKey: role.key, roleName: role.name });
  }
  return map;
}
