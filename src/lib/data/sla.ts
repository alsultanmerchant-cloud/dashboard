import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Stage SLA rules (sla_rules) — the per-stage response targets that drive the
// "on-time rate" (60% of the accountability score). Seeded in migration 0147
// as internal defaults; editable here so heads tune them to how Sky Light
// actually works instead of relying on un-sourced guesses.
//
// Only stages that have an org-level rule are managed here. New / In Progress
// / Done carry NO org default (in_progress is per-task via
// task_template_items.stage_sla_overrides), so they're intentionally absent.
// =========================================================================

// The stages an org-level SLA applies to, in workflow order, with the role the
// rule effectively measures (mirrors ROLE_STAGES in accountability.ts).
export const SLA_STAGES = [
  {
    key: "client_changes",
    label: "تعديلات العميل",
    role: "المنفّذ (المختص)",
    hint: "زمن معالجة طلب تعديل من العميل حتى إعادة العمل.",
  },
  {
    key: "specialist_review",
    label: "مراجعة المختص",
    role: "المختص المُراجِع",
    hint: "زمن مراجعة المختص للعمل قبل تمريره.",
  },
  {
    key: "manager_review",
    label: "مراجعة المدير",
    role: "قائد الفريق / رئيس القسم",
    hint: "زمن مراجعة المدير واعتماد العمل.",
  },
  {
    key: "ready_to_send",
    label: "جاهز للإرسال",
    role: "مدير الحسابات",
    hint: "زمن تجهيز العمل المعتمد لإرساله للعميل.",
  },
  {
    key: "sent_to_client",
    label: "أُرسل للعميل",
    role: "مدير الحسابات",
    hint: "زمن المتابعة بعد الإرسال للعميل.",
  },
] as const;

export type SlaStageKey = (typeof SLA_STAGES)[number]["key"];
export const SLA_STAGE_KEYS = SLA_STAGES.map((s) => s.key) as readonly SlaStageKey[];

export interface SlaRuleRow {
  stageKey: SlaStageKey;
  label: string;
  role: string;
  hint: string;
  maxMinutes: number | null; // null = no rule set yet for this stage
  businessHoursOnly: boolean;
}

async function _getSlaRules(orgId: string): Promise<SlaRuleRow[]> {
  const { data, error } = await supabaseAdmin
    .from("sla_rules")
    .select("stage_key, max_minutes, business_hours_only")
    .eq("organization_id", orgId);
  if (error) throw error;

  const byStage = new Map(
    (data ?? []).map((r) => [r.stage_key, r]),
  );

  // Return one row per managed stage, in workflow order, so the form always
  // renders the full set even if a stage has no rule row yet.
  return SLA_STAGES.map((s) => {
    const r = byStage.get(s.key);
    return {
      stageKey: s.key,
      label: s.label,
      role: s.role,
      hint: s.hint,
      maxMinutes: r?.max_minutes ?? null,
      businessHoursOnly: r?.business_hours_only ?? true,
    };
  });
}

export const getSlaRules = cache(_getSlaRules);
