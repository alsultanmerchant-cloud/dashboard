import type { SatisfactionResult } from "@/lib/satisfaction-schema";

export type RecommendationLiveState = "open" | "resolved" | "needs_confirmation";
export type RecommendationResolutionReason =
  | "linked_tasks_open"
  | "linked_tasks_resolved"
  | "linked_tasks_unverifiable"
  | "overdue_tasks_open"
  | "overdue_tasks_resolved"
  | "brief_missing"
  | "brief_attached"
  | "manual_confirmed"
  | "unverifiable";

export interface RecommendationTaskState {
  id: string;
  taskCode: string;
  stage: string;
  archived: boolean;
}

export interface RecommendationLiveStatus {
  recommendationIndex: number;
  state: RecommendationLiveState;
  reason: RecommendationResolutionReason;
  checkedAt: string;
  openTaskCount: number | null;
  liveOverdueCount: number | null;
  matchedTasks: RecommendationTaskState[];
}

export type SatisfactionRecommendation =
  SatisfactionResult["recommendations"][number];

export interface ResolutionOverlayEntry {
  state: "resolved" | "cleared";
  createdAt: string;
}

// The resolution overlay is the append-only ai_events stream
// (SATISFACTION_RECOMMENDATION_STATUS_CHANGED on a satisfaction_analysis)
// written by the manual "تأكيد أنها حُلّت" button and the AI refresh pass.
// It is keyed by the exact issue TEXT, never by array index: the UI shows
// derived cards (overdue / first-risk) whose index sits past the end of the
// stored recommendations array, so index-based matching could never resolve
// them. Events must be passed oldest-first; the last write per issue wins,
// so a later `cleared` re-opens an earlier `resolved` purely by being newer.
export function foldResolutionOverlayEvents(
  events: ReadonlyArray<{ payload: unknown; created_at: string }>,
): Map<string, ResolutionOverlayEntry> {
  const latestByIssue = new Map<string, ResolutionOverlayEntry>();
  for (const event of events) {
    const payload = event.payload;
    if (!payload || Array.isArray(payload) || typeof payload !== "object")
      continue;
    const { state, issue } = payload as { state?: unknown; issue?: unknown };
    if (
      (state !== "resolved" && state !== "cleared") ||
      typeof issue !== "string"
    )
      continue;
    latestByIssue.set(issue, { state, createdAt: event.created_at });
  }
  return latestByIssue;
}

// Indicator chips (المؤشرات) are frozen {code, date, evidence} triples rather
// than free-text findings, so they need a deterministic text key to take part
// in the issue-keyed resolution overlay above. The evidence line is what the
// operator actually reads on the chip; fall back to code+date when the model
// emitted none, so the key is never empty and never collides across dates.
export function indicatorIssueKey(indicator: {
  code: string;
  date?: string | null;
  evidence?: string | null;
}): string {
  const evidence = indicator.evidence?.trim();
  return evidence
    ? `${indicator.code}: ${evidence}`
    : `${indicator.code}@${indicator.date ?? "—"}`;
}

// Human-readable task codes are intentionally the bridge for legacy AI output:
// old recommendations predate structured entity references, but already mention
// codes such as PRJ-01826-022 in their issue/action text.
const TASK_CODE_RE = /\bPRJ-\d+(?:-\d+)+\b/giu;
const TASK_WORD_RE = /(?:مهمة|مهام|مهمتين|task(?:s)?)/iu;
const DELAY_WORD_RE = /(?:متأخر|متأخرة|متأخرات|تأخر|تأخير|متعثر|متعطّل|عالق|overdue|delay(?:ed)?|stuck)/iu;
const BRIEF_WORD_RE = /(?:بريف|brief)/iu;
const MISSING_WORD_RE = /(?:ناقص|ناقصة|مفقود|غير\s+(?:متاح|متوفر|موجود)|missing|absent|unavailable)/iu;

export function extractRecommendationTaskCodes(
  recommendation: SatisfactionRecommendation,
): string[] {
  const matches = `${recommendation.issue}\n${recommendation.action}`.match(TASK_CODE_RE) ?? [];
  return [
    ...new Set(
      [...(recommendation.taskCodes ?? []), ...matches]
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function isOverdueTaskRecommendation(
  recommendation: SatisfactionRecommendation,
): boolean {
  if (recommendation.resolutionKind === "no_overdue_tasks") return true;
  const text = `${recommendation.issue}\n${recommendation.action}`;
  return TASK_WORD_RE.test(text) && DELAY_WORD_RE.test(text);
}

export function isMissingBriefRecommendation(
  recommendation: SatisfactionRecommendation,
): boolean {
  if (recommendation.resolutionKind === "brief_attached") return true;
  const text = `${recommendation.issue}\n${recommendation.action}`;
  return BRIEF_WORD_RE.test(text) && MISSING_WORD_RE.test(text);
}

export function classifyRecommendationLiveStatus({
  recommendation,
  recommendationIndex,
  tasksByCode,
  liveOverdueCount,
  hasBrief,
  checkedAt,
}: {
  recommendation: SatisfactionRecommendation;
  recommendationIndex: number;
  tasksByCode: ReadonlyMap<string, RecommendationTaskState>;
  liveOverdueCount: number | null;
  hasBrief: boolean;
  checkedAt: string;
}): RecommendationLiveStatus {
  // The model's own resolution declaration wins. When it says a finding needs a
  // human to confirm, any task codes it carries are CONTEXT/evidence — never a
  // resolution trigger. Otherwise a coarse periodic task ("client month", a
  // weekly report) rolling over to Done silently closes an unrelated finding
  // (e.g. a still-unpaid debt). We still resolve the task chips for display.
  if (recommendation.resolutionKind === "manual_confirmation") {
    const matchedTasks = extractRecommendationTaskCodes(recommendation)
      .map((code) => tasksByCode.get(code))
      .filter((task): task is RecommendationTaskState => Boolean(task));
    return {
      recommendationIndex,
      state: "needs_confirmation",
      reason: "unverifiable",
      checkedAt,
      openTaskCount: null,
      liveOverdueCount,
      matchedTasks,
    };
  }

  const taskCodes = extractRecommendationTaskCodes(recommendation);
  if (taskCodes.length > 0) {
    const matchedTasks = taskCodes
      .map((code) => tasksByCode.get(code))
      .filter((task): task is RecommendationTaskState => Boolean(task));
    const missingTaskCount = taskCodes.length - matchedTasks.length;
    const openTaskCount = matchedTasks.filter((task) => task.stage !== "done" && !task.archived).length;

    if (openTaskCount > 0) {
      return {
        recommendationIndex,
        state: "open",
        reason: "linked_tasks_open",
        checkedAt,
        openTaskCount,
        liveOverdueCount,
        matchedTasks,
      };
    }
    if (
      missingTaskCount === 0 &&
      matchedTasks.length > 0 &&
      matchedTasks.every((task) => task.stage === "done")
    ) {
      return {
        recommendationIndex,
        state: "resolved",
        reason: "linked_tasks_resolved",
        checkedAt,
        openTaskCount: 0,
        liveOverdueCount,
        matchedTasks,
      };
    }
    return {
      recommendationIndex,
      state: "needs_confirmation",
      reason: "linked_tasks_unverifiable",
      checkedAt,
      openTaskCount: null,
      liveOverdueCount,
      matchedTasks,
    };
  }

  if (isOverdueTaskRecommendation(recommendation)) {
    if (liveOverdueCount === null) {
      return {
        recommendationIndex,
        state: "needs_confirmation",
        reason: "unverifiable",
        checkedAt,
        openTaskCount: null,
        liveOverdueCount,
        matchedTasks: [],
      };
    }
    return {
      recommendationIndex,
      state: liveOverdueCount === 0 ? "resolved" : "open",
      reason: liveOverdueCount === 0 ? "overdue_tasks_resolved" : "overdue_tasks_open",
      checkedAt,
      openTaskCount: liveOverdueCount,
      liveOverdueCount,
      matchedTasks: [],
    };
  }

  if (isMissingBriefRecommendation(recommendation)) {
    return {
      recommendationIndex,
      state: hasBrief ? "resolved" : "open",
      reason: hasBrief ? "brief_attached" : "brief_missing",
      checkedAt,
      openTaskCount: null,
      liveOverdueCount,
      matchedTasks: [],
    };
  }

  return {
    recommendationIndex,
    state: "needs_confirmation",
    reason: "unverifiable",
    checkedAt,
    openTaskCount: null,
    liveOverdueCount,
    matchedTasks: [],
  };
}

// The analysis has two layers that can describe the same operational problem:
// a recommendation and a risk. The workspace also adds a generic overdue-tasks
// fallback. Without a stable comparison, one underlying problem appears two or
// three times with slightly different Arabic wording and every wording gets an
// independent manual-resolution state.
//
// Prefer shared task codes because they are the strongest identity. Historical
// risks often omit codes, so the fallback is deliberately conservative: at
// least three meaningful normalized words must overlap and cover a substantial
// part of the shorter sentence.
const PROBLEM_STOP_WORDS = new Set([
  "اجل",
  "اكثر",
  "التي",
  "الذي",
  "العميل",
  "العميله",
  "المشكله",
  "المشروع",
  "ايام",
  "بشكل",
  "تجنب",
  "حاله",
  "حيث",
  "خلال",
  "ذلك",
  "ضمان",
  "علي",
  "عدم",
  "عن",
  "فتره",
  "في",
  "قد",
  "كان",
  "كما",
  "كل",
  "لدي",
  "مرحله",
  "مما",
  "من",
  "منذ",
  "مهمه",
  "مهام",
  "هذا",
  "هذه",
  "هناك",
  "هو",
  "هي",
  "وجود",
  "يوجد",
]);

function normalizeProblemToken(rawToken: string): string {
  let token = rawToken
    .toLocaleLowerCase("ar")
    .replace(/[\u064b-\u065f\u0670\u0640]/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  // Arabic conjunctions/prepositions are commonly attached to the word. This
  // makes `لبيانات` and `ببيانات` compare as the same meaningful token.
  if (token.length >= 5 && /^[وفبكل]/u.test(token)) token = token.slice(1);
  if (token.length >= 5 && token.startsWith("ال")) token = token.slice(2);
  return token;
}

function problemTokens(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/u)
      .map(normalizeProblemToken)
      .filter(
        (token) =>
          token.length >= 3 &&
          !/^\d+$/u.test(token) &&
          !PROBLEM_STOP_WORDS.has(token) &&
          !/^prj\d/iu.test(token),
      ),
  );
}

export function recommendationsDescribeSameProblem(
  first: SatisfactionRecommendation,
  second: SatisfactionRecommendation,
): boolean {
  const firstCodes = new Set(extractRecommendationTaskCodes(first));
  if (
    extractRecommendationTaskCodes(second).some((code) => firstCodes.has(code))
  ) {
    return true;
  }

  const firstTokens = problemTokens(first.issue);
  const secondTokens = problemTokens(second.issue);
  const shorterSize = Math.min(firstTokens.size, secondTokens.size);
  if (shorterSize < 3) return false;
  let shared = 0;
  for (const token of firstTokens) if (secondTokens.has(token)) shared += 1;
  return shared >= 3 && shared / shorterSize >= 0.34;
}

const RECOMMENDATION_PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Server-side guardrail for new analyses. Gemini is still instructed not to
 * repeat itself, but this makes the stored snapshot deterministic when it does.
 */
export function deduplicateRecommendations(
  recommendations: SatisfactionRecommendation[],
): SatisfactionRecommendation[] {
  const unique: SatisfactionRecommendation[] = [];
  for (const recommendation of recommendations) {
    const duplicateIndex = unique.findIndex((candidate) =>
      recommendationsDescribeSameProblem(candidate, recommendation),
    );
    if (duplicateIndex === -1) {
      unique.push(recommendation);
      continue;
    }

    const current = unique[duplicateIndex];
    const taskCodes = [
      ...new Set([
        ...extractRecommendationTaskCodes(current),
        ...extractRecommendationTaskCodes(recommendation),
      ]),
    ];
    unique[duplicateIndex] = {
      ...current,
      priority:
        RECOMMENDATION_PRIORITY_RANK[recommendation.priority] <
        RECOMMENDATION_PRIORITY_RANK[current.priority]
          ? recommendation.priority
          : current.priority,
      taskCodes,
      // Manual confirmation is the safer close rule if the model disagreed
      // about whether a duplicate can be closed from task state alone.
      resolutionKind:
        current.resolutionKind === "manual_confirmation" ||
        recommendation.resolutionKind === "manual_confirmation"
          ? "manual_confirmation"
          : (current.resolutionKind ?? recommendation.resolutionKind),
    };
  }
  return unique;
}
