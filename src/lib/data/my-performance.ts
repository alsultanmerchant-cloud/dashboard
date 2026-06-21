import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getEmployeeAccountabilityEvidence } from "@/lib/data/accountability";

// =========================================================================
// "My Performance" page data — the additive, calendar-month + failure-list
// layer that complements the agent self-trend scorecard (agent-growth.ts).
//
// The verified self-trend metrics (on-time/turnaround/rework, score, AI coach)
// live in agent-growth.ts + the GrowthSection component and are REUSED on the
// page as-is. This file provides only what that layer lacks:
//   1. monthly closing  — frozen per-calendar-month rows (employee_monthly_closing)
//   2. failure evidence — recent overdue / rework / slow tasks to learn from,
//                         distilled from the accountability engine.
// =========================================================================

// ---- 1. Monthly closing (frozen per-month) --------------------------------

export interface MyMonthlyRow {
  month: string; // YYYY-MM-01
  completedTasks: number;
  designsCount: number;
  completedProjects: number;
  overdueTasks: number;
  revisionCount: number;
  avgCompletionHours: number | null;
  onTimePct: number | null;
  targetCompletedTasks: number | null;
  achievementPct: number | null;
}

async function _getMyMonthlyClosing(
  orgId: string,
  employeeId: string,
): Promise<MyMonthlyRow[]> {
  if (!employeeId) return [];
  const { data, error } = await supabaseAdmin
    .from("employee_monthly_closing")
    .select(
      "month, completed_tasks, designs_count, completed_projects, overdue_tasks, revision_count, avg_completion_hours, on_time_pct, target_completed_tasks, achievement_pct",
    )
    .eq("organization_id", orgId)
    .eq("employee_profile_id", employeeId)
    .order("month", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    month: r.month as string,
    completedTasks: r.completed_tasks ?? 0,
    designsCount: r.designs_count ?? 0,
    completedProjects: r.completed_projects ?? 0,
    overdueTasks: r.overdue_tasks ?? 0,
    revisionCount: r.revision_count ?? 0,
    avgCompletionHours: r.avg_completion_hours,
    onTimePct: r.on_time_pct,
    targetCompletedTasks: r.target_completed_tasks,
    achievementPct: r.achievement_pct,
  }));
}

export const getMyMonthlyClosing = cache(_getMyMonthlyClosing);

// ---- 2. Failure evidence (learn from past failures) -----------------------

export type FailureKind = "overdue" | "rework" | "slow";

// One stage the task sat in, with total business-time spent there. Powers the
// "where the time went" breakdown in the lesson modal.
export interface FailureStage {
  stage: string; // task_stage value — labeled via TasksBoard.stages in the UI
  dwellMinutes: number;
  count: number; // number of separate visits to this stage
}

export interface MyFailureItem {
  taskId: string;
  taskCode: string | null;
  title: string;
  clientName: string | null;
  projectName: string | null;
  kind: FailureKind;
  delayDays: number | null;
  reworkCount: number; // times the task bounced back to client_changes
  maxDwellMinutes: number | null;
  // Per-stage time breakdown over the measured window (worst dwell first).
  stages: FailureStage[];
}

// A stage interval is "slow" past this many BUSINESS minutes (~3 working days).
const SLOW_DWELL_MINUTES = 3 * 8 * 60;

// Collapse the per-stage-interval evidence into one failure row per task,
// keeping the worst signal: overdue/delay, rework re-entries, longest dwell,
// plus a per-stage time breakdown. Shared by the list + the per-task detail.
function buildFailureMap(
  evidence: NonNullable<Awaited<ReturnType<typeof getEmployeeAccountabilityEvidence>>>,
): Map<string, MyFailureItem> {
  type Agg = {
    base: Omit<MyFailureItem, "kind" | "stages">;
    isOverdue: boolean;
    stages: Map<string, { dwell: number; count: number }>;
  };
  const acc = new Map<string, Agg>();

  for (const it of evidence.items) {
    let a = acc.get(it.taskId);
    if (!a) {
      a = {
        base: {
          taskId: it.taskId,
          taskCode: it.taskCode,
          title: it.title,
          clientName: it.clientName,
          projectName: it.projectName,
          delayDays: null,
          reworkCount: 0,
          maxDwellMinutes: null,
        },
        isOverdue: false,
        stages: new Map(),
      };
      acc.set(it.taskId, a);
    }
    if (it.isOverdue) a.isOverdue = true;
    if (it.delayDays != null) a.base.delayDays = Math.max(a.base.delayDays ?? 0, it.delayDays);
    if (it.stage === "client_changes") a.base.reworkCount += 1;
    if (it.dwellBusinessMinutes != null) {
      a.base.maxDwellMinutes = Math.max(a.base.maxDwellMinutes ?? 0, it.dwellBusinessMinutes);
      const s = a.stages.get(it.stage) ?? { dwell: 0, count: 0 };
      s.dwell += it.dwellBusinessMinutes;
      s.count += 1;
      a.stages.set(it.stage, s);
    } else {
      const s = a.stages.get(it.stage) ?? { dwell: 0, count: 0 };
      s.count += 1;
      a.stages.set(it.stage, s);
    }
  }

  const out = new Map<string, MyFailureItem>();
  for (const a of acc.values()) {
    const isLate = a.isOverdue || (a.base.delayDays ?? 0) > 0;
    const isSlow = (a.base.maxDwellMinutes ?? 0) >= SLOW_DWELL_MINUTES;
    if (!isLate && a.base.reworkCount === 0 && !isSlow) continue; // not a failure
    const kind: FailureKind = isLate ? "overdue" : a.base.reworkCount > 0 ? "rework" : "slow";
    const stages: FailureStage[] = Array.from(a.stages.entries())
      .map(([stage, v]) => ({ stage, dwellMinutes: Math.round(v.dwell), count: v.count }))
      .sort((x, y) => y.dwellMinutes - x.dwellMinutes);
    out.set(a.base.taskId, { ...a.base, kind, stages });
  }
  return out;
}

// Worst first: overdue (by delay) → rework (by count) → slow (by dwell).
function rankFailures(items: MyFailureItem[]): MyFailureItem[] {
  const rank: Record<FailureKind, number> = { overdue: 0, rework: 1, slow: 2 };
  return [...items].sort((x, y) => {
    if (rank[x.kind] !== rank[y.kind]) return rank[x.kind] - rank[y.kind];
    if (x.kind === "overdue") return (y.delayDays ?? 0) - (x.delayDays ?? 0);
    if (x.kind === "rework") return y.reworkCount - x.reworkCount;
    return (y.maxDwellMinutes ?? 0) - (x.maxDwellMinutes ?? 0);
  });
}

async function _getMyFailures(
  orgId: string,
  employeeId: string,
): Promise<MyFailureItem[]> {
  // Reuse the verified accountability evidence (per-stage intervals over the
  // last 30 days) rather than re-querying — same dwell/overdue/delay source.
  const evidence = await getEmployeeAccountabilityEvidence(orgId, employeeId);
  if (!evidence) return [];
  return rankFailures(Array.from(buildFailureMap(evidence).values())).slice(0, 12);
}

export const getMyFailures = cache(_getMyFailures);

// Single failure detail for the lesson modal / AI route. Scoped to the
// employee's own evidence, so it doubles as the authorization check: a task
// that isn't one of THEIR measured failures returns null.
async function _getMyFailureDetail(
  orgId: string,
  employeeId: string,
  taskId: string,
): Promise<MyFailureItem | null> {
  const evidence = await getEmployeeAccountabilityEvidence(orgId, employeeId);
  if (!evidence) return null;
  return buildFailureMap(evidence).get(taskId) ?? null;
}

export const getMyFailureDetail = cache(_getMyFailureDetail);
