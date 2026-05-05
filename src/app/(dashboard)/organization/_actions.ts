"use server";

// Phase T1 — Org Realignment server actions.
//
// All four entry points are gated to the new permission
// `org.manage_structure` (seeded for owner + admin in migration 0021), zod
// validate their inputs, and emit both an audit_log row and an ai_event so
// the AI assistant can answer "who promoted X?" / "when was the SEO head
// changed?".

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

export type OrgActionState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string>;
};

const PositionEnum = z.enum(["head", "team_lead", "specialist", "agent", "admin"]);

const SetHeadSchema = z.object({
  departmentId: z.string().uuid("معرّف القسم غير صالح"),
  userId: z.string().uuid("معرّف المستخدم غير صالح").nullable(),
});

const TeamLeadSchema = z.object({
  departmentId: z.string().uuid("معرّف القسم غير صالح"),
  userId: z.string().uuid("معرّف المستخدم غير صالح"),
});

const SetPositionSchema = z.object({
  userId: z.string().uuid("معرّف المستخدم غير صالح"),
  position: PositionEnum.nullable(),
});

function flattenZodIssues(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path === "string") fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

/**
 * Set (or clear, when userId=null) the Head of a department. Resolves the
 * caller-supplied auth.user id to its employee_profile row and stores the
 * profile id on `head_employee_id` (the canonical column, FK to
 * employee_profiles, mirrors the existing manager_employee_id pattern).
 */
export async function setDepartmentHead(input: {
  departmentId: string;
  userId: string | null;
}): Promise<OrgActionState> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetHeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "تحقق من البيانات", fieldErrors: flattenZodIssues(parsed.error) };
  }

  // Confirm department belongs to caller's org (org-scope check).
  const { data: dept, error: deptErr } = await supabaseAdmin
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", parsed.data.departmentId)
    .maybeSingle();
  if (deptErr) return { error: deptErr.message };
  if (!dept || dept.organization_id !== session.orgId) {
    return { error: "القسم غير موجود في وكالتك" };
  }

  let employeeId: string | null = null;
  if (parsed.data.userId) {
    const { data: emp, error: empErr } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, organization_id")
      .eq("user_id", parsed.data.userId)
      .maybeSingle();
    if (empErr) return { error: empErr.message };
    if (!emp || emp.organization_id !== session.orgId) {
      return { error: "الموظف غير موجود في وكالتك" };
    }
    employeeId = emp.id;
  }

  const { error: updErr } = await supabaseAdmin
    .from("departments")
    .update({ head_employee_id: employeeId })
    .eq("id", parsed.data.departmentId);
  if (updErr) return { error: updErr.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.set_head",
    entityType: "department",
    entityId: parsed.data.departmentId,
    metadata: {
      department_name: dept.name,
      head_employee_id: employeeId,
      source_user_id: parsed.data.userId,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "ORG_HEAD_ASSIGNED",
    entityType: "department",
    entityId: parsed.data.departmentId,
    payload: {
      department_name: dept.name,
      head_employee_id: employeeId,
      cleared: parsed.data.userId === null,
    },
    importance: "normal",
  });

  revalidatePath("/organization/chart");
  revalidatePath(`/organization/departments/${parsed.data.departmentId}`);
  revalidatePath("/organization/departments");
  return { ok: true };
}

/** Add a Team Lead to a department (idempotent — on-conflict do nothing). */
export async function addTeamLead(input: {
  departmentId: string;
  userId: string;
}): Promise<OrgActionState> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TeamLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "تحقق من البيانات", fieldErrors: flattenZodIssues(parsed.error) };
  }

  const { data: dept } = await supabaseAdmin
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", parsed.data.departmentId)
    .maybeSingle();
  if (!dept || dept.organization_id !== session.orgId) {
    return { error: "القسم غير موجود في وكالتك" };
  }

  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, organization_id, full_name")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!emp || emp.organization_id !== session.orgId) {
    return { error: "الموظف غير موجود في وكالتك" };
  }

  const { error } = await supabaseAdmin.from("department_team_leads").upsert(
    {
      department_id: parsed.data.departmentId,
      user_id: parsed.data.userId,
      added_by: session.userId,
    },
    { onConflict: "department_id,user_id", ignoreDuplicates: true },
  );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.add_team_lead",
    entityType: "department",
    entityId: parsed.data.departmentId,
    metadata: {
      department_name: dept.name,
      user_id: parsed.data.userId,
      employee_name: emp.full_name,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "ORG_TEAM_LEAD_ADDED",
    entityType: "department",
    entityId: parsed.data.departmentId,
    payload: {
      department_name: dept.name,
      user_id: parsed.data.userId,
      employee_name: emp.full_name,
    },
    importance: "low",
  });

  revalidatePath("/organization/chart");
  revalidatePath(`/organization/departments/${parsed.data.departmentId}`);
  return { ok: true };
}

export async function removeTeamLead(input: {
  departmentId: string;
  userId: string;
}): Promise<OrgActionState> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TeamLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "تحقق من البيانات", fieldErrors: flattenZodIssues(parsed.error) };
  }

  const { data: dept } = await supabaseAdmin
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", parsed.data.departmentId)
    .maybeSingle();
  if (!dept || dept.organization_id !== session.orgId) {
    return { error: "القسم غير موجود في وكالتك" };
  }

  const { error } = await supabaseAdmin
    .from("department_team_leads")
    .delete()
    .eq("department_id", parsed.data.departmentId)
    .eq("user_id", parsed.data.userId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.remove_team_lead",
    entityType: "department",
    entityId: parsed.data.departmentId,
    metadata: {
      department_name: dept.name,
      user_id: parsed.data.userId,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "ORG_TEAM_LEAD_REMOVED",
    entityType: "department",
    entityId: parsed.data.departmentId,
    payload: {
      department_name: dept.name,
      user_id: parsed.data.userId,
    },
    importance: "low",
  });

  revalidatePath("/organization/chart");
  revalidatePath(`/organization/departments/${parsed.data.departmentId}`);
  return { ok: true };
}

/**
 * Rename a department. Used by the editable org-chart diagram.
 * Slug is left untouched (used as a stable identifier across migrations).
 */
const RenameSchema = z.object({
  id: z.string().uuid("معرّف القسم غير صالح"),
  newName: z.string().min(1, "الاسم لا يمكن أن يكون فارغاً").max(120),
});

export async function renameDepartment(input: {
  id: string;
  newName: string;
}): Promise<OrgActionState> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "تحقق من البيانات", fieldErrors: flattenZodIssues(parsed.error) };
  }

  const { data: dept } = await supabaseAdmin
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!dept || dept.organization_id !== session.orgId) {
    return { error: "القسم غير موجود في وكالتك" };
  }

  const { error } = await supabaseAdmin
    .from("departments")
    .update({ name: parsed.data.newName })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.rename",
    entityType: "department",
    entityId: parsed.data.id,
    metadata: { from: dept.name, to: parsed.data.newName },
  });
  revalidatePath("/organization/chart");
  return { ok: true };
}

/** Create a new child department under the given parent. */
const AddChildSchema = z.object({
  parentId: z.string().uuid("معرّف القسم الأب غير صالح").nullable(),
  name: z.string().min(1).max(120).default("قسم جديد"),
  kind: z
    .enum(["group", "account_management", "main_section", "supporting_section", "quality_control", "other"])
    .default("other"),
});

export async function addChildDepartment(input: {
  parentId: string | null;
  name?: string;
  kind?: "group" | "account_management" | "main_section" | "supporting_section" | "quality_control" | "other";
}): Promise<OrgActionState & { id?: string }> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = AddChildSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "تحقق من البيانات", fieldErrors: flattenZodIssues(parsed.error) };
  }

  if (parsed.data.parentId) {
    const { data: parent } = await supabaseAdmin
      .from("departments")
      .select("id, organization_id")
      .eq("id", parsed.data.parentId)
      .maybeSingle();
    if (!parent || parent.organization_id !== session.orgId) {
      return { error: "القسم الأب غير موجود في وكالتك" };
    }
  }

  const slug = `dept-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const { data: created, error } = await supabaseAdmin
    .from("departments")
    .insert({
      organization_id: session.orgId,
      name: parsed.data.name,
      slug,
      kind: parsed.data.kind,
      parent_department_id: parsed.data.parentId,
    })
    .select("id")
    .single();
  if (error || !created) return { error: error?.message ?? "فشل الإنشاء" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.create",
    entityType: "department",
    entityId: created.id,
    metadata: { name: parsed.data.name, parent_id: parsed.data.parentId, kind: parsed.data.kind },
  });
  revalidatePath("/organization/chart");
  return { ok: true, id: created.id };
}

/** Delete a department. Children are cascaded by parent_department_id setNull
 *  (i.e. they become roots) so we don't accidentally orphan a whole subtree. */
export async function deleteDepartment(input: {
  id: string;
}): Promise<OrgActionState> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { data: dept } = await supabaseAdmin
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", input.id)
    .maybeSingle();
  if (!dept || dept.organization_id !== session.orgId) {
    return { error: "القسم غير موجود في وكالتك" };
  }

  // Reparent children to this dept's parent (so the tree doesn't break).
  await supabaseAdmin
    .from("departments")
    .update({ parent_department_id: null })
    .eq("parent_department_id", input.id);

  const { error } = await supabaseAdmin
    .from("departments")
    .delete()
    .eq("id", input.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.delete",
    entityType: "department",
    entityId: input.id,
    metadata: { name: dept.name },
  });
  revalidatePath("/organization/chart");
  return { ok: true };
}

/** Set (or clear) an employee's organisational position. */
export async function setEmployeePosition(input: {
  userId: string;
  position: "head" | "team_lead" | "specialist" | "agent" | "admin" | null;
}): Promise<OrgActionState> {
  let session;
  try {
    session = await requirePermission("org.manage_structure");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetPositionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "تحقق من البيانات", fieldErrors: flattenZodIssues(parsed.error) };
  }

  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, organization_id, full_name")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!emp || emp.organization_id !== session.orgId) {
    return { error: "الموظف غير موجود في وكالتك" };
  }

  const { error } = await supabaseAdmin
    .from("employee_profiles")
    .update({ position: parsed.data.position })
    .eq("id", emp.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "employee.set_position",
    entityType: "employee",
    entityId: emp.id,
    metadata: {
      employee_name: emp.full_name,
      user_id: parsed.data.userId,
      position: parsed.data.position,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "ORG_POSITION_SET",
    entityType: "employee",
    entityId: emp.id,
    payload: {
      employee_name: emp.full_name,
      position: parsed.data.position,
    },
    importance: "low",
  });

  revalidatePath("/organization/chart");
  revalidatePath("/organization/employees");
  return { ok: true };
}
