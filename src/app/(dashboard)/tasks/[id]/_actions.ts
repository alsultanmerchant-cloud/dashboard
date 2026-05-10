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
import { createServerSupabaseClient } from "@/lib/supabase/server";
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
    .select("id, title, task_code, organization_id, project_id, created_by, project:projects!tasks_project_id_fkey(name)")
    .eq("id", taskId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return task;
}

// Sky Light parity: notification body should always read like the
// rwasem_notifications_link addon's chatter format —
//   «<project name>» — <task code> <task title>
// so the recipient sees the same context they would in Odoo. This is the
// single source of truth for the "task context" line.
function taskNotificationBody(task: {
  title: string | null;
  task_code: string | null;
  project: { name: string } | { name: string }[] | null;
}): string {
  const proj = Array.isArray(task.project) ? task.project[0] : task.project;
  const projectLabel = proj?.name ?? "—";
  const codePart = task.task_code ? `${task.task_code} ` : "";
  const titlePart = task.title ?? "";
  return `«${projectLabel}» — ${codePart}${titlePart}`.trim();
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

  // Notify the new follower so they know they were added. Body carries the
  // project + task_code context (Sky Light parity, feedback #5).
  await createNotification({
    organizationId: session.orgId,
    recipientUserId: parsed.data.user_id,
    recipientEmployeeId: targetEmp.id,
    type: "TASK_FOLLOWER",
    title: `${session.fullName} أضافك كمتابع للمهمة`,
    body: taskNotificationBody(task),
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

// =========================================================================
// Approval gates (migration 0048).
// Single-approver gate: when approval_required = true, forward stage moves
// are blocked until approval_status = 'approved'.
// =========================================================================

const RequestApprovalSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  approver_employee_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const ApprovalDecisionSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  notes: z.string().trim().max(1000).optional(),
});

const ResetApprovalSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  clear_requirement: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});

async function callTaskApprovalRpc(
  fn: "request_task_approval" | "approve_task" | "reject_task" | "reset_task_approval",
  args: Record<string, unknown>,
): Promise<{ error: string | null }> {
  // RPCs are SECURITY DEFINER but resolve auth.uid() — must call as the
  // user (server client), not service role.
  const supa = await createServerSupabaseClient();
  const { error } = await supa.rpc(fn, args);
  if (error) return { error: error.message };
  return { error: null };
}

export async function requestTaskApprovalAction(input: {
  taskId: string;
  approverEmployeeId?: string | null;
  notes?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RequestApprovalSchema.safeParse({
    task_id: input.taskId,
    approver_employee_id: input.approverEmployeeId ?? null,
    notes: input.notes,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const isCreator = task.created_by === session.userId;
  const canManage =
    isCreator ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) {
    return { error: "لا تملك صلاحية طلب اعتماد على هذه المهمة" };
  }

  const { error } = await callTaskApprovalRpc("request_task_approval", {
    p_task_id: parsed.data.task_id,
    p_approver_id: parsed.data.approver_employee_id ?? null,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { error };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.approval_requested",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { approver_employee_id: parsed.data.approver_employee_id ?? null },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_APPROVAL_REQUESTED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { task_title: task.title },
    importance: "normal",
  });

  if (parsed.data.approver_employee_id) {
    const { data: approver } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, user_id")
      .eq("id", parsed.data.approver_employee_id)
      .eq("organization_id", session.orgId)
      .maybeSingle();
    if (approver?.user_id) {
      await createNotification({
        organizationId: session.orgId,
        recipientUserId: approver.user_id,
        recipientEmployeeId: approver.id,
        type: "TASK_APPROVAL",
        title: `${session.fullName} طلب اعتمادًا على مهمة`,
        body: taskNotificationBody(task),
        entityType: "task",
        entityId: parsed.data.task_id,
      });
    }
  }

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

async function notifyCreatorOfDecision(
  session: { orgId: string; userId: string; fullName: string },
  task: {
    id: string;
    title: string;
    task_code: string | null;
    created_by: string | null;
    project: { name: string } | { name: string }[] | null;
  },
  decision: "approved" | "rejected",
) {
  if (!task.created_by) return;
  const { data: creatorEmp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, user_id")
    .eq("user_id", task.created_by)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  await createNotification({
    organizationId: session.orgId,
    recipientUserId: task.created_by,
    recipientEmployeeId: creatorEmp?.id ?? null,
    type: "TASK_APPROVAL",
    title:
      decision === "approved"
        ? `${session.fullName} اعتمد المهمة`
        : `${session.fullName} رفض المهمة`,
    body: taskNotificationBody(task),
    entityType: "task",
    entityId: task.id,
  });
}

export async function approveTaskAction(input: {
  taskId: string;
  notes?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ApprovalDecisionSchema.safeParse({
    task_id: input.taskId,
    notes: input.notes,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const { error } = await callTaskApprovalRpc("approve_task", {
    p_task_id: parsed.data.task_id,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { error };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.approved",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { notes: parsed.data.notes ?? null },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_APPROVED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { task_title: task.title },
    importance: "high",
  });
  await notifyCreatorOfDecision(session, task, "approved");

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

export async function rejectTaskAction(input: {
  taskId: string;
  notes?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ApprovalDecisionSchema.safeParse({
    task_id: input.taskId,
    notes: input.notes,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const { error } = await callTaskApprovalRpc("reject_task", {
    p_task_id: parsed.data.task_id,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { error };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.rejected",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { notes: parsed.data.notes ?? null },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_REJECTED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { task_title: task.title, notes: parsed.data.notes ?? null },
    importance: "high",
  });
  await notifyCreatorOfDecision(session, task, "rejected");

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

export async function resetTaskApprovalAction(input: {
  taskId: string;
  clearRequirement?: boolean;
  notes?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ResetApprovalSchema.safeParse({
    task_id: input.taskId,
    clear_requirement: input.clearRequirement ?? false,
    notes: input.notes,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const task = await loadTaskOrError(parsed.data.task_id, session.orgId);
  if (!task) return { error: "المهمة غير موجودة" };

  const { error } = await callTaskApprovalRpc("reset_task_approval", {
    p_task_id: parsed.data.task_id,
    p_clear_requirement: parsed.data.clear_requirement,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { error };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: parsed.data.clear_requirement
      ? "task.approval_cleared"
      : "task.approval_reset",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {},
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}
