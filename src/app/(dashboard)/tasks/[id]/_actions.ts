"use server";

// =========================================================================
// Phase T3 — Task followers (server actions, scoped to /tasks/[id]).
// =========================================================================
// Followers are intentionally separate from assignees:
//   • Assignees (`task_assignees`) drive the stage-exit role gating
//     (STAGE_EXIT_ROLE in tasks/_actions.ts) and assignment-shaped UX.
//   • Followers (`task_followers`) just grant read-visibility through the
//     0023-tightened tasks_select policy. Useful for a Specialist who
//     wants the AM to "stay in the loop" on a task without becoming the
//     formal stage exit.
//
// Authorization model (mirrors RLS):
//   • Caller MUST be either the task creator OR hold `task.view_all`.
//   • The new permission `task.manage_followers` is additionally accepted
//     so an admin without view_all can still curate followers (matches
//     the role binding in migration 0023).
//
// Every mutation: zod validate → check user → check org scope → audit_log
// + ai_event. The ai_event uses importance="low" because adding/removing
// a follower is operational, not a business-state change.
// =========================================================================

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent, createNotification } from "@/lib/audit";

const FollowerInputSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  user_id: z.string().uuid({ message: "معرف المستخدم غير صالح" }),
});

const HoldTaskSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  reason: z
    .string()
    .trim()
    .min(3, "السبب قصير جدًا")
    .max(500, "السبب طويل جدًا (الحد الأقصى 500 حرف)"),
});

const ResumeTaskSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
});

type ActionResult = { ok: true } | { error: string };

async function loadTaskOrError(taskId: string, orgId: string) {
  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, title, organization_id, project_id, created_by")
    .eq("id", taskId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return task;
}

export async function addFollowerAction(input: {
  taskId: string;
  userId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = FollowerInputSchema.safeParse({
    task_id: input.taskId,
    user_id: input.userId,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const isCreator = task.created_by === session.userId;
  const canManage =
    isCreator ||
    hasPermission(session, "task.view_all") ||
    hasPermission(session, "task.manage_followers");
  if (!canManage) {
    return {
      error: "لا يمكنك إدارة المتابعين إلا بصلاحية الإشراف الكاملة",
    };
  }

  // Verify the user being added belongs to this org.
  const { data: targetEmp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, user_id")
    .eq("user_id", parsed.data.user_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!targetEmp || !targetEmp.user_id) {
    return { error: "المستخدم غير موجود في هذه المنظمة" };
  }

  const { error } = await supabaseAdmin
    .from("task_followers")
    .insert({
      task_id: parsed.data.task_id,
      user_id: parsed.data.user_id,
      added_by: session.userId,
    });
  if (error) {
    if (error.code === "23505") {
      // Already following — make this idempotent.
      return { ok: true };
    }
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.follower_add",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      added_user_id: parsed.data.user_id,
      added_employee_id: targetEmp.id,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_FOLLOWER_ADDED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {
      followed_user_id: parsed.data.user_id,
      followed_employee_id: targetEmp.id,
      task_title: task.title,
    },
    importance: "low",
  });

  // Notify the new follower so they know they were added.
  await createNotification({
    organizationId: session.orgId,
    recipientUserId: parsed.data.user_id,
    recipientEmployeeId: targetEmp.id,
    type: "TASK_FOLLOWER",
    title: `${session.fullName} أضافك كمتابع للمهمة`,
    body: task.title,
    entityType: "task",
    entityId: parsed.data.task_id,
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

export async function removeFollowerAction(input: {
  taskId: string;
  userId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = FollowerInputSchema.safeParse({
    task_id: input.taskId,
    user_id: input.userId,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const isCreator = task.created_by === session.userId;
  const isSelf = parsed.data.user_id === session.userId;
  const canManage =
    isCreator ||
    isSelf ||
    hasPermission(session, "task.view_all") ||
    hasPermission(session, "task.manage_followers");
  if (!canManage) {
    return {
      error: "لا يمكنك إدارة المتابعين إلا بصلاحية الإشراف الكاملة",
    };
  }

  const { error } = await supabaseAdmin
    .from("task_followers")
    .delete()
    .eq("task_id", parsed.data.task_id)
    .eq("user_id", parsed.data.user_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.follower_remove",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { removed_user_id: parsed.data.user_id },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_FOLLOWER_REMOVED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { removed_user_id: parsed.data.user_id, task_title: task.title },
    importance: "low",
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

// =========================================================================
// Task-level hold / resume — separate from the project-level hold.
// PDF §6 only requires HOLD at the project level; we expose it per-task
// because the schema columns now exist (migration 0023) and several
// users have asked for the ability to pause one deliverable inside an
// otherwise-active project.
// =========================================================================

export async function holdTaskAction(input: {
  taskId: string;
  reason: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = HoldTaskSchema.safeParse({
    task_id: input.taskId,
    reason: input.reason,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const heldAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ hold_reason: parsed.data.reason, hold_since: heldAt })
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.hold",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { reason: parsed.data.reason },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_HELD",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { reason: parsed.data.reason, held_at: heldAt },
    importance: "high",
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

export async function resumeTaskAction(input: {
  taskId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ResumeTaskSchema.safeParse({ task_id: input.taskId });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ hold_reason: null, hold_since: null })
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.resume",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {},
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_RESUMED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {},
    importance: "normal",
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}
