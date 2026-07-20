import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DashboardRange } from "@/lib/dashboard-range";
import { previousEquivalent, getExecutiveIndicators } from "@/lib/data/executive-indicators";
import { getExecutiveScores } from "@/lib/data/executive-scores";
import {
  getServiceLineHealth,
  getSupportingDepartmentHealth,
  getTopRevisedTasks,
  getClientHealth,
  getUpcomingDeadlines,
} from "@/lib/data/executive";
import { getStageDwellAverages, getDesignerMonthlyOutput } from "@/lib/data/reports-extras";
import { getTeamPulseOverview } from "@/lib/data/team-pulse";
import { getAccountabilityScorecard } from "@/lib/data/accountability";
import {
  getOrgSatisfactionAggregate,
  getSatisfactionRows,
  isClientAtRisk,
} from "@/lib/data/satisfaction";
import {
  getMonthlyDashboard,
  getAmTargets,
  listDashboardMonths,
} from "@/lib/data/contracts";
import { getRenewalForecast90d } from "@/lib/data/reports";
import { getAiDataQuality } from "@/lib/data/ai-data-quality";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";

// =========================================================================
// Executive Report facts — the deterministic number layer of /reports.
//
// One period-scoped snapshot gathered from the verified loaders the rest of
// the app already trusts (indicators, scores, contracts month block, team
// pulse, accountability scorecard, satisfaction, renewals). The AI narrative
// layer (executive-report-generate.ts) is fed EXACTLY this object and may
// only word it — every number the report shows comes from here, and the
// whole object is frozen into executive_report_runs.facts_json at
// generation time so screen and print always agree.
//
// Every block degrades independently: a failed loader nulls its block
// instead of blanking the report.
// =========================================================================

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface ReportTrend {
  current: number;
  previous: number;
  difference: number;
  direction: "increase" | "decrease" | "no_change";
}

export interface ReportIndicatorFacts {
  projectsAtRisk: { value: number | null; trend: ReportTrend | null };
  highRisk: { value: number | null; threshold: number; trend: ReportTrend | null };
  overdue: { value: number | null; trend: ReportTrend | null };
  onTime: { pct: number | null; completedCount: number; trend: ReportTrend | null };
  clientChanges: { value: number | null; trend: ReportTrend | null };
}

export interface ReportScoresFacts {
  delivery: { score: number; delta: number | null; onTimePct: number | null; overdueCount: number; openCount: number };
  quality: { score: number; delta: number | null; reworkCount: number; satisfactionScore: number | null; briefAdherence: number | null };
  discipline: { score: number; delta: number | null; activeMembers: number | null; totalMembers: number; staleTasks: number };
  productivity: { score: number; delta: number | null; completed30d: number; contributors: number; overloaded: number };
  stability: { score: number; delta: number | null; riskProjects: number; criticalOverdue: number; atRiskClients: number };
}

export interface ReportFinanceFacts {
  month: string;
  expectedIncome: number;
  actualIncome: number;
  achievementPct: number;
  account: { expected: number; actual: number; achievementPct: number };
  sales: { expected: number; actual: number; achievementPct: number };
  installmentsDueAndOverdue: number;
  movement: { newClients: number; renewed: number; lost: number; hold: number };
  roster: { totalClients: number; onTarget: number; overdue: number; hold: number };
  amTargets: Array<{ name: string; expected: number; achieved: number; pct: number }>;
}

export interface ReportServiceRow {
  name: string;
  openCount: number;
  delivered: number;
  overdueCount: number;
  onTimePct: number | null;
  onTimePctPrev: number | null;
  clientChanges: number;
  clientChangesPrev: number;
}

export interface ReportDeliveryFacts {
  services: ReportServiceRow[];
  supportingDepartments: ReportServiceRow[];
  clientEdits: {
    activeNow: number;
    enteredThisPeriod: number;
    existedThisPeriod: number;
    existedLastPeriod: number;
    byService: Array<{ name: string; count: number }>;
  };
  stageDwell: Array<{ stage: TaskStage; stageLabel: string; avgDays: number; segments: number }>;
}

export interface ReportTeamFacts {
  totals: {
    departments: number;
    headcount: number;
    activeCount: number;
    stalledCount: number;
    openWip: number;
    pendingLate: number;
    completedThisWeek: number;
    actionsThisWeek: number;
    overloadedCount: number;
  };
  departments: Array<{
    name: string;
    headName: string | null;
    headcount: number;
    activeCount: number;
    stalledCount: number;
    pendingLate: number;
    completedThisWeek: number;
    status: string;
  }>;
  topPerformers: Array<{ name: string; role: string; score: number; onTimeRate: number | null; sampleSize: number }>;
  lowPerformers: Array<{ name: string; role: string; score: number; onTimeRate: number | null; overdueOwned: number; sampleSize: number }>;
  designerOutput: Array<{ name: string; designs: number; revisions: number; tasks: number }>;
}

export interface ReportClientsFacts {
  satisfaction: {
    avgSatisfaction: number | null;
    avgBriefAdherence: number | null;
    analyzedClients: number;
    atRiskClients: number;
  };
  atRiskList: Array<{ name: string; satisfactionScore: number | null; sentiment: string | null }>;
  worstClients: Array<{ name: string; onTimePct: number | null; overdue: number; open: number; delivered: number }>;
  bestClients: Array<{ name: string; onTimePct: number | null; overdue: number; open: number; delivered: number }>;
}

export interface ReportRenewalsFacts {
  next90Count: number;
  next90: Array<{ project: string; client: string; date: string; daysUntil: number }>;
  deadlinesNext7Total: number;
  deadlinesNext7: Array<{ date: string; count: number }>;
}

export interface ExecutiveReportFacts {
  orgName: string;
  period: { from: string; to: string; days: number; preset: string };
  previousPeriod: { from: string; to: string };
  generatedAt: string;
  indicators: ReportIndicatorFacts | null;
  scores: ReportScoresFacts | null;
  finance: ReportFinanceFacts | null;
  delivery: ReportDeliveryFacts | null;
  team: ReportTeamFacts | null;
  clients: ReportClientsFacts | null;
  renewals: ReportRenewalsFacts | null;
  dataQualityCaveats: string[];
}

// A loader failure must cost its own block only, never the report.
async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`[executive-report] ${label} failed:`, err);
    return null;
  }
}

function pickTrend(t: {
  current: number;
  previous: number;
  difference: number;
  direction: "increase" | "decrease" | "no_change";
  available: boolean;
}): ReportTrend | null {
  if (!t.available) return null;
  return {
    current: t.current,
    previous: t.previous,
    difference: t.difference,
    direction: t.direction,
  };
}

async function loadFinance(orgId: string, range: DashboardRange): Promise<ReportFinanceFacts | null> {
  // Contracts data is month-keyed (the sheet). Use the month containing the
  // period end; fall back to the latest month at or before it.
  const months = await listDashboardMonths(orgId);
  if (!months.length) return null;
  const wanted = range.to.slice(0, 7);
  const month =
    months.find((m) => m.month.slice(0, 7) === wanted)?.month ??
    months.find((m) => m.month.slice(0, 7) <= wanted)?.month ??
    months[0].month;

  const [dashboard, amTargets] = await Promise.all([
    getMonthlyDashboard(orgId, month),
    getAmTargets(orgId, month),
  ]);
  if (!dashboard) return null;
  const d = dashboard;

  // Mirrors the dashboard's ContractsAnalysisCard math (sheet cells):
  // expected = Account I27 + Sales G36, actual = Account I30 + Sales I38.
  const expectedIncome = d.acc_expected + d.sales_expected;
  const actualIncome = d.acc_actual + d.sales_total_income;
  const installmentsDueAndOverdue =
    d.acc_exp_inst + d.acc_exp_overdue_inst + d.sales_exp_inst + d.sales_exp_overdue_inst;

  return {
    month,
    expectedIncome: Math.round(expectedIncome),
    actualIncome: Math.round(actualIncome),
    achievementPct: expectedIncome > 0 ? r1((actualIncome / expectedIncome) * 100) : 0,
    account: {
      expected: Math.round(d.acc_expected),
      actual: Math.round(d.acc_actual),
      achievementPct: r1(d.acc_achievement_pct),
    },
    sales: {
      expected: Math.round(d.sales_expected),
      actual: Math.round(d.sales_total_income),
      achievementPct: r1(d.sales_achievement_pct),
    },
    installmentsDueAndOverdue: Math.round(installmentsDueAndOverdue),
    movement: {
      newClients: d.mov_new,
      renewed: d.mov_renewed,
      lost: d.mov_lost,
      hold: d.mov_hold,
    },
    roster: {
      totalClients: d.cnt_total_clients,
      onTarget: d.cnt_on_target,
      overdue: d.cnt_overdue,
      hold: d.cnt_roster_hold,
    },
    amTargets: amTargets
      .map((am) => ({
        name: am.account_manager_name ?? "—",
        expected: Math.round(am.expected_total),
        achieved: Math.round(am.achieved_total),
        pct: r1(am.achievement_pct),
      }))
      .sort((a, b) => b.pct - a.pct),
  };
}

export async function buildExecutiveReportFacts(
  orgId: string,
  range: DashboardRange,
): Promise<ExecutiveReportFacts> {
  const prev = previousEquivalent(range);

  const [
    org,
    indicators,
    scores,
    finance,
    services,
    supporting,
    clientEdits,
    stageDwell,
    pulse,
    scorecard,
    designerOutput,
    satisfactionAgg,
    satisfactionRows,
    clientHealth,
    renewals,
    deadlines,
    dataQuality,
  ] = await Promise.all([
    safe(
      "org",
      Promise.resolve(
        supabaseAdmin.from("organizations").select("name").eq("id", orgId).single(),
      ).then((r) => r.data),
    ),
    safe("indicators", getExecutiveIndicators(orgId, range)),
    safe("scores", getExecutiveScores(orgId, range)),
    safe("finance", loadFinance(orgId, range)),
    safe("services", getServiceLineHealth(orgId, range)),
    safe("supportingDepts", getSupportingDepartmentHealth(orgId, range)),
    safe("clientEdits", getTopRevisedTasks(orgId, range)),
    safe("stageDwell", getStageDwellAverages(orgId)),
    safe("teamPulse", getTeamPulseOverview(orgId)),
    safe("scorecard", getAccountabilityScorecard(orgId)),
    safe(
      "designerOutput",
      getDesignerMonthlyOutput(
        orgId,
        parseInt(range.to.slice(0, 4), 10),
        parseInt(range.to.slice(5, 7), 10),
      ),
    ),
    safe("satisfactionAgg", getOrgSatisfactionAggregate(orgId)),
    safe("satisfactionRows", getSatisfactionRows(orgId)),
    safe("clientHealth", getClientHealth(orgId, range)),
    safe("renewals", getRenewalForecast90d(orgId)),
    safe("deadlines", getUpcomingDeadlines(orgId)),
    safe("dataQuality", getAiDataQuality(orgId)),
  ]);

  const toServiceRow = (s: {
    name: string;
    openCount: number;
    delivered30d: number;
    overdueCount: number;
    onTimePct30d: number | null;
    onTimePctPrev: number | null;
    clientChanges: number;
    clientChangesPrev: number;
  }): ReportServiceRow => ({
    name: s.name,
    openCount: s.openCount,
    delivered: s.delivered30d,
    overdueCount: s.overdueCount,
    onTimePct: s.onTimePct30d,
    onTimePctPrev: s.onTimePctPrev,
    clientChanges: s.clientChanges,
    clientChangesPrev: s.clientChangesPrev,
  });

  // Accountability: rank only trustworthy rows (high confidence, scored).
  const reliableRows = (scorecard ?? []).filter(
    (row) => row.score !== null && row.confidence === "high",
  );
  const rankedRows = [...reliableRows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const liveAtRisk = (satisfactionRows ?? [])
    .filter(
      (row) =>
        row.hasActiveProject &&
        !row.manuallyArchived &&
        isClientAtRisk(row.satisfactionScore, row.sentiment),
    )
    .sort((a, b) => (a.satisfactionScore ?? 0) - (b.satisfactionScore ?? 0));

  const toClientRow = (c: {
    clientName: string;
    onTimePct30d: number | null;
    overdueTaskCount: number;
    openTaskCount: number;
    deliveredCount30d: number;
  }) => ({
    name: c.clientName,
    onTimePct: c.onTimePct30d,
    overdue: c.overdueTaskCount,
    open: c.openTaskCount,
    delivered: c.deliveredCount30d,
  });

  return {
    orgName: (org as { name: string } | null)?.name ?? "Sky Light",
    period: { from: range.from, to: range.to, days: range.days, preset: range.preset },
    previousPeriod: prev,
    generatedAt: new Date().toISOString(),

    indicators: indicators
      ? {
          projectsAtRisk: {
            value: indicators.projectsAtRisk.mainValue,
            trend: pickTrend(indicators.projectsAtRisk.trend),
          },
          highRisk: {
            value: indicators.highRisk.mainValue,
            threshold: indicators.highRisk.threshold,
            trend: pickTrend(indicators.highRisk.trend),
          },
          overdue: {
            value: indicators.overdue.mainValue,
            trend: pickTrend(indicators.overdue.trend),
          },
          onTime: {
            pct: indicators.onTime.onTimePct,
            completedCount: indicators.onTime.completedCount,
            trend: pickTrend(indicators.onTime.trend),
          },
          clientChanges: {
            value: indicators.clientChanges.mainValue,
            trend: pickTrend(indicators.clientChanges.trend),
          },
        }
      : null,

    scores: scores
      ? {
          delivery: {
            score: scores.delivery.score,
            delta: scores.delivery.delta,
            onTimePct: scores.delivery.onTimePct,
            overdueCount: scores.delivery.overdueCount,
            openCount: scores.delivery.openCount,
          },
          quality: {
            score: scores.quality.score,
            delta: scores.quality.delta,
            reworkCount: scores.quality.reworkCount,
            satisfactionScore: scores.quality.satisfactionScore,
            briefAdherence: scores.quality.briefAdherence,
          },
          discipline: {
            score: scores.discipline.score,
            delta: scores.discipline.delta,
            activeMembers: scores.discipline.activeMembers,
            totalMembers: scores.discipline.totalMembers,
            staleTasks: scores.discipline.staleTasks,
          },
          productivity: {
            score: scores.productivity.score,
            delta: scores.productivity.delta,
            completed30d: scores.productivity.completed30d,
            contributors: scores.productivity.contributors,
            overloaded: scores.productivity.overloaded,
          },
          stability: {
            score: scores.stability.score,
            delta: scores.stability.delta,
            riskProjects: scores.stability.riskProjects,
            criticalOverdue: scores.stability.criticalOverdue,
            atRiskClients: scores.stability.atRiskClients,
          },
        }
      : null,

    finance,

    delivery:
      services || clientEdits
        ? {
            services: (services ?? []).map(toServiceRow),
            supportingDepartments: (supporting ?? []).map(toServiceRow),
            clientEdits: clientEdits
              ? {
                  activeNow: clientEdits.activeNow,
                  enteredThisPeriod: clientEdits.enteredThisPeriod,
                  existedThisPeriod: clientEdits.existedThisPeriod,
                  existedLastPeriod: clientEdits.existedLastPeriod,
                  byService: clientEdits.byService
                    .slice(0, 6)
                    .map((s) => ({ name: s.name, count: s.count })),
                }
              : { activeNow: 0, enteredThisPeriod: 0, existedThisPeriod: 0, existedLastPeriod: 0, byService: [] },
            stageDwell: (stageDwell ?? [])
              .filter((s) => s.stage !== "done" && s.stage !== "new")
              .map((s) => ({
                stage: s.stage,
                stageLabel: TASK_STAGE_LABELS[s.stage] ?? s.stage,
                avgDays: r1(s.avg_hours / 24),
                segments: s.segments,
              })),
          }
        : null,

    team: pulse
      ? {
          totals: {
            departments: pulse.totals.departments,
            headcount: pulse.totals.headcount,
            activeCount: pulse.totals.activeCount,
            stalledCount: pulse.totals.stalledCount,
            openWip: pulse.totals.openWip,
            pendingLate: pulse.totals.pendingLate,
            completedThisWeek: pulse.totals.completedThisWeek,
            actionsThisWeek: pulse.totals.actionsThisWeek,
            overloadedCount: pulse.totals.overloadedCount,
          },
          departments: pulse.rows.map((row) => ({
            name: row.departmentName,
            headName: row.headName,
            headcount: row.headcount,
            activeCount: row.activeCount,
            stalledCount: row.stalledCount,
            pendingLate: row.pendingLate,
            completedThisWeek: row.completedThisWeek,
            status: row.status,
          })),
          topPerformers: rankedRows.slice(0, 5).map((row) => ({
            name: row.fullName,
            role: row.positionLabel ?? row.role,
            score: row.score as number,
            onTimeRate: row.onTimeRate,
            sampleSize: row.sampleSize,
          })),
          lowPerformers: rankedRows
            .slice(-5)
            .reverse()
            .filter((row) => (row.score as number) < 70)
            .map((row) => ({
              name: row.fullName,
              role: row.positionLabel ?? row.role,
              score: row.score as number,
              onTimeRate: row.onTimeRate,
              overdueOwned: row.overdueOwned,
              sampleSize: row.sampleSize,
            })),
          designerOutput: (designerOutput ?? []).slice(0, 8).map((row) => ({
            name: row.full_name,
            designs: row.design_total,
            revisions: row.revision_total,
            tasks: row.task_count,
          })),
        }
      : null,

    clients:
      satisfactionAgg || clientHealth
        ? {
            satisfaction: satisfactionAgg ?? {
              avgSatisfaction: null,
              avgBriefAdherence: null,
              analyzedClients: 0,
              atRiskClients: 0,
            },
            atRiskList: liveAtRisk.slice(0, 8).map((row) => ({
              name: row.clientName,
              satisfactionScore: row.satisfactionScore,
              sentiment: row.sentiment,
            })),
            worstClients: (clientHealth?.worst ?? []).slice(0, 5).map(toClientRow),
            bestClients: (clientHealth?.best ?? []).slice(0, 5).map(toClientRow),
          }
        : null,

    renewals:
      renewals || deadlines
        ? {
            next90Count: renewals?.length ?? 0,
            next90: (renewals ?? []).slice(0, 12).map((row) => ({
              project: row.project_name,
              client: row.client_name,
              date: row.next_renewal_date,
              daysUntil: row.days_until,
            })),
            deadlinesNext7Total: (deadlines ?? []).reduce((s, d) => s + d.count, 0),
            deadlinesNext7: (deadlines ?? []).map((d) => ({ date: d.date, count: d.count })),
          }
        : null,

    dataQualityCaveats: dataQuality?.caveats ?? [],
  };
}
