"use server";

// Inline deadline edit on the task form card. Writes to tasks.planned_date —
// the canonical "due" column the rest of the app reads via
// (planned_date ?? due_date). delay_days is recomputed by the trigger from
// migration 0057 on every planned_date update.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

const SetDeadlineSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  // ISO date "YYYY-MM-DD" or null to clear.
  planned_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح")
    .nullable(),
});

export async function setTaskDeadlineAction(input: {
  taskId: string;
  plannedDate: string | null;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetDeadlineSchema.safeParse({
    task_id: input.taskId,
    planned_date: input.plannedDate,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, title, task_code, created_by, planned_date")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.task_id)
    .maybeSingle();
  if (!task) return { error: "المهمة غير موجودة" };

  const canManage =
    task.created_by === session.userId ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) {
    return { error: "لا تملك صلاحية تعديل الموعد النهائي" };
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ planned_date: parsed.data.planned_date })
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.deadline_set",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      old: task.planned_date,
      new: parsed.data.planned_date,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_DEADLINE_SET",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {
      task_title: task.title,
      old: task.planned_date,
      new: parsed.data.planned_date,
    },
    importance: "normal",
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}
