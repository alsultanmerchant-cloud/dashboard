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
  // نبض الفريق «محمّل زائد»: an agent is overloaded above N active projects.
  overloadProjectsThreshold: z.number().int().min(1, "القيمة صغيرة جدًا").max(100, "القيمة كبيرة جدًا"),
});

const KEY_MAP: Record<keyof z.infer<typeof Schema>, string> = {
  projectsAtRiskThreshold: "projects_at_risk_threshold",
  overloadProjectsThreshold: "team_overload_projects_threshold",
};

export async function updateKpiThresholdAction(input: {
  projectsAtRiskThreshold: number;
  overloadProjectsThreshold: number;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("settings.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };

  const { data: beforeRows } = await supabaseAdmin
    .from("kpi_settings")
    .select("setting_key, setting_value")
    .eq("organization_id", session.orgId)
    .in("setting_key", Object.values(KEY_MAP));
  const before = new Map(
    (beforeRows ?? []).map((r) => [r.setting_key, Number(r.setting_value)]),
  );

  const now = new Date().toISOString();
  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("kpi_settings").upsert(
    (Object.keys(KEY_MAP) as (keyof typeof KEY_MAP)[]).map((field) => ({
      organization_id: session.orgId,
      setting_key: KEY_MAP[field],
      setting_value: parsed.data[field],
      updated_at: now,
      updated_by: session.userId,
    })),
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
      changes: (Object.keys(KEY_MAP) as (keyof typeof KEY_MAP)[]).map((field) => ({
        key: KEY_MAP[field],
        from: before.get(KEY_MAP[field]) ?? null,
        to: parsed.data[field],
      })),
    },
  });

  // Both values are read live by the dashboard / نبض الفريق — refresh them.
  revalidatePath("/dashboard");
  revalidatePath("/team-activity");
  revalidatePath("/settings/kpi");
  return { ok: true };
}
