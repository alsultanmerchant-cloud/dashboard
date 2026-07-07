"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const Schema = z.object({
  // A project qualifies as "at risk" at N+ overdue open tasks. 1..100 guards typos.
  projectsAtRiskThreshold: z.number().int().min(1, "القيمة صغيرة جدًا").max(100, "القيمة كبيرة جدًا"),
});

export async function updateKpiThresholdAction(input: {
  projectsAtRiskThreshold: number;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("settings.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };

  const { data: before } = await supabaseAdmin
    .from("kpi_settings")
    .select("setting_value")
    .eq("organization_id", session.orgId)
    .eq("setting_key", "projects_at_risk_threshold")
    .maybeSingle();

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("kpi_settings").upsert(
    {
      organization_id: session.orgId,
      setting_key: "projects_at_risk_threshold",
      setting_value: parsed.data.projectsAtRiskThreshold,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    },
    { onConflict: "organization_id,setting_key" },
  );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "settings.kpi_threshold_updated",
    entityType: "kpi_settings",
    entityId: null,
    metadata: {
      key: "projects_at_risk_threshold",
      from: before?.setting_value != null ? Number(before.setting_value) : null,
      to: parsed.data.projectsAtRiskThreshold,
    },
  });

  // The dashboard KPI is computed live from this value — refresh it.
  revalidatePath("/dashboard");
  revalidatePath("/settings/kpi");
  return { ok: true };
}
