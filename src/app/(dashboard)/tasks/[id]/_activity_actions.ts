"use server";

// Task scheduled activities (migration 0060). mail.activity-style reminders
// distinct from chatter and sub-tasks — date-bound to-dos with an assignee.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const ACTIVITY_TYPES = ["call", "email", "review", "upload", "other"] as const;

const CreateSchema = z.object({
  task_id: z.string().uuid(),
  activity_type: z.enum(ACTIVITY_TYPES),
  summary: z.string().trim().min(2, "اكتب وصفًا").max(500),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح")
    .optional()
    .or(z.literal("")),
  assignee_id: z.string().uuid().optional().or(z.literal("")),
});

const IdSchema = z.object({ id: z.string().uuid(), task_id: z.string().uuid() });

async function loadParentTask(orgId: string, taskId: string) {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, organization_id")
    .eq("id", taskId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data;
}

export async function createActivityAction(input: {
  taskId: string;
  activityType: (typeof ACTIVITY_TYPES)[number];
  summary: string;
  dueDate?: string;
  assigneeId?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreateSchema.safeParse({
    task_id: input.taskId,
    activity_type: input.activityType,
    summary: input.summary,
    due_date: input.dueDate ?? "",
    assignee_id: input.assigneeId ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const parent = await loadParentTask(session.orgId, parsed.data.task_id);
  if (!parent) return { error: "المهمة غير موجودة" };

  const { error } = await supabaseAdmin.from("task_activities").insert({
    organization_id: session.orgId,
    task_id: parent.id,
    activity_type: parsed.data.activity_type,
    summary: parsed.data.summary,
    due_date: parsed.data.due_date || null,
    assignee_id: parsed.data.assignee_id || session.employeeId || null,
    created_by: session.userId,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.activity_create",
    entityType: "task",
    entityId: parent.id,
    metadata: {
      activity_type: parsed.data.activity_type,
      due_date: parsed.data.due_date || null,
    },
  });

  revalidatePath(`/tasks/${parent.id}`);
  return { ok: true };
}

export async function completeActivityAction(input: {
  id: string;
  taskId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = IdSchema.safeParse({ id: input.id, task_id: input.taskId });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const { error } = await supabaseAdmin
    .from("task_activities")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("organization_id", session.orgId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.activity_complete",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { activity_id: parsed.data.id },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

export async function deleteActivityAction(input: {
  id: string;
  taskId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = IdSchema.safeParse({ id: input.id, task_id: input.taskId });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const { error } = await supabaseAdmin
    .from("task_activities")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organization_id", session.orgId);
  if (error) return { error: error.message };

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}
