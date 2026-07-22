"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { normalizeTitle } from "@/lib/tasks/normalize-title";
import { matchTemplatesForOrg } from "@/lib/tasks/match-templates";

// Manually pin an unlinked task to a template item (the review queue at
// /task-templates/unlinked). Writes the FK + status='manual' so the matcher
// never re-guesses it, then re-derives that task's owner map from the chosen
// item. When `createAlias` is set, records a (service, normalised-title) → item
// alias so every FUTURE task with the same title auto-links (linked_alias) —
// the queue teaches itself and coverage climbs instead of decaying.

const LinkSchema = z.object({
  taskId: z.string().uuid(),
  templateItemId: z.string().uuid(),
  createAlias: z.boolean().default(true),
});

export async function linkTaskToTemplate(input: {
  taskId: string;
  templateItemId: string;
  createAlias?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "مدخلات غير صالحة" };
  const { taskId, templateItemId, createAlias } = parsed.data;

  const session = await requirePermission("templates.manage");

  // Both rows must belong to the caller's org.
  const [{ data: task }, { data: item }] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("id, title, service_id, organization_id")
      .eq("id", taskId)
      .maybeSingle(),
    supabaseAdmin
      .from("task_template_items")
      .select("id, organization_id")
      .eq("id", templateItemId)
      .maybeSingle(),
  ]);
  if (!task || task.organization_id !== session.orgId) {
    return { ok: false, error: "المهمة غير موجودة" };
  }
  if (!item || item.organization_id !== session.orgId) {
    return { ok: false, error: "بند القالب غير موجود" };
  }

  const { error: updErr } = await supabaseAdmin
    .from("tasks")
    .update({
      task_template_item_id: templateItemId,
      template_match_status: "manual",
      template_match_confidence: 1,
      template_matched_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  if (updErr) return { ok: false, error: updErr.message };

  // Teach the alias so future same-title tasks in this service auto-link.
  const norm = normalizeTitle(task.title);
  if (createAlias && norm) {
    let del = supabaseAdmin
      .from("task_template_aliases")
      .delete()
      .eq("organization_id", session.orgId)
      .eq("norm_title", norm);
    del = task.service_id
      ? del.eq("service_id", task.service_id)
      : del.is("service_id", null);
    await del;
    const { error: aliasErr } = await supabaseAdmin
      .from("task_template_aliases")
      .insert({
        organization_id: session.orgId,
        service_id: task.service_id,
        norm_title: norm,
        task_template_item_id: templateItemId,
        created_by: session.employeeId ?? null,
      });
    if (aliasErr) console.error("[alias_insert_failed]", aliasErr.message);
  }

  // Derive this task's owner map from the pinned item (matcher lets `manual`
  // links fall through to map derivation).
  try {
    await matchTemplatesForOrg(session.orgId, { taskIds: [taskId] });
  } catch (e) {
    console.error("[link_task_rematch_failed]", (e as Error).message);
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.template_link",
    entityType: "task",
    entityId: taskId,
    metadata: { templateItemId, createAlias: Boolean(createAlias) },
  });

  revalidatePath("/task-templates/unlinked");
  return { ok: true };
}
