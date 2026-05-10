"use server";

// Sky Light feedback #16: per-project holidays / blackouts. The schema +
// recalculate_project_task_dates already honor them (migration 0091). This
// file is the small server-action surface so the project page can
// add/remove blackouts without going through the full /settings/holidays
// org admin.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const CreateSchema = z.object({
  project_id: z.string().uuid(),
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  name: z.string().trim().min(2, "الاسم قصير").max(120),
  recurring: z.boolean().default(false),
});

const DeleteSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
});

// Re-shift dependent task dates after a holiday change. Best-effort — if
// the project has no task_links it's a noop. Errors are logged, not
// surfaced, since the holiday itself was saved successfully.
async function recalcProject(projectId: string) {
  const { error } = await supabaseAdmin.rpc("recalculate_project_task_dates", {
    p_project: projectId,
  });
  if (error) console.error("recalculate_project_task_dates failed", error);
}

export async function createProjectHolidayAction(input: {
  projectId: string;
  date: string;
  name: string;
  recurring?: boolean;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreateSchema.safeParse({
    project_id: input.projectId,
    holiday_date: input.date,
    name: input.name,
    recurring: input.recurring ?? false,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("project_holidays").insert({
    organization_id: session.orgId,
    project_id: parsed.data.project_id,
    holiday_date: parsed.data.holiday_date,
    name: parsed.data.name,
    recurring: parsed.data.recurring,
    created_by: session.userId,
  });
  if (error) {
    if (error.code === "23505") return { error: "هذا التاريخ مسجل بالفعل بهذا الاسم" };
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project_holiday.create",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: parsed.data,
  });

  await recalcProject(parsed.data.project_id);
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}

export async function deleteProjectHolidayAction(input: {
  id: string;
  projectId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DeleteSchema.safeParse({ id: input.id, project_id: input.projectId });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();
  const { error } = await supa
    .from("project_holidays")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project_holiday.delete",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { holiday_id: parsed.data.id },
  });

  await recalcProject(parsed.data.project_id);
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}
