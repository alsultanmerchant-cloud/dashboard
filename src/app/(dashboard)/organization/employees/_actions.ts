"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { EmployeeInviteSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

export type EmployeeInviteState = {
  ok?: true;
  employeeId?: string;
  generatedPassword?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

function generatePassword(): string {
  // 12-char URL-safe random (humans can copy/paste; rotate on first login).
  return randomBytes(9).toString("base64url");
}

export async function inviteEmployeeAction(
  _prev: EmployeeInviteState | undefined,
  formData: FormData,
): Promise<EmployeeInviteState> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = EmployeeInviteSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    job_title: formData.get("job_title"),
    department_id: formData.get("department_id"),
    role_id: formData.get("role_id"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }
  const data = parsed.data;

  // 1. Create or reuse auth.users
  const password = generatePassword();
  let authUserId: string | null = null;

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: data.full_name },
  });

  if (createErr) {
    // If email already exists, look up the user
    const isDup = createErr.message?.toLowerCase().includes("already") || createErr.status === 422;
    if (isDup) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const existing = list?.users?.find((u) => u.email === data.email);
      if (existing) {
        authUserId = existing.id;
        // Reset their password to the new generated one
        await supabaseAdmin.auth.admin.updateUserById(authUserId, { password });
      } else {
        return { error: createErr.message };
      }
    } else {
      return { error: createErr.message };
    }
  } else {
    authUserId = created.user.id;
  }
  if (!authUserId) return { error: "تعذر إنشاء حساب الوصول" };

  // 2. Upsert employee_profile
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("employee_profiles")
    .upsert(
      {
        organization_id: session.orgId,
        user_id: authUserId,
        department_id: data.department_id,
        full_name: data.full_name,
        email: data.email,
        phone: data.phone,
        job_title: data.job_title,
        employment_status: "active",
      },
      { onConflict: "organization_id,user_id" },
    )
    .select("id")
    .single();
  if (profileErr || !profile) {
    return { error: profileErr?.message ?? "تعذر إنشاء ملف الموظف" };
  }

  // 3. Assign role (single role for MVP; multi-role can be added later)
  await supabaseAdmin.from("user_roles").upsert(
    {
      organization_id: session.orgId,
      user_id: authUserId,
      role_id: data.role_id,
    },
    { onConflict: "organization_id,user_id,role_id", ignoreDuplicates: true },
  );

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "employee.invite",
    entityType: "employee",
    entityId: profile.id,
    metadata: { email: data.email, role_id: data.role_id, department_id: data.department_id },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "EMPLOYEE_INVITED",
    entityType: "employee",
    entityId: profile.id,
    payload: { email: data.email, role_id: data.role_id },
  });

  revalidatePath("/organization/employees");
  revalidatePath("/handover");
  revalidatePath("/projects");
  return { ok: true, employeeId: profile.id, generatedPassword: password };
}
