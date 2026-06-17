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

export type CeoBriefEventSource = "client_group" | "technical_group" | "system";
export type CeoBriefEventCategory =
  | "complaint"
  | "approval"
  | "delay"
  | "internal"
  | "decision";

export interface CeoBriefEvent {
  id: string;
  title: string;
  date: string | null;
  source: CeoBriefEventSource;
  category: CeoBriefEventCategory;
  severity: "critical" | "high" | "medium" | "low";
  href: string | null;
}

export interface CeoBriefResult {
  statusPct: number;
  grade: string;
  verdict: Verdict;
  headline: string;
  changes: BriefChange[];
  risks: CeoBriefRiskRendered[];
  criticalEvents?: CeoBriefEvent[];
  timelineEvents?: CeoBriefEvent[];
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

// =========================================================================
// Inline brief editing (select-text → "correct this" feature).
//
// A field key maps a text selection to one editable prose field of a brief.
// Shared by the dashboard-assistant route (server write to result_json) and
// the brief card (optimistic client re-render). Numbers/badges are never
// editable — only the four AI-written prose surfaces.
// =========================================================================

// headline | bottomLine | rec:<index> | risk:<risk_id>
export const BRIEF_FIELD_RE = /^(headline|bottomLine|rec:\d+|risk:[a-z_]+)$/;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export type BriefPatchOutcome =
  | { ok: true; next: CeoBriefResult; oldValue: string }
  | { ok: false; error: string };

/**
 * Pure: return a clone of `result` with the prose field identified by `field`
 * replaced by `text` (collapsed to one line, like generation does). Never
 * mutates the input. Returns an error outcome for unknown/missing fields.
 */
export function applyBriefPatch(
  result: CeoBriefResult,
  field: string,
  text: string,
): BriefPatchOutcome {
  if (!BRIEF_FIELD_RE.test(field)) return { ok: false, error: "حقل غير مدعوم" };
  const next: CeoBriefResult = structuredClone(result);
  const value = oneLine(text);

  if (field === "headline") {
    const oldValue = next.headline;
    next.headline = value;
    return { ok: true, next, oldValue };
  }
  if (field === "bottomLine") {
    const oldValue = next.bottomLine;
    next.bottomLine = value;
    return { ok: true, next, oldValue };
  }
  if (field.startsWith("rec:")) {
    const i = Number(field.slice(4));
    const rec = next.recommendations?.[i];
    if (!rec) return { ok: false, error: "التوصية غير موجودة" };
    const oldValue = rec.action;
    rec.action = value;
    return { ok: true, next, oldValue };
  }
  // risk:<id>
  const id = field.slice(5);
  const risk = next.risks?.find((r) => r.id === id);
  if (!risk) return { ok: false, error: "الخطر غير موجود" };
  const oldValue = risk.interpretation;
  risk.interpretation = value;
  return { ok: true, next, oldValue };
}
