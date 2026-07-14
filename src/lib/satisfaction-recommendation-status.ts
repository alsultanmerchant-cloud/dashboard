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

type Recommendation = SatisfactionResult["recommendations"][number];

// Human-readable task codes are intentionally the bridge for legacy AI output:
// old recommendations predate structured entity references, but already mention
// codes such as PRJ-01826-022 in their issue/action text.
const TASK_CODE_RE = /\bPRJ-\d+(?:-\d+)+\b/giu;
const TASK_WORD_RE = /(?:مهمة|مهام|مهمتين|task(?:s)?)/iu;
const DELAY_WORD_RE = /(?:متأخر|متأخرة|متأخرات|تأخر|تأخير|متعثر|متعطّل|عالق|overdue|delay(?:ed)?|stuck)/iu;
const BRIEF_WORD_RE = /(?:بريف|brief)/iu;
const MISSING_WORD_RE = /(?:ناقص|ناقصة|مفقود|غير\s+(?:متاح|متوفر|موجود)|missing|absent|unavailable)/iu;

export function extractRecommendationTaskCodes(recommendation: Recommendation): string[] {
  const matches = `${recommendation.issue}\n${recommendation.action}`.match(TASK_CODE_RE) ?? [];
  return [
    ...new Set(
      [...(recommendation.taskCodes ?? []), ...matches]
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function isOverdueTaskRecommendation(recommendation: Recommendation): boolean {
  if (recommendation.resolutionKind === "no_overdue_tasks") return true;
  const text = `${recommendation.issue}\n${recommendation.action}`;
  return TASK_WORD_RE.test(text) && DELAY_WORD_RE.test(text);
}

export function isMissingBriefRecommendation(recommendation: Recommendation): boolean {
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
  recommendation: Recommendation;
  recommendationIndex: number;
  tasksByCode: ReadonlyMap<string, RecommendationTaskState>;
  liveOverdueCount: number | null;
  hasBrief: boolean;
  checkedAt: string;
}): RecommendationLiveStatus {
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
