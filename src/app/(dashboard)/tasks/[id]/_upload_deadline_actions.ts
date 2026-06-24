"use server";

// Inline "upload deadline" (موعد الرفع) edit on the task form card. Writes to
// tasks.upload_due_date (migration 0210) — the explicit per-task upload date
// the specialist sets on design/content tasks so they surface in the uploads
// queue (/uploads) with precedence over the template-derived offset.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const SetUploadDeadlineSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  // ISO date "YYYY-MM-DD" or null to clear (task has no upload date).
  upload_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح")
    .nullable(),
});

export async function setTaskUploadDeadlineAction(input: {
  taskId: string;
  uploadDueDate: string | null;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetUploadDeadlineSchema.safeParse({
    task_id: input.taskId,
    upload_due_date: input.uploadDueDate,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, title, created_by, upload_due_date")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.task_id)
    .maybeSingle();
  if (!task) return { error: "المهمة غير موجودة" };

  // The assigned specialist owns the upload date — allow the task creator,
  // managers, or anyone assigned to the task to set it.
  const { data: isAssignee } = await supabaseAdmin
    .from("task_assignees")
    .select("id")
    .eq("task_id", parsed.data.task_id)
    .eq("employee_id", session.employeeId ?? "")
    .limit(1)
    .maybeSingle();

  const canManage =
    !!isAssignee ||
    task.created_by === session.userId ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) {
    return { error: "لا تملك صلاحية تعديل موعد الرفع" };
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ upload_due_date: parsed.data.upload_due_date })
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.upload_deadline_set",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      old: task.upload_due_date,
      new: parsed.data.upload_due_date,
    },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  revalidatePath("/uploads");
  return { ok: true };
}
