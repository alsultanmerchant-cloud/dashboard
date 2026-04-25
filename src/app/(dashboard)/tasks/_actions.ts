"use server";

import { revalidatePath } from "next/cache";
import { TaskStatusUpdateSchema, TaskCommentSchema } from "@/lib/schemas";
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

export type CommentResult =
  | { ok: true; commentId: string; mentionsResolved: number }
  | { error: string };

export async function addTaskCommentAction(input: {
  taskId: string;
  body: string;
  isInternal?: boolean;
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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, project_id")
    .eq("id", parsed.data.task_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!task) return { error: "المهمة غير موجودة" };

  const { data: comment, error } = await supabaseAdmin
    .from("task_comments")
    .insert({
      organization_id: session.orgId,
      task_id: parsed.data.task_id,
      author_user_id: session.userId,
      body: parsed.data.body,
      is_internal: parsed.data.is_internal,
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
    metadata: { comment_id: comment.id, mentions: resolved.length },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_COMMENT_ADDED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: { comment_id: comment.id, mentions: resolved.length },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true, commentId: comment.id, mentionsResolved: resolved.length };
}
