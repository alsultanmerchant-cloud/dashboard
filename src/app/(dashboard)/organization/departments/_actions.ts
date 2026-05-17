"use server";

import { revalidatePath } from "next/cache";
import { DepartmentCreateSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type DepartmentFormState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createDepartmentAction(
  _prev: DepartmentFormState | undefined,
  formData: FormData,
): Promise<DepartmentFormState> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DepartmentCreateSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    parent_department_id: formData.get("parent_department_id"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  const { data, error } = await supabaseAdmin
    .from("departments")
    .insert({ organization_id: session.orgId, ...parsed.data })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "المعرّف مستخدم في قسم آخر" };
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.create",
    entityType: "department",
    entityId: data.id,
    metadata: { name: parsed.data.name, slug: parsed.data.slug },
  });

  revalidatePath("/organization/departments");
  revalidatePath("/organization/employees");
  return { ok: true };
}

// #12: edit an existing department. Same validated fields as create; the
// department id is carried on a hidden form input.
export async function updateDepartmentAction(
  _prev: DepartmentFormState | undefined,
  formData: FormData,
): Promise<DepartmentFormState> {
  let session;
  try {
    session = await requirePermission("employees.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const departmentId = formData.get("department_id");
  if (typeof departmentId !== "string" || departmentId.length === 0) {
    return { error: "معرّف القسم مفقود" };
  }

  const parsed = DepartmentCreateSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    parent_department_id: formData.get("parent_department_id"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  // Org scope: only update a department that belongs to the caller's org.
  const { error } = await supabaseAdmin
    .from("departments")
    .update(parsed.data)
    .eq("id", departmentId)
    .eq("organization_id", session.orgId);
  if (error) {
    if (error.code === "23505") return { error: "المعرّف مستخدم في قسم آخر" };
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "department.update",
    entityType: "department",
    entityId: departmentId,
    metadata: { name: parsed.data.name, slug: parsed.data.slug },
  });

  revalidatePath("/organization/departments");
  revalidatePath(`/organization/departments/${departmentId}`);
  revalidatePath("/organization/employees");
  return { ok: true };
}
