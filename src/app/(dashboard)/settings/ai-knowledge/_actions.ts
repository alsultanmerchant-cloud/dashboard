"use server";

// /settings/ai-knowledge admin actions.
//
// Mutation contract: zod validate → getServerSession (org scope) → write via
// the ai-knowledge data layer → logAudit → revalidatePath. Teaching/managing
// org knowledge is open to any authenticated dashboard user (same as the
// select-text "teach" flow), so there is no extra permission gate here.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSession } from "@/lib/auth-server";
import { updateKnowledge, deleteKnowledge } from "@/lib/data/ai-knowledge";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const UpdateSchema = z.object({
  id: z.string().uuid(),
  instruction: z.string().min(3, "التعليمة قصيرة جدًا").max(2000),
  kind: z.enum(["correction", "fact", "preference", "terminology"]),
});

const ToggleSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });
const DeleteSchema = z.object({ id: z.string().uuid() });

export async function updateKnowledgeAction(input: {
  id: string;
  instruction: string;
  kind: "correction" | "fact" | "preference" | "terminology";
}): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { error: "Unauthorized" };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };

  const ok = await updateKnowledge(parsed.data.id, session.orgId, {
    instruction: parsed.data.instruction,
    kind: parsed.data.kind,
  });
  if (!ok) return { error: "تعذّر تحديث التعليمة" };
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "ai_knowledge.update",
    entityType: "ai_company_knowledge",
    entityId: parsed.data.id,
    metadata: { kind: parsed.data.kind },
  });
  revalidatePath("/settings/ai-knowledge");
  return { ok: true };
}

export async function toggleKnowledgeAction(input: {
  id: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { error: "Unauthorized" };
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const ok = await updateKnowledge(parsed.data.id, session.orgId, {
    isActive: parsed.data.isActive,
  });
  if (!ok) return { error: "تعذّر تحديث الحالة" };
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "ai_knowledge.update",
    entityType: "ai_company_knowledge",
    entityId: parsed.data.id,
    metadata: { is_active: parsed.data.isActive },
  });
  revalidatePath("/settings/ai-knowledge");
  return { ok: true };
}

export async function deleteKnowledgeAction(input: { id: string }): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { error: "Unauthorized" };
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const ok = await deleteKnowledge(parsed.data.id, session.orgId);
  if (!ok) return { error: "تعذّر حذف التعليمة" };
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "ai_knowledge.delete",
    entityType: "ai_company_knowledge",
    entityId: parsed.data.id,
  });
  revalidatePath("/settings/ai-knowledge");
  return { ok: true };
}
