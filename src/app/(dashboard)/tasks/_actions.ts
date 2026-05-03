"use server";

import { revalidatePath } from "next/cache";
import {
  TaskStatusUpdateSchema,
  TaskStageUpdateSchema,
  TaskRoleAssignSchema,
  TaskCommentSchema,
} from "@/lib/schemas";
import type { Database } from "@/lib/supabase/types";

type TaskStageEnum = Database["public"]["Enums"]["task_stage"];
type TaskRoleEnum = Database["public"]["Enums"]["task_role_type"];

// Sky Light / Rwasem stage-transition rules.
// Maps the SOURCE stage to the role slot allowed to move out of it.
// Owners and admins always bypass these rules.
const ROLE_AR: Record<TaskRoleEnum, string> = {
  specialist: "المتخصص",
  manager: "المدير",
  agent: "المنفذ",
  account_manager: "مدير الحساب",
};

const STAGE_EXIT_ROLE: Record<TaskStageEnum, TaskRoleEnum | null> = {
  new: "specialist",            // specialist writes requirements then assigns to manager
  in_progress: "agent",         // agent finishes execution → manager_review
  manager_review: "manager",    // manager approves → specialist_review
  specialist_review: "specialist", // specialist approves → ready_to_send
  ready_to_send: "account_manager", // AM dispatches → sent_to_client
  sent_to_client: "account_manager", // AM moves to client_changes or done
  client_changes: "account_manager", // AM bounces it back after fixes
  done: null,                    // terminal — owner/admin only
};

// =========================================================================
// Per-edge transition permission keys (seeded by migration 0022).
// The DB trigger `assert_stage_transition_allowed` (migration 0015) is the
// canonical enforcement; this map exists so a caller holding the seeded
// permission key gets a friendly pre-flight pass instead of bumping into a
// raw Postgres errcode='42501'. Keys are absent → fall back to the
// task-role-on-assignment check (which mirrors the trigger).
// =========================================================================
const STAGE_TRANSITION_PERM: Record<string, string> = {
  "in_progress->manager_review": "task.transition.specialist_to_manager_review",
  "manager_review->specialist_review": "task.transition.manager_to_specialist_review",
  "specialist_review->ready_to_send": "task.transition.specialist_to_ready_to_send",
  "ready_to_send->sent_to_client": "task.transition.ready_to_send_to_sent",
  "sent_to_client->client_changes": "task.transition.sent_to_client_changes",
  "client_changes->done": "task.transition.client_changes_to_done",
};
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent, createNotification } from "@/lib/audit";
import { extractMentions, resolveMentions } from "@/lib/workflows/mentions";

export async function updateTaskStatusAction(input: {
  taskId: string;
  status: string;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TaskStatusUpdateSchema.safeParse({
    task_id: input.taskId,
    status: input.status,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: existing } = await supabaseAdmin
    .from("tasks")
    .select("id, status, project_id, organization_id")
    .eq("id", parsed.data.task_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!existing) return { error: "المهمة غير موجودة" };

  const completedAt =
    parsed.data.status === "done" ? new Date().toISOString() : null;

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ status: parsed.data.status, completed_at: completedAt })
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.status_change",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { from: existing.status, to: parsed.data.status },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_STATUS_CHANGED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { from: existing.status, to: parsed.data.status, project_id: existing.project_id },
    importance: parsed.data.status === "done" ? "normal" : "low",
  });

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

// =========================================================================
// Sky Light / Rwasem 8-stage workflow: move a task to a new stage.
// The DB trigger (tg_task_stage_history) closes the open history row,
// opens a new one, stamps stage_entered_at, and toggles completed_at when
// the task enters/leaves the "done" stage.
// =========================================================================
export async function moveTaskStageAction(input: {
  taskId: string;
  stage: string;
}): Promise<{ ok: true; from: string; to: string } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TaskStageUpdateSchema.safeParse({
    task_id: input.taskId,
    stage: input.stage,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: existing } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, stage, project_id, organization_id,
      task_assignees ( employee_id, role_type )
    `)
    .eq("id", parsed.data.task_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!existing) return { error: "المهمة غير موجودة" };
  if (existing.stage === parsed.data.stage) {
    return { ok: true, from: existing.stage, to: parsed.data.stage };
  }

  // Stage transition pre-flight gating. The DB trigger
  // `assert_stage_transition_allowed` (migration 0015) is the canonical
  // enforcement; this block exists to surface a friendly Arabic error
  // before the round-trip. The two MUST agree:
  //   • Trigger bypass: global roles owner / admin / manager.
  //   • Trigger allow:  caller is on task_assignees with the role_type
  //                     matching the edge.
  // We mirror that here, plus a permission-based fast-path: if the caller
  // holds the per-edge `task.transition.<...>` permission seeded by
  // migration 0022, they pass pre-flight (the trigger will still re-check).
  const requiredRole = STAGE_EXIT_ROLE[existing.stage as TaskStageEnum];
  // Bypass: owner OR `task.view_all` holder. Migration 0022 binds
  // `task.view_all` to owner / admin / manager / account_manager — the same
  // bypass set the DB trigger `assert_stage_transition_allowed` honors. By
  // gating on the permission key (not role-name strings) the friendly
  // pre-flight stays in lockstep with the trigger; if the binding changes
  // in a later migration both sides shift together.
  const bypass =
    session.isOwner || session.permissions.has("task.view_all");

  if (!bypass) {
    // Per-edge permission key (e.g. specialist_to_ready_to_send). Holding
    // this key is a hard pass for the friendly check.
    const edgeKey = `${existing.stage}->${parsed.data.stage}`;
    const edgePerm = STAGE_TRANSITION_PERM[edgeKey];
    const hasEdgePerm = !!edgePerm && session.permissions.has(edgePerm);

    if (!hasEdgePerm) {
      if (requiredRole === null) {
        return { error: "لا يمكن إعادة فتح مهمة منتهية إلا بصلاحية إدارية" };
      }
      if (requiredRole) {
        // Match the trigger's per-edge role list (specialist|manager edges,
        // agent|manager on in_progress→manager_review, etc.). We only stash
        // the "primary" role here for the friendly error; the trigger
        // handles the wider set. The check is "is the caller the assignee
        // for this role on this task?".
        const slot = (existing.task_assignees ?? []).find(
          (a) => a.role_type === requiredRole,
        );
        if (!slot || slot.employee_id !== session.employeeId) {
          return {
            error: `هذه النقلة مخصصة لـ${ROLE_AR[requiredRole]} المُسنَد للمهمة`,
          };
        }
      }
    }
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.stage_change",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { from: existing.stage, to: parsed.data.stage },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_STATUS_CHANGED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {
      from_stage: existing.stage,
      to_stage: parsed.data.stage,
      project_id: existing.project_id,
    },
    importance: parsed.data.stage === "done" ? "normal" : "low",
  });

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  if (existing.project_id) revalidatePath(`/projects/${existing.project_id}`);
  return { ok: true, from: existing.stage, to: parsed.data.stage };
}

export type CommentResult =
  | { ok: true; commentId: string; mentionsResolved: number }
  | { error: string };

export async function addTaskCommentAction(input: {
  taskId: string;
  body: string;
  isInternal?: boolean;
  kind?: "note" | "requirements" | "modification";
}): Promise<CommentResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TaskCommentSchema.safeParse({
    task_id: input.taskId,
    body: input.body,
    is_internal: input.isInternal ?? true,
    kind: input.kind ?? "note",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, project_id, created_by,
      task_assignees ( employee_id )
    `)
    .eq("id", parsed.data.task_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!task) return { error: "المهمة غير موجودة" };

  // Authorship gate: the caller may add a comment if they are
  //   • holder of `task.view_all` (heads / AM / admin / owner), OR
  //   • the task creator (`tasks.created_by`), OR
  //   • on `task_assignees` for this task (any role_type).
  // This mirrors the read-side RLS chain in migration 0022 so the writer
  // never invents visibility on a task they couldn't read.
  const canComment =
    session.isOwner ||
    session.permissions.has("task.view_all") ||
    task.created_by === session.userId ||
    (task.task_assignees ?? []).some(
      (a) => a.employee_id === session.employeeId,
    );
  if (!canComment) {
    return { error: "لا يمكنك التعليق على مهمة لست مُسنَدًا إليها" };
  }

  const { data: comment, error } = await supabaseAdmin
    .from("task_comments")
    .insert({
      organization_id: session.orgId,
      task_id: parsed.data.task_id,
      author_user_id: session.userId,
      body: parsed.data.body,
      is_internal: parsed.data.is_internal,
      kind: parsed.data.kind,
    })
    .select("id")
    .single();
  if (error || !comment) return { error: error?.message ?? "تعذر إضافة التعليق" };

  // Mention parsing
  const tokens = extractMentions(parsed.data.body);
  const resolved = await resolveMentions({
    organizationId: session.orgId,
    tokens,
  });

  if (resolved.length > 0) {
    await supabaseAdmin.from("task_mentions").insert(
      resolved.map((r) => ({
        organization_id: session!.orgId,
        task_comment_id: comment.id,
        mentioned_employee_id: r.employeeId,
        mentioned_user_id: r.userId,
      })),
    );

    await Promise.all(
      resolved.map((r) =>
        Promise.all([
          createNotification({
            organizationId: session!.orgId,
            recipientUserId: r.userId,
            recipientEmployeeId: r.employeeId,
            type: "MENTION",
            title: `${session!.fullName} أشار إليك في مهمة`,
            body: parsed.data.body.slice(0, 140),
            entityType: "task",
            entityId: parsed.data.task_id,
          }),
          logAiEvent({
            organizationId: session!.orgId,
            actorUserId: session!.userId,
            eventType: "MENTION_CREATED",
            entityType: "task",
            entityId: parsed.data.task_id,
            payload: { mentioned_employee_id: r.employeeId, comment_id: comment.id },
          }),
        ]),
      ),
    );
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.comment_add",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      comment_id: comment.id,
      mentions: resolved.length,
      kind: parsed.data.kind,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_COMMENT_ADDED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {
      comment_id: comment.id,
      mentions: resolved.length,
      kind: parsed.data.kind,
    },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true, commentId: comment.id, mentionsResolved: resolved.length };
}

// =========================================================================
// Sky Light multi-role assignment.
// Set or clear the assignee for a single named slot on a task.
// Passing employee_id = null/"" clears the slot.
// =========================================================================
export async function assignTaskRoleAction(input: {
  taskId: string;
  roleType: string;
  employeeId: string | null;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TaskRoleAssignSchema.safeParse({
    task_id: input.taskId,
    role_type: input.roleType,
    employee_id: input.employeeId ?? null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Verify task exists in this org.
  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, project_id")
    .eq("id", parsed.data.task_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!task) return { error: "المهمة غير موجودة" };

  // Verify employee belongs to the org (when set).
  if (parsed.data.employee_id) {
    const { data: emp } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("id", parsed.data.employee_id)
      .eq("organization_id", session.orgId)
      .maybeSingle();
    if (!emp) return { error: "الموظف غير موجود" };
  }

  // Read prior assignee for this slot (for audit + clear-vs-replace logic).
  const { data: existingSlot } = await supabaseAdmin
    .from("task_assignees")
    .select("id, employee_id")
    .eq("task_id", parsed.data.task_id)
    .eq("role_type", parsed.data.role_type)
    .maybeSingle();

  if (parsed.data.employee_id === null) {
    // Clear slot.
    if (existingSlot) {
      await supabaseAdmin.from("task_assignees").delete().eq("id", existingSlot.id);
    }
  } else if (existingSlot) {
    // Replace slot's employee.
    if (existingSlot.employee_id !== parsed.data.employee_id) {
      const { error } = await supabaseAdmin
        .from("task_assignees")
        .update({
          employee_id: parsed.data.employee_id,
          assigned_by: session.userId,
        })
        .eq("id", existingSlot.id);
      if (error) return { error: error.message };
    }
  } else {
    // Insert new slot.
    const { error } = await supabaseAdmin.from("task_assignees").insert({
      organization_id: session.orgId,
      task_id: parsed.data.task_id,
      role_type: parsed.data.role_type,
      employee_id: parsed.data.employee_id,
      assigned_by: session.userId,
    });
    if (error) return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.assignee_change",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      role_type: parsed.data.role_type,
      from_employee_id: existingSlot?.employee_id ?? null,
      to_employee_id: parsed.data.employee_id,
    },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  if (task.project_id) revalidatePath(`/projects/${task.project_id}`);
  return { ok: true };
}
