import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ServerSession = {
  userId: string;
  email: string;
  employeeId: string;
  orgId: string;
  fullName: string;
  roleKeys: string[];
  permissions: Set<string>;
  isOwner: boolean;
};

export const getServerSession = cache(async (): Promise<ServerSession | null> => {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: profile } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, organization_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!profile) return null;

  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role:roles ( key, role_permissions ( permission:permissions ( key ) ) )")
    .eq("user_id", data.user.id)
    .eq("organization_id", profile.organization_id);

  const roleKeys: string[] = [];
  const permissions = new Set<string>();
  for (const row of roleRows ?? []) {
    const role = Array.isArray(row.role) ? row.role[0] : row.role;
    if (!role) continue;
    roleKeys.push(role.key);
    for (const rp of role.role_permissions ?? []) {
      const perm = Array.isArray(rp.permission) ? rp.permission[0] : rp.permission;
      if (perm?.key) permissions.add(perm.key);
    }
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    employeeId: profile.id,
    orgId: profile.organization_id,
    fullName: profile.full_name,
    roleKeys,
    permissions,
    isOwner: roleKeys.includes("owner"),
  };
});

export async function requireSession(): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(perm: string): Promise<ServerSession> {
  const session = await requireSession();
  if (!session.isOwner && !session.permissions.has(perm)) {
    throw new Error(`صلاحية مفقودة: ${perm}`);
  }
  return session;
}

export function hasPermission(session: ServerSession, perm: string) {
  return session.isOwner || session.permissions.has(perm);
}
