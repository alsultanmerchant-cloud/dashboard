// Pure merge helpers for the CEO brief. Shared by the blocking generator
// (generateAndStoreCeoBrief), the streaming re-analyze route (persist-on-finish),
// and the client card (optimistic reconcile) so result_json is assembled
// identically no matter which path produced a section. No server-only / DB
// imports — only types — so this is safe to import on the client too.
import type { BriefRisk, CeoBriefSignals } from "@/lib/data/ceo-brief-signals";
import type {
  CeoBriefResult,
  CeoBriefRiskRendered,
  TrajectoryAi,
  RisksAi,
  ActionsAi,
  SynthesisAi,
} from "@/lib/ceo-brief-schema";

export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

type RiskNote = RisksAi["riskNotes"][number];

// Rebuild the rendered risk array from the CURRENT code-computed signals, then
// overlay each AI interpretation by id (robust to ordering). A risk with no
// matching note falls back to its metric string. Used server-side where the
// fresh signal risks are authoritative (e.g. dismissed risks already removed).
export function mergeRisks(
  signalRisks: BriefRisk[],
  notes: RiskNote[],
): CeoBriefRiskRendered[] {
  const noteById = new Map(notes.map((n) => [n.id, n] as const));
  return signalRisks.map((r) => {
    const { weight, ...rest } = r;
    void weight;
    return { ...rest, interpretation: noteById.get(r.id)?.interpretation ?? r.metric };
  });
}

// Overlay AI interpretations onto an already-rendered risk array (keeps the
// code-computed id/title/severity/metric/href). Used on the client, which has
// the rendered risks but not the raw signals.
export function overlayRiskNotes(
  rendered: CeoBriefRiskRendered[],
  notes: RiskNote[],
): CeoBriefRiskRendered[] {
  const noteById = new Map(notes.map((n) => [n.id, n] as const));
  return rendered.map((r) => ({
    ...r,
    interpretation: noteById.get(r.id)?.interpretation ?? r.interpretation,
  }));
}

// Apply one section's AI output onto a CeoBriefResult, replacing only that
// section's fields and leaving everything else (other sections + all
// code-computed fields) untouched.
export function applyTrajectory(base: CeoBriefResult, ai: TrajectoryAi): CeoBriefResult {
  return { ...base, headline: oneLine(ai.headline) };
}

// Like applyTrajectory but also refreshes the Q1 code-computed fields from fresh
// signals — used when re-analyzing pulls live data (so statusPct/grade/verdict/
// changes update, not just the AI headline).
export function applyTrajectoryFromSignals(
  base: CeoBriefResult,
  signals: Pick<CeoBriefSignals, "statusPct" | "grade" | "verdict" | "changes">,
  ai: TrajectoryAi,
): CeoBriefResult {
  return {
    ...base,
    statusPct: signals.statusPct,
    grade: signals.grade,
    verdict: signals.verdict,
    changes: signals.changes,
    headline: oneLine(ai.headline),
  };
}

export function applyRisks(
  base: CeoBriefResult,
  signalRisks: BriefRisk[],
  ai: RisksAi,
): CeoBriefResult {
  return { ...base, risks: mergeRisks(signalRisks, ai.riskNotes) };
}

export function applySynthesis(base: CeoBriefResult, ai: SynthesisAi): CeoBriefResult {
  return { ...base, synthesis: oneLine(ai.synthesis) };
}

export function applyActions(base: CeoBriefResult, ai: ActionsAi): CeoBriefResult {
  return {
    ...base,
    recommendations: ai.recommendations.map((r) => ({
      category: r.category,
      action: oneLine(r.action),
      owner: oneLine(r.owner),
    })),
    bottomLine: oneLine(ai.bottomLine),
  };
}
