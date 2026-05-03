"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type ToggleResult = { ok: true; granted: boolean } | { error: string };

/**
 * Grants or revokes a single (role, permission) binding.
 * Owner role is the implicit super-user (see auth-server.ts:isOwner) and
 * cannot have its permissions toggled — the matrix shows it as fully checked
 * but doesn't write to role_permissions for it.
 */
export async function toggleRolePermissionAction(input: {
  roleId: string;
  permissionId: string;
  grant: boolean;
}): Promise<ToggleResult> {
  let session;
  try {
    session = await requirePermission("settings.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Verify role + permission belong to this org / are real, and that the
  // role is not the owner role (which is the super-user and bypasses
  // role_permissions entirely).
  const { data: role } = await supabaseAdmin
    .from("roles")
    .select("id, key, organization_id")
    .eq("id", input.roleId)
    .maybeSingle();
  if (!role || role.organization_id !== session.orgId) {
    return { error: "الدور غير موجود" };
  }
  if (role.key === "owner") {
    return { error: "لا يمكن تعديل صلاحيات دور المالك (يملك كل الصلاحيات تلقائيًا)" };
  }

  const { data: perm } = await supabaseAdmin
    .from("permissions")
    .select("id, key")
    .eq("id", input.permissionId)
    .maybeSingle();
  if (!perm) return { error: "الصلاحية غير موجودة" };

  if (input.grant) {
    const { error } = await supabaseAdmin
      .from("role_permissions")
      .upsert(
        { role_id: input.roleId, permission_id: input.permissionId },
        { onConflict: "role_id,permission_id" },
      );
    if (error) return { error: error.message };
  } else {
    const { error } = await supabaseAdmin
      .from("role_permissions")
      .delete()
      .eq("role_id", input.roleId)
      .eq("permission_id", input.permissionId);
    if (error) return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: input.grant ? "role_permission.grant" : "role_permission.revoke",
    entityType: "role",
    entityId: input.roleId,
    metadata: { permission_key: perm.key, role_key: role.key },
  });

  revalidatePath("/organization/roles");
  return { ok: true, granted: input.grant };
}
