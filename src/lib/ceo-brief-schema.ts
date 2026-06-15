import { z } from "zod";
import type { BriefChange, BriefRisk, Verdict } from "@/lib/data/ceo-brief-signals";

// =========================================================================
// CEO Brief — AI output schema.
//
// Hybrid by design: ALL numbers (verdict, statusPct, change deltas, risk
// metrics) are computed in code (ceo-brief-signals.ts). Gemini only writes
// prose: the one-line headline, a per-risk interpretation + action keyed by
// the risk id, and a single bottom-line. It never emits a figure.
// =========================================================================

export const RISK_IDS = [
  "delivery_slip",
  "intake_bottleneck",
  "client_churn",
  "stuck_project",
  "idle_people",
  "review_bottleneck",
  "overdue_money",
  "at_risk_client",
  "weak_index",
] as const;

export const REC_CATEGORIES = ["delivery", "people", "clients", "money", "growth"] as const;
export type RecCategory = (typeof REC_CATEGORIES)[number];

export const CeoBriefAiSchema = z.object({
  headline: z
    .string()
    .describe(
      "جملة واحدة حاسمة بالعربية تجيب: هل الشركة تتحسّن أم تتراجع ولماذا. تستند للحكم والتغيّرات المعطاة فقط، بدون اختراع أرقام.",
    ),
  riskNotes: z
    .array(
      z.object({
        id: z
          .enum(RISK_IDS)
          .describe("معرّف الخطر — يجب أن يطابق أحد المخاطر المعطاة"),
        interpretation: z
          .string()
          .describe("جملة قصيرة: لماذا هذا خطر وما أثره على الأعمال"),
      }),
    )
    .describe("ملاحظة لكل خطر معطى، مرتبطة بمعرّفه"),
  recommendations: z
    .array(
      z.object({
        category: z
          .enum(REC_CATEGORIES)
          .describe("مجال القرار: التسليم/الأفراد/العملاء/المال/النمو"),
        action: z.string().describe("إجراء عملي واحد محدّد وقابل للتنفيذ"),
        owner: z.string().describe("من يتحرك — الدور أو الجهة المسؤولة"),
      }),
    )
    .min(3)
    .max(6)
    .describe(
      "خطة عمل متنوّعة (٣-٦ بنود) تغطي المخاطر والفرص معًا عبر مجالات مختلفة، لا تتمحور حول عميل واحد",
    ),
  bottomLine: z
    .string()
    .describe("جملة واحدة: أهم إجراء يجب أن يتخذه الرئيس التنفيذي اليوم"),
});

export type CeoBriefAi = z.infer<typeof CeoBriefAiSchema>;

// The merged record stored in ceo_brief_runs.result_json and rendered by the
// dashboard card: code-computed facts + AI narrative woven in.
export interface CeoBriefRiskRendered extends Omit<BriefRisk, "weight"> {
  interpretation: string;
}

export interface CeoBriefRecommendation {
  category: RecCategory;
  action: string;
  owner: string;
}

export interface CeoBriefResult {
  statusPct: number;
  grade: string;
  verdict: Verdict;
  headline: string;
  changes: BriefChange[];
  risks: CeoBriefRiskRendered[];
  recommendations: CeoBriefRecommendation[];
  bottomLine: string;
}

export interface StoredCeoBrief {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  result: CeoBriefResult | null;
}
