"use server";

// Odoo-style favorite star next to the task title. Maps to tasks.is_important
// — synced from Odoo project.task.ks_mark_important ("Mark As Important").

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const ToggleStarSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  starred: z.boolean(),
});

export async function toggleTaskStarAction(input: {
  taskId: string;
  starred: boolean;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ToggleStarSchema.safeParse({
    task_id: input.taskId,
    starred: input.starred,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ is_important: parsed.data.starred })
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.star_toggled",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: { starred: parsed.data.starred },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}
