"use server";

// Server actions for task_links (migration 0051). Mutations require
// `tasks.manage`. Cycle and same-project enforcement happen in the DB.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logAudit, logAiEvent } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const DepType = z.enum([
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);

const CreateSchema = z.object({
  project_id: z.string().uuid(),
  source_task_id: z.string().uuid(),
  target_task_id: z.string().uuid(),
  dependency_type: DepType.default("finish_to_start"),
  lag_days: z.coerce.number().int().min(-365).max(365).default(0),
});

const UpdateSchema = z.object({
  link_id: z.string().uuid(),
  dependency_type: DepType.optional(),
  lag_days: z.coerce.number().int().min(-365).max(365).optional(),
});

const DeleteSchema = z.object({ link_id: z.string().uuid() });

const RecalcSchema = z.object({ project_id: z.string().uuid() });

export async function createTaskLinkAction(input: {
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
  dependencyType?: z.infer<typeof DepType>;
  lagDays?: number;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreateSchema.safeParse({
    project_id: input.projectId,
    source_task_id: input.sourceTaskId,
    target_task_id: input.targetTaskId,
    dependency_type: input.dependencyType ?? "finish_to_start",
    lag_days: input.lagDays ?? 0,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  if (parsed.data.source_task_id === parsed.data.target_task_id) {
    return { error: "لا يمكن ربط المهمة بنفسها" };
  }

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("task_links").insert({
    organization_id: session.orgId,
    source_task_id: parsed.data.source_task_id,
    target_task_id: parsed.data.target_task_id,
    dependency_type: parsed.data.dependency_type,
    lag_days: parsed.data.lag_days,
    created_by: session.userId,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_link.create",
    entityType: "task",
    entityId: parsed.data.target_task_id,
    metadata: {
      source_task_id: parsed.data.source_task_id,
      dependency_type: parsed.data.dependency_type,
      lag_days: parsed.data.lag_days,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_LINK_CREATED",
    entityType: "task",
    entityId: parsed.data.target_task_id,
    payload: {
      source_task_id: parsed.data.source_task_id,
      dependency_type: parsed.data.dependency_type,
      lag_days: parsed.data.lag_days,
    },
    importance: "low",
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath(`/projects/${parsed.data.project_id}/gantt`);
  revalidatePath(`/tasks/${parsed.data.source_task_id}`);
  revalidatePath(`/tasks/${parsed.data.target_task_id}`);
  return { ok: true };
}

export async function updateTaskLinkAction(input: {
  linkId: string;
  dependencyType?: z.infer<typeof DepType>;
  lagDays?: number;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = UpdateSchema.safeParse({
    link_id: input.linkId,
    dependency_type: input.dependencyType,
    lag_days: input.lagDays,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.dependency_type !== undefined) patch.dependency_type = parsed.data.dependency_type;
  if (parsed.data.lag_days !== undefined) patch.lag_days = parsed.data.lag_days;
  if (Object.keys(patch).length === 0) return { ok: true };

  const supa = await createServerSupabaseClient();
  const { data: row, error } = await supa
    .from("task_links")
    .update(patch)
    .eq("id", parsed.data.link_id)
    .select("source_task_id, target_task_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "الربط غير موجود" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_link.update",
    entityType: "task",
    entityId: row.target_task_id,
    metadata: { link_id: parsed.data.link_id, ...patch },
  });

  // Path revalidation we can do without project_id lookup.
  revalidatePath(`/tasks/${row.source_task_id}`);
  revalidatePath(`/tasks/${row.target_task_id}`);
  return { ok: true };
}

export async function deleteTaskLinkAction(input: {
  linkId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DeleteSchema.safeParse({ link_id: input.linkId });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  // Read link to get project context for revalidation + audit.
  const { data: link } = await supabaseAdmin
    .from("task_links")
    .select("source_task_id, target_task_id, organization_id")
    .eq("id", parsed.data.link_id)
    .maybeSingle();
  if (!link) return { error: "الربط غير موجود" };

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("task_links").delete().eq("id", parsed.data.link_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_link.delete",
    entityType: "task",
    entityId: link.target_task_id,
    metadata: {
      link_id: parsed.data.link_id,
      source_task_id: link.source_task_id,
    },
  });

  revalidatePath(`/tasks/${link.source_task_id}`);
  revalidatePath(`/tasks/${link.target_task_id}`);
  return { ok: true };
}

export async function recalculateProjectDatesAction(input: {
  projectId: string;
}): Promise<{ ok: true; changes: number } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RecalcSchema.safeParse({ project_id: input.projectId });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();
  const { data, error } = await supa.rpc("recalculate_project_task_dates", {
    p_project: parsed.data.project_id,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.dates_recalculated",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { changes: data ?? 0 },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath(`/projects/${parsed.data.project_id}/gantt`);
  return { ok: true, changes: (data as number | null) ?? 0 };
}
