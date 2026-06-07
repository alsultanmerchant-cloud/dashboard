"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-\d{2}-01$/;

export type TargetActionState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string>;
};

function fieldErrors(parsed: z.ZodSafeParseError<unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const k = issue.path[0];
    if (typeof k === "string") out[k] = issue.message;
  }
  return out;
}

const EmployeeSchema = z.object({
  employee_profile_id: z.string().regex(UUID_RE, { message: "اختر موظفًا" }),
  month: z.string().regex(MONTH_RE, { message: "اختر الشهر (أول الشهر)" }),
  target_completed_tasks: z.coerce.number().int().min(0).max(10000).default(0),
  target_designs: z.coerce.number().int().min(0).max(10000).default(0),
  target_on_time_pct: z.coerce.number().min(0).max(100).optional(),
});

export async function upsertEmployeeTargetAction(
  _prev: TargetActionState | undefined,
  formData: FormData,
): Promise<TargetActionState> {
  let session;
  try {
    session = await requirePermission("target.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = EmployeeSchema.safeParse({
    employee_profile_id: formData.get("employee_profile_id"),
    month: formData.get("month"),
    target_completed_tasks: formData.get("target_completed_tasks") || 0,
    target_designs: formData.get("target_designs") || 0,
    target_on_time_pct: formData.get("target_on_time_pct") || undefined,
  });
  if (!parsed.success) {
    return { error: "تحقق من بيانات النموذج", fieldErrors: fieldErrors(parsed) };
  }

  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, organization_id")
    .eq("id", parsed.data.employee_profile_id)
    .maybeSingle();
  if (!emp || emp.organization_id !== session.orgId) {
    return { error: "الموظف غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("employee_targets")
    .upsert(
      {
        organization_id: session.orgId,
        employee_profile_id: parsed.data.employee_profile_id,
        month: parsed.data.month,
        target_completed_tasks: parsed.data.target_completed_tasks,
        target_designs: parsed.data.target_designs,
        target_on_time_pct: parsed.data.target_on_time_pct ?? null,
        created_by: session.userId,
      },
      { onConflict: "organization_id,employee_profile_id,month" },
    );
  if (error) return { error: "تعذّر حفظ الهدف: " + error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "target.upsert_employee",
    entityType: "employee_profile",
    entityId: parsed.data.employee_profile_id,
    metadata: { month: parsed.data.month },
  });

  revalidatePath("/targets");
  revalidatePath("/dashboard");
  return { ok: true };
}

const DepartmentSchema = z.object({
  department_id: z.string().regex(UUID_RE, { message: "اختر القسم" }),
  month: z.string().regex(MONTH_RE, { message: "اختر الشهر (أول الشهر)" }),
  target_completed_tasks: z.coerce.number().int().min(0).max(100000).default(0),
  target_projects_delivered: z.coerce.number().int().min(0).max(10000).default(0),
  target_on_time_pct: z.coerce.number().min(0).max(100).optional(),
});

export async function upsertDepartmentTargetAction(
  _prev: TargetActionState | undefined,
  formData: FormData,
): Promise<TargetActionState> {
  let session;
  try {
    session = await requirePermission("target.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DepartmentSchema.safeParse({
    department_id: formData.get("department_id"),
    month: formData.get("month"),
    target_completed_tasks: formData.get("target_completed_tasks") || 0,
    target_projects_delivered: formData.get("target_projects_delivered") || 0,
    target_on_time_pct: formData.get("target_on_time_pct") || undefined,
  });
  if (!parsed.success) {
    return { error: "تحقق من بيانات النموذج", fieldErrors: fieldErrors(parsed) };
  }

  const { data: dept } = await supabaseAdmin
    .from("departments")
    .select("id, organization_id")
    .eq("id", parsed.data.department_id)
    .maybeSingle();
  if (!dept || dept.organization_id !== session.orgId) {
    return { error: "القسم غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("department_targets")
    .upsert(
      {
        organization_id: session.orgId,
        department_id: parsed.data.department_id,
        month: parsed.data.month,
        target_completed_tasks: parsed.data.target_completed_tasks,
        target_projects_delivered: parsed.data.target_projects_delivered,
        target_on_time_pct: parsed.data.target_on_time_pct ?? null,
        created_by: session.userId,
      },
      { onConflict: "organization_id,department_id,month" },
    );
  if (error) return { error: "تعذّر حفظ هدف القسم: " + error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "target.upsert_department",
    entityType: "department",
    entityId: parsed.data.department_id,
    metadata: { month: parsed.data.month },
  });

  revalidatePath("/targets");
  revalidatePath("/dashboard");
  return { ok: true };
}
