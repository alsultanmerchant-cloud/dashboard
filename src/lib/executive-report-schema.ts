import { z } from "zod";
import type { ExecutiveReportFacts } from "@/lib/data/executive-report";

// =========================================================================
// Executive Report — AI narrative schemas.
//
// Four Gemini calls, one per report chapter. Every schema is prose-only:
// the model words the pre-computed facts (executive-report.ts) like a human
// analyst would — it never introduces a number that isn't in the facts.
// =========================================================================

// الملخص التنفيذي — the "a human wrote this for you" opener.
export const SummaryAiSchema = z.object({
  // 2-4 short paragraphs telling the period's story across all chapters.
  paragraphs: z.array(z.string().min(20)).min(2).max(4),
  // The 3-6 findings the CEO must not miss (each one sentence).
  keyFindings: z.array(z.string().min(10)).min(3).max(6),
  recommendations: z
    .array(
      z.object({
        area: z.string().min(2), // e.g. المال / التسليم / الفريق / العملاء
        action: z.string().min(10),
        owner: z.string().min(2), // the responsible role
      }),
    )
    .min(3)
    .max(6),
  bottomLine: z.string().min(10),
});

// Money & clients chapter (contracts month + satisfaction + renewals).
export const FinanceClientsAiSchema = z.object({
  paragraphs: z.array(z.string().min(20)).min(1).max(3),
});

// Delivery & execution chapter (indicators + services + client edits + dwell).
export const DeliveryAiSchema = z.object({
  paragraphs: z.array(z.string().min(20)).min(1).max(3),
});

// Team & accountability chapter (pulse + scorecard + designer output).
export const TeamAiSchema = z.object({
  paragraphs: z.array(z.string().min(20)).min(1).max(3),
});

export type SummaryAi = z.infer<typeof SummaryAiSchema>;
export type FinanceClientsAi = z.infer<typeof FinanceClientsAiSchema>;
export type DeliveryAi = z.infer<typeof DeliveryAiSchema>;
export type TeamAi = z.infer<typeof TeamAiSchema>;

export const REPORT_SECTIONS = ["summary", "financeClients", "delivery", "team"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

// What executive_report_runs.result_json stores. A null chapter = its AI call
// failed; the facts tables still render and the UI shows a soft warning.
export interface ExecutiveReportResult {
  summary: SummaryAi | null;
  financeClients: FinanceClientsAi | null;
  delivery: DeliveryAi | null;
  team: TeamAi | null;
}

export interface StoredExecutiveReport {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  rangeFrom: string;
  rangeTo: string;
  preset: string | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  facts: ExecutiveReportFacts | null;
  result: ExecutiveReportResult | null;
}

function parseOrNull<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Defensive read of a stored result_json (old/partial rows must not crash).
export function sanitizeExecutiveReportResult(raw: unknown): ExecutiveReportResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    summary: parseOrNull(SummaryAiSchema, obj.summary),
    financeClients: parseOrNull(FinanceClientsAiSchema, obj.financeClients),
    delivery: parseOrNull(DeliveryAiSchema, obj.delivery),
    team: parseOrNull(TeamAiSchema, obj.team),
  };
}
