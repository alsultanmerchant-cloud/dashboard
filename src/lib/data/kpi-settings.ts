import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Configurable KPI thresholds (Executive Indicators spec §9). Values live in
// the kpi_settings table (migration 0233); code falls back to these defaults
// when a row is absent so a fresh org still renders.
export const KPI_SETTING_DEFAULTS = {
  projects_at_risk_threshold: 5,
} as const;

export type KpiSettingKey = keyof typeof KPI_SETTING_DEFAULTS;

async function _getKpiSetting(orgId: string, key: KpiSettingKey): Promise<number> {
  const { data } = await supabaseAdmin
    .from("kpi_settings")
    .select("setting_value")
    .eq("organization_id", orgId)
    .eq("setting_key", key)
    .maybeSingle();
  const v = data?.setting_value;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : KPI_SETTING_DEFAULTS[key];
}
export const getKpiSetting = cache(_getKpiSetting);

export function getRiskThreshold(orgId: string): Promise<number> {
  return getKpiSetting(orgId, "projects_at_risk_threshold");
}
