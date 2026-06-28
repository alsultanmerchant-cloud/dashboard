"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { SLA_STAGE_KEYS } from "@/lib/data/sla";

type ActionResult = { ok: true; refreshed: number } | { error: string };

const RuleSchema = z.object({
  stageKey: z.enum(SLA_STAGE_KEYS as [string, ...string[]]),
  // 1 minute .. 7 days of working minutes — anything outside is a typo.
  maxMinutes: z.number().int().min(1, "القيمة صغيرة جدًا").max(10080, "القيمة كبيرة جدًا"),
  businessHoursOnly: z.boolean(),
});
const PayloadSchema = z.object({
  rules: z.array(RuleSchema).min(1).max(SLA_STAGE_KEYS.length),
});

export async function updateSlaRulesAction(input: {
  rules: { stageKey: string; maxMinutes: number; businessHoursOnly: boolean }[];
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("settings.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = PayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Snapshot current values for the audit diff.
  const { data: before } = await supabaseAdmin
    .from("sla_rules")
    .select("stage_key, max_minutes, business_hours_only")
    .eq("organization_id", session.orgId);
  const beforeByStage = new Map((before ?? []).map((r) => [r.stage_key, r]));

  const supa = await createServerSupabaseClient();
  const rows = parsed.data.rules.map((r) => ({
    organization_id: session.orgId,
    stage_key: r.stageKey,
    max_minutes: r.maxMinutes,
    business_hours_only: r.businessHoursOnly,
    severity: "high",
  }));
  const { error } = await supa
    .from("sla_rules")
    .upsert(rows, { onConflict: "organization_id,stage_key" });
  if (error) return { error: error.message };

  // On-time rate is precomputed in the accountability_scorecard cache, so a new
  // SLA only takes effect after a refresh. Recompute now so the change is
  // visible immediately instead of at the next 10-min cron tick.
  let refreshed = 0;
  const { data: refreshData, error: refreshErr } = await supabaseAdmin.rpc(
    "refresh_accountability_scorecard",
  );
  if (refreshErr) {
    // Non-fatal: the cron in 0193 will correct drift; surface in logs only.
    console.error("refresh_accountability_scorecard failed", refreshErr);
  } else {
    refreshed = (refreshData as number | null) ?? 0;
  }

  const changes = parsed.data.rules
    .map((r) => {
      const prev = beforeByStage.get(r.stageKey);
      return {
        stage: r.stageKey,
        from: prev?.max_minutes ?? null,
        to: r.maxMinutes,
        businessHoursOnly: r.businessHoursOnly,
      };
    })
    .filter((c) => c.from !== c.to);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "sla_rules.update",
    entityType: "sla_rules",
    entityId: null,
    metadata: { changes },
  });

  revalidatePath("/settings/sla");
  revalidatePath("/team-activity");
  revalidatePath("/accountability");
  return { ok: true, refreshed };
}
