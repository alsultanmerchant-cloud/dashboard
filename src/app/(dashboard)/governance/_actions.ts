"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ResolveSchema = z.object({
  id: z.string().regex(UUID_RE, { message: "معرّف غير صالح" }),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type GovernanceActionState =
  | { ok: true }
  | { error: string };

export async function resolveViolationAction(
  _prev: GovernanceActionState | undefined,
  formData: FormData,
): Promise<GovernanceActionState> {
  let session;
  try {
    session = await requirePermission("governance.resolve");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ResolveSchema.safeParse({
    id: formData.get("id"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: existing } = await supabaseAdmin
    .from("governance_violations")
    .select("id, organization_id, task_id, kind, resolved_at, note")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!existing || existing.organization_id !== session.orgId) {
    return { error: "المخالفة غير موجودة" };
  }
  if (existing.resolved_at) {
    return { error: "المخالفة مغلقة مسبقًا" };
  }

  const finalNote =
    parsed.data.note ??
    (existing.note && existing.note.length > 0 ? existing.note : null);

  const { error } = await supabaseAdmin
    .from("governance_violations")
    .update({
      resolved_at: new Date().toISOString(),
      resolver_user_id: session.userId,
      note: finalNote,
    })
    .eq("id", parsed.data.id)
    .eq("organization_id", session.orgId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "governance.resolve",
    entityType: "governance_violation",
    entityId: parsed.data.id,
    metadata: {
      kind: existing.kind,
      task_id: existing.task_id,
      note: parsed.data.note ?? null,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "GOVERNANCE_VIOLATION_RESOLVED",
    entityType: "governance_violation",
    entityId: parsed.data.id,
    payload: { kind: existing.kind, task_id: existing.task_id },
    importance: "normal",
  });

  revalidatePath("/governance");
  revalidatePath("/dashboard");
  return { ok: true };
}
