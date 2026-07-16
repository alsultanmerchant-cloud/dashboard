import { describe, expect, test } from "bun:test";
import {
  classifyRecommendationLiveStatus,
  extractRecommendationTaskCodes,
  type RecommendationTaskState,
} from "./satisfaction-recommendation-status";

const checkedAt = "2026-07-14T10:00:00.000Z";
const recommendation = (issue: string, action = "متابعة الإجراء") => ({
  priority: "high" as const,
  issue,
  action,
});

function classify(
  issue: string,
  options: {
    action?: string;
    tasks?: RecommendationTaskState[];
    liveOverdueCount?: number | null;
    hasBrief?: boolean;
  } = {},
) {
  return classifyRecommendationLiveStatus({
    recommendation: recommendation(issue, options.action),
    recommendationIndex: 0,
    tasksByCode: new Map((options.tasks ?? []).map((task) => [task.taskCode, task])),
    liveOverdueCount: options.liveOverdueCount ?? 0,
    hasBrief: options.hasBrief ?? false,
    checkedAt,
  });
}

describe("recommendation live reconciliation", () => {
  test("extracts legacy task codes from issue and action", () => {
    expect(
      extractRecommendationTaskCodes(
        recommendation("تأخرت PRJ-01547-255", "راجع PRJ-01547-255 و PRJ-01547-231"),
      ),
    ).toEqual(["PRJ-01547-255", "PRJ-01547-231"]);
  });

  test("uses structured task codes emitted by new analyses even when prose omits them", () => {
    expect(
      extractRecommendationTaskCodes({
        ...recommendation("تأخر التصميم"),
        taskCodes: ["prj-01547-255"],
        resolutionKind: "task_completion",
      }),
    ).toEqual(["PRJ-01547-255"]);
  });

  test("marks a linked recommendation resolved only when every task is done", () => {
    const result = classify("تأخرت المهمة PRJ-01547-255", {
      tasks: [
        {
          id: "task-1",
          taskCode: "PRJ-01547-255",
          stage: "done",
          archived: false,
        },
      ],
    });
    expect(result.state).toBe("resolved");
    expect(result.reason).toBe("linked_tasks_resolved");
  });

  test("keeps a recommendation open while a linked task remains active", () => {
    const result = classify("تأخرت المهمة PRJ-01547-255", {
      tasks: [
        {
          id: "task-1",
          taskCode: "PRJ-01547-255",
          stage: "in_progress",
          archived: false,
        },
      ],
    });
    expect(result.state).toBe("open");
    expect(result.openTaskCount).toBe(1);
  });

  test("resolves a generic overdue-task finding when live overdue count reaches zero", () => {
    expect(classify("يوجد 5 مهام متأخرة", { liveOverdueCount: 0 }).state).toBe("resolved");
    expect(classify("يوجد 5 مهام متأخرة", { liveOverdueCount: 2 }).state).toBe("open");
  });

  test("resolves a missing-brief finding after a brief is attached", () => {
    expect(classify("البريف غير متوفر", { hasBrief: true }).state).toBe("resolved");
    expect(classify("البريف غير متوفر", { hasBrief: false }).state).toBe("open");
  });

  test("does not guess when a text-only relationship issue has no live proof", () => {
    expect(classify("العميل غير راضٍ عن جودة المحتوى").state).toBe("needs_confirmation");
  });

  test("respects resolutionKind=manual_confirmation over incidental linked-task completion", () => {
    // A debt finding the model flagged as manual_confirmation, with a DONE weekly-
    // report task attached as context — must NOT auto-resolve on that task.
    const result = classifyRecommendationLiveStatus({
      recommendation: {
        priority: "high" as const,
        issue: "توقف حملات سناب شات بسبب المديونية",
        action: "متابعة العميل لسداد المديونية",
        taskCodes: ["PRJ-01794-321"],
        resolutionKind: "manual_confirmation" as const,
      },
      recommendationIndex: 0,
      tasksByCode: new Map([
        ["PRJ-01794-321", { id: "t1", taskCode: "PRJ-01794-321", stage: "done", archived: false }],
      ]),
      liveOverdueCount: 0,
      hasBrief: false,
      checkedAt,
    });
    expect(result.state).toBe("needs_confirmation");
    expect(result.reason).toBe("unverifiable");
    // task chip still surfaced for context
    expect(result.matchedTasks.map((t) => t.taskCode)).toEqual(["PRJ-01794-321"]);
  });
});
