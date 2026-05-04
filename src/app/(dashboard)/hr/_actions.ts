"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession, requirePermission } from "@/lib/auth-server";
import { logAudit } from "@/lib/audit";
import { createLeave, decideLeave, cancelLeave, LEAVE_TYPES } from "@/lib/data/leaves";

export type LeaveFormState = {
  ok?: true;
  leaveId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

const LeaveCreateSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح"),
    days: z
      .string()
      .min(1, "عدد الأيام مطلوب")
      .transform((v) => Number(v))
      .refine((n) => Number.isFinite(n) && n > 0, "عدد أيام غير صحيح"),
    leave_type: z.enum(LEAVE_TYPES),
    reason: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "تاريخ الانتهاء يجب أن يكون بعد البداية",
    path: ["end_date"],
  });

export async function requestLeaveAction(
  _prev: LeaveFormState | undefined,
  formData: FormData,
): Promise<LeaveFormState> {
  let session;
  try {
    // Anyone authenticated can request — RLS enforces self-only insert.
    session = await requireSession();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = LeaveCreateSchema.safeParse({
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    days: formData.get("days"),
    leave_type: formData.get("leave_type"),
    reason: formData.get("reason") || null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  let result;
  try {
    result = await createLeave(session.orgId, session.userId, {
      employee_user_id: session.userId, // self-service
      ...parsed.data,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "leave.request",
    entityType: "leave",
    entityId: result.id,
    metadata: {
      leave_type: parsed.data.leave_type,
      days: parsed.data.days,
      start: parsed.data.start_date,
      end: parsed.data.end_date,
    },
  });

  revalidatePath("/hr");
  return { ok: true, leaveId: result.id };
}

export async function decideLeaveAction(
  leaveId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<{ ok?: true; error?: string }> {
  let session;
  try {
    session = await requirePermission("hr.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  try {
    await decideLeave(session.orgId, leaveId, session.userId, decision, note);
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: `leave.${decision}`,
    entityType: "leave",
    entityId: leaveId,
    metadata: { decision, note },
  });

  revalidatePath("/hr");
  return { ok: true };
}

export async function cancelLeaveAction(
  leaveId: string,
): Promise<{ ok?: true; error?: string }> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return { error: (e as Error).message };
  }

  try {
    await cancelLeave(session.orgId, leaveId);
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "leave.cancel",
    entityType: "leave",
    entityId: leaveId,
  });

  revalidatePath("/hr");
  return { ok: true };
}
