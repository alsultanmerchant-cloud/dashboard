"use server";

// Designer output counts on a single task.
// Two integer fields drive the monthly designer-closing report:
//   • design_count   — new designs/posts produced (Odoo: project_customization)
//   • revision_count — edits / revisions on existing designs
// Both default to 0; the report sums them per assignee across a month.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const SetCountsSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  design_count: z
    .number()
    .int("يجب أن يكون عددًا صحيحًا")
    .min(0, "لا يمكن أن يكون سالبًا")
    .max(10000, "العدد كبير جدًا"),
  revision_count: z
    .number()
    .int("يجب أن يكون عددًا صحيحًا")
    .min(0, "لا يمكن أن يكون سالبًا")
    .max(10000, "العدد كبير جدًا"),
});

export async function setTaskCountsAction(input: {
  taskId: string;
  designCount: number;
  revisionCount: number;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetCountsSchema.safeParse({
    task_id: input.taskId,
    design_count: input.designCount,
    revision_count: input.revisionCount,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({
      design_count: parsed.data.design_count,
      revision_count: parsed.data.revision_count,
    })
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.task_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.counts_set",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      design_count: parsed.data.design_count,
      revision_count: parsed.data.revision_count,
    },
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true };
}
