"use server";

// Sub-task creation + timesheet entries (migration 0056).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const SubtaskSchema = z.object({
  parent_task_id: z.string().uuid(),
  title: z.string().trim().min(2, "العنوان قصير").max(200),
});

const TimesheetSchema = z.object({
  task_id: z.string().uuid(),
  hours: z.coerce.number().min(0.05).max(24),
  spent_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح")
    .optional(),
  description: z.string().trim().max(1000).optional(),
});

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function createSubtaskAction(input: {
  parentTaskId: string;
  title: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SubtaskSchema.safeParse({
    parent_task_id: input.parentTaskId,
    title: input.title,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: parent } = await supabaseAdmin
    .from("tasks")
    .select("id, organization_id, project_id")
    .eq("id", parsed.data.parent_task_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!parent) return { error: "المهمة الأم غير موجودة" };

  const { error } = await supabaseAdmin.from("tasks").insert({
    organization_id: session.orgId,
    project_id: parent.project_id,
    parent_task_id: parent.id,
    title: parsed.data.title,
    created_by: session.userId,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.subtask_create",
    entityType: "task",
    entityId: parent.id,
    metadata: { title: parsed.data.title },
  });

  revalidatePath(`/tasks/${parent.id}`);
  return { ok: true };
}

export async function addTimesheetAction(input: {
  taskId: string;
  hours: number;
  spentOn?: string;
  description?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = TimesheetSchema.safeParse({
    task_id: input.taskId,
    hours: input.hours,
    spent_on: input.spentOn,
    description: input.description,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  if (!session.employeeId) {
    return { error: "حسابك غير مرتبط بسجل موظف" };
  }

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("task_timesheets").insert({
    organization_id: session.orgId,
    task_id: parsed.data.task_id,
    employee_id: session.employeeId,
    hours: parsed.data.hours,
    spent_on: parsed.data.spent_on ?? new Date().toISOString().slice(0, 10),
    description: parsed.data.description ?? null,
    created_by: session.userId,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.timesheet_add",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      hours: parsed.data.hours,
      spent_on: parsed.data.spent_on,
    },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}

export async function deleteTimesheetAction(input: {
  id: string;
  taskId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DeleteSchema.safeParse({ id: input.id });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("task_timesheets").delete().eq("id", parsed.data.id);
  if (error) return { error: error.message };

  revalidatePath(`/tasks/${input.taskId}`);
  return { ok: true };
}
