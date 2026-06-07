"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Schema = z.object({
  employee_profile_id: z.string().regex(UUID_RE, { message: "اختر موظفًا" }),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "تاريخ غير صالح" }),
  status: z.enum(["present", "late", "absent", "remote", "half_day", "leave"]),
  late_minutes: z.coerce.number().int().min(0).max(600).default(0),
  note: z.string().trim().max(500).optional(),
});

export type AttendanceActionState = {
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

export async function recordAttendanceAction(
  _prev: AttendanceActionState | undefined,
  formData: FormData,
): Promise<AttendanceActionState> {
  let session;
  try {
    session = await requirePermission("attendance.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = Schema.safeParse({
    employee_profile_id: formData.get("employee_profile_id"),
    work_date: formData.get("work_date"),
    status: formData.get("status"),
    late_minutes: formData.get("late_minutes") || 0,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: "تحقق من بيانات النموذج", fieldErrors: fieldErrors(parsed) };
  }

  // Org-scope: the employee must belong to the caller's org.
  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, organization_id")
    .eq("id", parsed.data.employee_profile_id)
    .maybeSingle();
  if (!emp || emp.organization_id !== session.orgId) {
    return { error: "الموظف غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("attendance_records")
    .upsert(
      {
        organization_id: session.orgId,
        employee_profile_id: parsed.data.employee_profile_id,
        work_date: parsed.data.work_date,
        status: parsed.data.status,
        late_minutes: parsed.data.late_minutes,
        note: parsed.data.note ?? null,
        source: "manual",
        created_by: session.userId,
      },
      { onConflict: "organization_id,employee_profile_id,work_date" },
    );
  if (error) return { error: "تعذّر حفظ سجل الحضور: " + error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "attendance.record",
    entityType: "employee_profile",
    entityId: parsed.data.employee_profile_id,
    metadata: { work_date: parsed.data.work_date, status: parsed.data.status },
  });

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  return { ok: true };
}
