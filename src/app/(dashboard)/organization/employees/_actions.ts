"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { EmployeeInviteSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { TASK_OWNER_ROLE_KEYS } from "@/lib/labels";

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
    position_id: formData.get("position_id"),
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

  // Resolve the picked position so job_title is stored as a display copy.
  let jobTitle: string | null = null;
  if (data.position_id) {
    const { data: pos } = await supabaseAdmin
      .from("positions")
      .select("name")
      .eq("organization_id", session.orgId)
      .eq("id", data.position_id)
      .maybeSingle();
    jobTitle = pos?.name ?? null;
  }

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
        position_id: data.position_id,
        job_title: jobTitle,
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

// =========================================================================
// Edit / soft-delete / restore / hard-delete actions for the owner-admin
// employee management page. All gated on `employees.manage`.
// =========================================================================

type ActionResult = { ok: true } | { error: string };

const UpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(2, "الاسم قصير جدًا").max(160),
  email: z.string().trim().email("بريد غير صالح").nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  position_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  manager_employee_id: z.string().uuid().nullable().optional(),
  team_leader_employee_id: z.string().uuid().nullable().optional(),
  department_head_employee_id: z.string().uuid().nullable().optional(),
});

export async function updateEmployeeAction(input: {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  positionId?: string | null;
  departmentId?: string | null;
  managerEmployeeId?: string | null;
  teamLeaderEmployeeId?: string | null;
  departmentHeadEmployeeId?: string | null;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = UpdateSchema.safeParse({
    id: input.id,
    full_name: input.fullName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    position_id: input.positionId ?? null,
    department_id: input.departmentId ?? null,
    manager_employee_id: input.managerEmployeeId ?? null,
    team_leader_employee_id: input.teamLeaderEmployeeId ?? null,
    department_head_employee_id: input.departmentHeadEmployeeId ?? null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  // Self-reference guard: can't be your own manager.
  if (parsed.data.manager_employee_id === parsed.data.id) {
    return { error: "لا يمكن أن يكون الموظف مديرًا لنفسه" };
  }
  // #11: can't be your own team leader. Deeper cycles are caught by the
  // trg_employee_team_leader_no_cycle trigger from migration 0120.
  if (parsed.data.team_leader_employee_id === parsed.data.id) {
    return { error: "لا يمكن أن يكون الموظف قائدًا لفريق نفسه" };
  }

  const { data: existing } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, organization_id, full_name, email")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!existing) return { error: "الموظف غير موجود" };

  // Resolve the picked position so job_title stays in sync as a display copy.
  // IMPORTANT: only touch position_id / job_title when a position was actually
  // picked in this edit. Many legacy rows (imported from Odoo) carry a
  // free-text job_title with position_id=null; blindly writing null here would
  // wipe their visible "المسمى" — which is exactly the bug Skylight hit.
  const updatePayload: Record<string, unknown> = {
    full_name: parsed.data.full_name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    department_id: parsed.data.department_id,
    manager_employee_id: parsed.data.manager_employee_id,
    team_leader_employee_id: parsed.data.team_leader_employee_id,
  };
  if (parsed.data.position_id) {
    const { data: pos } = await supabaseAdmin
      .from("positions")
      .select("id, name")
      .eq("organization_id", session.orgId)
      .eq("id", parsed.data.position_id)
      .maybeSingle();
    if (!pos) return { error: "المسمى الوظيفي غير موجود" };
    updatePayload.position_id = parsed.data.position_id;
    updatePayload.job_title = pos.name;
  }

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update(updatePayload)
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  // Department head lives on departments.head_employee_id — update it for the
  // employee's department when supplied. This re-points the head for the
  // whole department, not just this employee.
  let deptHeadChanged = false;
  if (parsed.data.department_id) {
    const { data: dept } = await supabaseAdmin
      .from("departments")
      .select("id, head_employee_id")
      .eq("organization_id", session.orgId)
      .eq("id", parsed.data.department_id)
      .maybeSingle();
    if (
      dept &&
      (dept.head_employee_id ?? null) !==
        (parsed.data.department_head_employee_id ?? null)
    ) {
      const { error: headErr } = await supabaseAdmin
        .from("departments")
        .update({ head_employee_id: parsed.data.department_head_employee_id })
        .eq("organization_id", session.orgId)
        .eq("id", parsed.data.department_id);
      if (headErr) return { error: headErr.message };
      deptHeadChanged = true;
    }
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "employee.update",
    entityType: "employee",
    entityId: parsed.data.id,
    metadata: {
      from: { full_name: existing.full_name, email: existing.email },
      to: { full_name: parsed.data.full_name, email: parsed.data.email },
      ...(deptHeadChanged
        ? {
            department_head_set: {
              department_id: parsed.data.department_id,
              head_employee_id: parsed.data.department_head_employee_id,
            },
          }
        : {}),
    },
  });

  revalidatePath("/organization/employees");
  if (deptHeadChanged) {
    revalidatePath("/organization/departments");
    revalidatePath("/organization/chart");
  }
  return { ok: true };
}

export async function terminateEmployeeAction(input: {
  id: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = z.string().uuid().safeParse(input.id);
  if (!parsed.success) return { error: "معرف غير صالح" };

  const { data: existing } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, employment_status")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (!existing) return { error: "الموظف غير موجود" };
  if (existing.employment_status === "terminated") {
    return { error: "هذا الموظف منتهي الخدمة بالفعل" };
  }

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ employment_status: "terminated" })
    .eq("id", parsed.data);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "employee.terminate",
    entityType: "employee",
    entityId: parsed.data,
    metadata: { full_name: existing.full_name },
  });

  revalidatePath("/organization/employees");
  return { ok: true };
}

export async function restoreEmployeeAction(input: {
  id: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = z.string().uuid().safeParse(input.id);
  if (!parsed.success) return { error: "معرف غير صالح" };

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ employment_status: "active" })
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "employee.restore",
    entityType: "employee",
    entityId: parsed.data,
    metadata: {},
  });

  revalidatePath("/organization/employees");
  return { ok: true };
}

// HARD delete — irreversible. UI must show typed-confirmation modal.
// Requires the caller to pass `confirmationName` equal to the employee's
// current `full_name` as a defensive measure even though RLS + permissions
// already gate this.
export async function hardDeleteEmployeeAction(input: {
  id: string;
  confirmationName: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = z.string().uuid().safeParse(input.id);
  if (!parsed.success) return { error: "معرف غير صالح" };

  const { data: existing } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, user_id")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (!existing) return { error: "الموظف غير موجود" };

  // Anti-typo guard: the caller must type the current full_name verbatim.
  if (input.confirmationName.trim() !== existing.full_name) {
    return { error: "اسم التأكيد لا يطابق اسم الموظف" };
  }

  // Self-protection: don't let the owner accidentally delete their own row.
  if (existing.user_id && existing.user_id === session.userId) {
    return { error: "لا يمكنك حذف ملفك الخاص" };
  }

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .delete()
    .eq("id", parsed.data);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "employee.hard_delete",
    entityType: "employee",
    entityId: parsed.data,
    metadata: { full_name: existing.full_name, user_id: existing.user_id },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "EMPLOYEE_HARD_DELETED",
    entityType: "employee",
    entityId: parsed.data,
    payload: { full_name: existing.full_name },
    importance: "high",
  });

  revalidatePath("/organization/employees");
  return { ok: true };
}

// Create a job-title position from the employee form combobox. Each position
// maps to one structural role; that role drives task auto-assignment. Returns
// the new (or already-existing, name-matched) position so the caller can
// select it immediately.
const CreatePositionSchema = z.object({
  name: z.string().trim().min(2, "المسمى قصير جدًا").max(80),
  role: z.enum(TASK_OWNER_ROLE_KEYS),
});

export type CreatePositionResult =
  | {
      ok: true;
      position: {
        id: string;
        slug: string;
        name: string;
        role: string;
        is_system: boolean;
      };
    }
  | { error: string };

export async function createPositionAction(input: {
  name: string;
  role: string;
}): Promise<CreatePositionResult> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreatePositionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Reuse an existing same-name position rather than creating a duplicate.
  const { data: existing } = await supabaseAdmin
    .from("positions")
    .select("id, slug, name, role, is_system")
    .eq("organization_id", session.orgId)
    .ilike("name", parsed.data.name)
    .maybeSingle();
  if (existing) return { ok: true, position: existing };

  const slug = `pos_${randomBytes(6).toString("hex")}`;
  const { data: created, error } = await supabaseAdmin
    .from("positions")
    .insert({
      organization_id: session.orgId,
      slug,
      name: parsed.data.name,
      role: parsed.data.role,
      is_system: false,
      created_by: session.userId,
    })
    .select("id, slug, name, role, is_system")
    .single();
  if (error || !created) {
    return { error: error?.message ?? "تعذر إنشاء المسمى" };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "position.create",
    entityType: "position",
    entityId: created.id,
    metadata: { name: created.name, role: created.role },
  });

  revalidatePath("/organization/employees");
  revalidatePath("/task-templates");
  return { ok: true, position: created };
}
