"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IssueSchema = z.object({
  employee_profile_id: z.string().regex(UUID_RE, { message: "اختر موظفًا" }),
  severity: z.enum(["verbal", "written", "final", "suspension"]),
  reason: z.string().trim().min(3, { message: "اذكر سبب الإنذار" }).max(500),
  detail: z.string().trim().max(2000).optional(),
});

export type WarningActionState = {
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

export async function issueWarningAction(
  _prev: WarningActionState | undefined,
  formData: FormData,
): Promise<WarningActionState> {
  let session;
  try {
    session = await requirePermission("warning.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = IssueSchema.safeParse({
    employee_profile_id: formData.get("employee_profile_id"),
    severity: formData.get("severity"),
    reason: formData.get("reason"),
    detail: formData.get("detail") || undefined,
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

  const { data: inserted, error } = await supabaseAdmin
    .from("employee_warnings")
    .insert({
      organization_id: session.orgId,
      employee_profile_id: parsed.data.employee_profile_id,
      issued_by: session.employeeId,
      severity: parsed.data.severity,
      reason: parsed.data.reason,
      detail: parsed.data.detail ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: "تعذّر إصدار الإنذار: " + (error?.message ?? "") };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "warning.issue",
    entityType: "employee_warning",
    entityId: inserted.id,
    metadata: { employee_profile_id: parsed.data.employee_profile_id, severity: parsed.data.severity },
  });

  revalidatePath("/warnings");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function acknowledgeWarningAction(
  _prev: WarningActionState | undefined,
  formData: FormData,
): Promise<WarningActionState> {
  let session;
  try {
    session = await requirePermission("warning.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const id = formData.get("id");
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return { error: "معرّف غير صالح" };
  }

  const { error } = await supabaseAdmin
    .from("employee_warnings")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", session.orgId);
  if (error) return { error: "تعذّر تحديث الإنذار: " + error.message };

  revalidatePath("/warnings");
  return { ok: true };
}
