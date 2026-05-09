"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const STAGE_KEYS = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
] as const;

const ROLE_KEYS = [
  "specialist",
  "manager",
  "agent",
  "account_manager",
  "supporting_lead",
  "supporting_agent",
] as const;

const StageOwnerSchema = z.object({
  itemId: z.string().uuid(),
  // Map: stage → role-key (or null for "no owner"). Unknown stages are
  // ignored; unknown roles are rejected.
  mapping: z.record(z.string(), z.union([z.enum(ROLE_KEYS), z.null()])),
});

export type StageOwnerResult = { ok: true } | { ok: false; error: string };

export async function updateStageOwnerPositionsAction(
  input: { itemId: string; mapping: Record<string, string | null> },
): Promise<StageOwnerResult> {
  let session;
  try {
    session = await requirePermission("templates.manage");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = StageOwnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Filter the incoming mapping to known stage keys only — keeps the JSON
  // tidy and protects against typos in the client payload.
  const cleaned: Record<string, string | null> = {};
  for (const stage of STAGE_KEYS) {
    cleaned[stage] = (parsed.data.mapping[stage] ?? null) as string | null;
  }

  // Verify the item belongs to the caller's org BEFORE writing.
  const { data: existing } = await supabaseAdmin
    .from("task_template_items")
    .select("id, organization_id, task_template_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!existing || existing.organization_id !== session.orgId) {
    return { ok: false, error: "البند غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("task_template_items")
    .update({ stage_owner_positions: cleaned })
    .eq("id", parsed.data.itemId)
    .eq("organization_id", session.orgId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_template_item.update_stage_owners",
    entityType: "task_template_item",
    entityId: parsed.data.itemId,
    metadata: { mapping: cleaned, template_id: existing.task_template_id },
  });
  revalidatePath(`/task-templates/${existing.task_template_id}`);
  return { ok: true };
}
