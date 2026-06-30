import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeDollarSign,
  Scale,
} from "lucide-react";
import { requireSession, getDashboardScope, hasPermission, type ServerSession } from "@/lib/auth-server";
import { DepartmentDashboard } from "@/components/department/department-dashboard";
import { AgentCockpit } from "@/components/cockpit/agent-cockpit";
import { getTeamPulseOverview } from "@/lib/data/team-pulse";
import { TeamPulseBand } from "@/components/executive/team-pulse-band";
import { getExecutiveScores } from "@/lib/data/executive-scores";
import { getAccountabilityOverview } from "@/lib/data/accountability";
import {
  getAmTargets,
  getMonthTargetBuckets,
  getMonthlyDashboard,
  listDashboardMonths,
  type AmTargetRow,
  type MonthBuckets,
  type MonthlyDashboard,
} from "@/lib/data/contracts";
import {
  getHeroKpis,
  getOnTimeSeries,
  getClientHealth,
  getStageFunnel,
  getApprovalBottlenecks,
  getSpecialistLoadTop,
  getPerformerLeaderboard,
  getServiceLineHealth,
  getTopStuckProjects,
  getUpcomingDeadlines,
  getStageFlowMatrix,
  getTopRevisedTasks,
  getWorkflowIndicators,
} from "@/lib/data/executive";
import { PageHeader } from "@/components/page-header";
import { DateRangePicker } from "@/components/executive/date-range-picker";
import { resolveRange, rangeLabel, asOfLabel, type DashboardRange } from "@/lib/dashboard-range";
import { riyadhTodayIso } from "@/lib/tz";
import { MetricInfo, Explained } from "@/components/metric-info";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecutiveScoresBand } from "@/components/executive/scores-band";
import { CeoBriefCard } from "@/components/executive/ceo-brief-card";
import { getCurrentCeoBrief } from "@/lib/ceo-brief-generate";
import { ClientHealthSection } from "@/components/executive/client-health";
import { DeliveryFlowSection } from "@/components/executive/delivery-flow";
import { TeamCapacitySection } from "@/components/executive/team-capacity";
import { ServiceHealthSection } from "@/components/executive/service-health";
import { StuckProjectsSection } from "@/components/executive/stuck-projects";
import { UpcomingDeadlinesSection } from "@/components/executive/upcoming-deadlines";
import { StageFlowMatrixSection } from "@/components/executive/stage-flow-matrix";
import { TopRevisedTasksSection } from "@/components/executive/top-revised";
import { DashSection } from "@/components/executive/section-boundary";
import { cn } from "@/lib/utils";

// ---- Sections (each streams behind its own Suspense) ---------------------

async function BriefSection({ orgId }: { orgId: string }) {
  // Read the cached brief (daily cron + on-demand refresh keep it fresh). The
  // card is interactive client-side; we only seed it with the current run.
  const current = await getCurrentCeoBrief(orgId);
  return <CeoBriefCard initialBrief={current} />;
}

async function ScoresBand({ orgId, range }: { orgId: string; range: DashboardRange }) {
  // The four operational KPI cards (on-time, overdue, review backlog, client
  // changes) are folded INTO this indicators band as a compact row, instead of
  // sitting in their own headline sections above (team feedback 2026-06-30).
  const [data, series, hero, workflow] = await Promise.all([
    getExecutiveScores(orgId, range),
    getOnTimeSeries(orgId, range),
    getHeroKpis(orgId),
    getWorkflowIndicators(orgId),
  ]);
  const operational = {
    onTimePct: series.pct,
    delivered: series.delivered,
    windowLabel: rangeLabel(range),
    overdue: hero.overdue.current,
    overdueDelta: hero.overdue.current - hero.overdue.weekAgo,
    asOf: asOfLabel({ ...range, to: riyadhTodayIso() }),
    reviewCount: workflow.review.count,
    reviewOldest: workflow.review.oldestDays,
    reviewAvg: workflow.review.avgDwellDays,
    changesCount: workflow.clientChanges.count,
    changesOldest: workflow.clientChanges.oldestDays,
    changesAvg: workflow.clientChanges.avgDwellDays,
  };
  return <ExecutiveScoresBand data={data} windowLabel={rangeLabel(range)} operational={operational} />;
}

async function PulseBand({ orgId }: { orgId: string }) {
  const data = await getTeamPulseOverview(orgId);
  return <TeamPulseBand data={data} />;
}

async function ClientHealth({ orgId, range }: { orgId: string; range: DashboardRange }) {
  const { worst, best } = await getClientHealth(orgId, range);
  // on-time % + delivered are windowed to the picker; the open/overdue columns
  // remain point-in-time (from the delivery-health view).
  return <ClientHealthSection worst={worst} best={best} windowLabel={rangeLabel(range)} />;
}

async function ServiceHealth({ orgId, range }: { orgId: string; range: DashboardRange }) {
  const rows = await getServiceLineHealth(orgId, range);
  return <ServiceHealthSection rows={rows} windowLabel={rangeLabel(range)} />;
}

async function StageFlow({ orgId, range }: { orgId: string; range: DashboardRange }) {
  const data = await getStageFlowMatrix(orgId, range);
  return <StageFlowMatrixSection {...data} windowLabel={rangeLabel(range)} />;
}

async function TopRevised({ orgId, range }: { orgId: string; range: DashboardRange }) {
  const rows = await getTopRevisedTasks(orgId, range);
  // "Entered client_changes" follows the window; active-now is point-in-time.
  return <TopRevisedTasksSection rows={rows} windowLabel={rangeLabel(range)} />;
}

async function DeliveryFlow({ orgId }: { orgId: string }) {
  const [funnel, bottlenecks] = await Promise.all([
    getStageFunnel(orgId),
    getApprovalBottlenecks(orgId),
  ]);
  return <DeliveryFlowSection funnel={funnel} bottlenecks={bottlenecks} windowLabel="Current" />;
}

async function StuckProjects({ orgId, range }: { orgId: string; range: DashboardRange }) {
  const rows = await getTopStuckProjects(orgId);
  return <StuckProjectsSection rows={rows} windowLabel={asOfLabel({ ...range, to: new Date().toISOString().slice(0, 10) })} />;
}

async function UpcomingDeadlines({ orgId }: { orgId: string }) {
  const days = await getUpcomingDeadlines(orgId);
  return <UpcomingDeadlinesSection days={days} windowLabel="Next 7 days" />;
}

async function TeamCapacity({ orgId, range }: { orgId: string; range: DashboardRange }) {
  const [specialists, performers] = await Promise.all([
    getSpecialistLoadTop(orgId),
    getPerformerLeaderboard(orgId, range),
  ]);
  // Specialist load is current; the performer leaderboard is windowed.
  return <TeamCapacitySection specialists={specialists} performers={performers} windowLabel={rangeLabel(range)} />;
}

// ---- Skeletons -----------------------------------------------------------

function ScoresSkeleton() {
  return (
    <div className="mb-8 space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1.15fr_2fr]">
        <Skeleton className="h-[220px] rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[220px] rounded-2xl" />
          <Skeleton className="h-[220px] rounded-2xl" />
          <Skeleton className="h-[220px] rounded-2xl" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-[120px] rounded-2xl" />
        <Skeleton className="h-[120px] rounded-2xl" />
        <Skeleton className="h-[120px] rounded-2xl" />
        <Skeleton className="h-[120px] rounded-2xl" />
      </div>
    </div>
  );
}

function StripSkeleton() {
  return <Skeleton className="mb-8 h-[88px] rounded-2xl" />;
}

function SectionSkeleton({ h = 220 }: { h?: number }) {
  return (
    <div className="mb-10 space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton style={{ height: h }} className="rounded-2xl" />
    </div>
  );
}

function AgentCockpitSkeleton() {
  return (
    <div>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[128px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mb-8 h-[340px] rounded-2xl" />
      <Skeleton className="mb-8 h-[160px] rounded-2xl" />
    </div>
  );
}

// ---- Page ----------------------------------------------------------------

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; preset?: string; from?: string; to?: string }>;
}) {
  const session = await requireSession();
  const scope = await getDashboardScope(session);
  const sp = await searchParams;

  if (scope.kind === "ceo") {
    return <ExecutiveDashboard session={session} range={resolveRange(sp)} />;
  }

  if (scope.kind === "agent") {
    return (
      <Suspense fallback={<AgentCockpitSkeleton />}>
        <AgentCockpit session={session} employeeId={scope.employeeId} />
      </Suspense>
    );
  }

  const { month } = sp;

  return (
    <DepartmentDashboard
      session={session}
      scope={scope}
      canMonthlyClosing={scope.kind === "head"}
      month={month}
    />
  );
}

async function ExecutiveDashboard({ session, range }: { session: ServerSession; range: DashboardRange }) {
  const orgId = session.orgId;
  const t = await getTranslations("Dashboard");
  // Financial / CEO-only blocks (the brief, P&L summary, and contract revenue
  // analysis) are gated on finance.view. Roles like dept_lead get the org-wide
  // executive view for performance, but not these money sections.
  const canFinance = hasPermission(session, "finance.view");

  return (
    <div>
      <PageHeader
        title={t("welcome", { name: session.fullName })}
        description={t("welcomeDescription")}
      />

      {/* CEO brief — narrative summary, pinned to the TOP of the dashboard so
          it's the first thing the CEO reads. Range-independent (current state),
          so it sits above the date-range picker. */}
      {canFinance && (
        <DashSection fallback={<Skeleton className="mb-8 h-[360px] rounded-2xl" />}>
          <BriefSection orgId={orgId} />
        </DashSection>
      )}

      <DateRangePicker range={range} />

      {/* ── INDICATORS (top): the fast, at-a-glance KPI cards, grouped so they
          render first and stay reliable even if a heavier detail section below
          is slow or errors (each is its own DashSection boundary). ───────── */}
      <DashSection fallback={<ScoresSkeleton />}>
        <ScoresBand orgId={orgId} range={range} />
      </DashSection>

      <DashSection fallback={<StripSkeleton />}>
        <PulseBand orgId={orgId} />
      </DashSection>

      {/* ── DETAILS (below): heavier tables / flows / lists. ─────────────── */}
      <DashSection fallback={<SectionSkeleton h={300} />}>
        <CeoAnalysisSection orgId={orgId} canFinance={canFinance} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={260} />}>
        <ClientHealth orgId={orgId} range={range} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={200} />}>
        <ServiceHealth orgId={orgId} range={range} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={320} />}>
        <StageFlow orgId={orgId} range={range} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={260} />}>
        <TopRevised orgId={orgId} range={range} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={360} />}>
        <DeliveryFlow orgId={orgId} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={180} />}>
        <StuckProjects orgId={orgId} range={range} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={180} />}>
        <UpcomingDeadlines orgId={orgId} />
      </DashSection>

      <DashSection fallback={<SectionSkeleton h={300} />}>
        <TeamCapacity orgId={orgId} range={range} />
      </DashSection>
    </div>
  );
}

async function CeoAnalysisSection({ orgId, canFinance }: { orgId: string; canFinance: boolean }) {
  const t = await getTranslations("Dashboard");
  const [accountability, contracts] = await Promise.all([
    loadAccountabilitySummary(orgId),
    canFinance ? loadContractAnalysis(orgId) : Promise.resolve(null),
  ]);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{canFinance ? "CEO analysis" : "Operational analysis"}</h2>
          <p className="text-xs text-muted-foreground">
            {canFinance
              ? "Accountability signals and contract revenue movement for the current month."
              : "Accountability signals and operational ownership for the current month."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href="/accountability"
            className="inline-flex items-center gap-1 rounded-lg border border-soft bg-card px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            Accountability
            <ArrowUpRight className="size-3" />
          </Link>
          {canFinance && (
            <Link
              href="/contracts?view=dashboard"
              className="inline-flex items-center gap-1 rounded-lg border border-soft bg-card px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              Contracts
              <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>
      </div>

      <div className={cn("grid gap-3", contracts && "xl:grid-cols-2")}>
        <AccountabilityAnalysisCard summary={accountability} t={t} />
        {contracts && <ContractsAnalysisCard analysis={contracts} t={t} />}
      </div>
    </section>
  );
}

type AccountabilitySummary =
  | {
      ok: true;
      measuredRows: number;
      medianScore: number | null;
      highRiskCount: number;
      lowConfidenceCount: number;
      overdueTasks: number;
      aiRiskSignals: number;
      worstRows: Array<{
        employeeId: string;
        fullName: string;
        role: string;
        score: number | null;
        overdueOwned: number;
        onTimeRate: number | null;
        sampleSize: number;
        confidence: "high" | "low";
      }>;
    }
  | { ok: false; message: string };

async function loadAccountabilitySummary(orgId: string): Promise<AccountabilitySummary> {
  try {
    const overview = await getAccountabilityOverview(orgId);
    const reliable = overview.rows.filter((r) => r.score !== null && r.confidence === "high");
    const sortedScores = reliable.map((r) => r.score as number).sort((a, b) => a - b);
    const mid = Math.floor(sortedScores.length / 2);
    const medianScore =
      sortedScores.length === 0
        ? null
        : sortedScores.length % 2
          ? sortedScores[mid]
          : Math.round((sortedScores[mid - 1] + sortedScores[mid]) / 2);

    const worstRows = [...overview.rows]
      .filter((r) => r.score !== null)
      .sort((a, b) => {
        if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
        return (a.score ?? 999) - (b.score ?? 999);
      })
      .slice(0, 4)
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        role: r.role,
        score: r.score,
        overdueOwned: r.overdueOwned,
        onTimeRate: r.onTimeRate,
        sampleSize: r.sampleSize,
        confidence: r.confidence,
      }));

    return {
      ok: true,
      measuredRows: overview.rows.length,
      medianScore,
      highRiskCount: reliable.filter((r) => (r.score as number) < 50).length,
      lowConfidenceCount: overview.rows.filter(
        (r) => r.confidence === "low" || r.score === null,
      ).length,
      overdueTasks: overview.coverage.distinctOverdueTasks,
      aiRiskSignals: overview.aiSignals.filter(
        (s) => s.kind === "complaint" || s.kind === "risk" || s.kind === "delay_mention",
      ).length,
      worstRows,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Accountability data unavailable",
    };
  }
}

type ContractAnalysis =
  | {
      ok: true;
      month: string;
      dashboard: MonthlyDashboard;
      amTargets: AmTargetRow[];
      buckets: MonthBuckets;
    }
  | { ok: false; message: string };

async function loadContractAnalysis(orgId: string): Promise<ContractAnalysis> {
  try {
    const months = await listDashboardMonths(orgId);
    const selectedMonth = months[0]?.month;
    const dashboard = await getMonthlyDashboard(orgId, selectedMonth);
    if (!dashboard) {
      return { ok: false, message: "No contract dashboard data for the current month." };
    }
    const [amTargets, buckets] = await Promise.all([
      getAmTargets(orgId, selectedMonth),
      getMonthTargetBuckets(orgId, selectedMonth),
    ]);

    return {
      ok: true,
      month: selectedMonth ?? dashboard.month,
      dashboard,
      amTargets,
      buckets,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Contract analysis unavailable",
    };
  }
}

type DashT = Awaited<ReturnType<typeof getTranslations<"Dashboard">>>;

function AccountabilityAnalysisCard({ summary, t }: { summary: AccountabilitySummary; t: DashT }) {
  if (!summary.ok) {
    return <AnalysisUnavailable title="Accountability" message={summary.message} />;
  }

  return (
    <div className="rounded-2xl border border-soft bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="size-4 text-status-info" />
            Accountability
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Operational ownership, SLA discipline, and AI-linked risk signals.
          </p>
        </div>
        <Link href="/accountability" className="text-xs text-cyan hover:underline">
          Open
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <AnalysisStat label="Median score" value={fmtMaybePct(summary.medianScore)} tone="info" tip={t("metricTooltips.dashboard_medianScore")} />
        <AnalysisStat label="High risk" value={summary.highRiskCount} tone="danger" tip={t("metricTooltips.dashboard_highRisk")} />
        <AnalysisStat label="Overdue tasks" value={summary.overdueTasks} tone="warning" tip={t("metricTooltips.dashboard_overdueTasks")} />
        <AnalysisStat label="AI risk" value={summary.aiRiskSignals} tone="warning" tip={t("metricTooltips.dashboard_aiRisk")} />
      </div>

      <div className="mt-4 rounded-xl border border-soft bg-soft-1/35">
        <div className="flex items-center justify-between border-b border-soft px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            Lowest current scorecards
            <MetricInfo text={t("metricTooltips.dashboard_lowestScorecards")} />
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {summary.lowConfidenceCount} low confidence
            <MetricInfo text={t("metricTooltips.dashboard_lowConfidence")} />
          </span>
        </div>
        {summary.worstRows.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-muted-foreground">
            No measured accountability rows yet.
          </p>
        ) : (
          <div className="divide-y divide-soft/70">
            {summary.worstRows.map((row) => (
              <Link
                key={`${row.employeeId}-${row.role}`}
                href={`/accountability?emp=${row.employeeId}`}
                className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs transition-colors hover:bg-soft-2/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.fullName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {roleLabel(row.role)} · {row.sampleSize} samples · {row.overdueOwned} overdue
                  </span>
                </span>
                <span
                  className={cn(
                    "self-center rounded-md border px-2 py-1 text-xs font-semibold tabular-nums",
                    scoreTone(row.score, row.confidence),
                  )}
                >
                  {fmtMaybePct(row.score)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContractsAnalysisCard({ analysis, t }: { analysis: ContractAnalysis; t: DashT }) {
  if (!analysis.ok) {
    return <AnalysisUnavailable title="Contracts analysis" message={analysis.message} />;
  }

  const { dashboard: d, amTargets } = analysis;
  const topAm = [...amTargets].sort((a, b) => b.achievement_pct - a.achievement_pct).slice(0, 3);
  // "Due + overdue installments" must match the sheet, which reports four cells:
  // due-this-month (F27/F36) + overdue (E27/E36) for Account and Sales. The old
  // live recompute from `installments_due` only captured due-this-month and
  // dropped the overdue half, so it under-reported by ~50%. On a frozen
  // sheet_import month these are the sheet's verbatim values.
  const totalDue =
    d.acc_exp_inst + d.acc_exp_overdue_inst + d.sales_exp_inst + d.sales_exp_overdue_inst;

  return (
    <div className="rounded-2xl border border-soft bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BadgeDollarSign className="size-4 text-status-success" />
            Contracts analysis
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Revenue target, renewal pool, installments, and account-manager movement.
          </p>
        </div>
        <Link href="/contracts?view=dashboard" className="text-xs text-cyan hover:underline">
          Open
        </Link>
      </div>

      {/* Two department achievements — mirrors the sheet's Account / Sales
          sections. The sheet never blends them into one company %, so neither
          do we: each ratio is actual income vs its own target. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <AnalysisStat
          label="Total revenue (collected)"
          value={fmtSR(d.acc_actual + d.sales_total_income)}
          sub={`Acc ${fmtSR(d.acc_actual)} · Sales ${fmtSR(d.sales_total_income)}`}
          tone="success"
          tip="Company income collected this month — Account department income + Sales department income (the sheet reports the two separately; this is their sum)."
        />
        <DeptAchievementStat
          label="Account achievement"
          pct={d.acc_achievement_pct}
          actual={d.acc_actual}
          expected={d.acc_expected}
          tip="Account dept (sheet 'Revenue Achievement %'): Total Income from Account ÷ Total Expected."
        />
        <DeptAchievementStat
          label="Sales achievement"
          pct={d.sales_achievement_pct}
          actual={d.sales_act_inst}
          expected={d.sales_expected}
          tip="Sales dept (sheet 'Installments Achievement %'): Actual Installments ÷ Expected Installments. New-client income is excluded (no target)."
        />
        <AnalysisStat
          label="New-client income"
          value={fmtSR(d.sales_new_income)}
          tone="info"
          tip="Sheet 'Actual Income from new clients' — signing income with no renewal/installment target, so it sits outside the achievement ratios."
        />
        <AnalysisStat label="Due + overdue installments" value={fmtSR(totalDue)} tone="warning" tip={t("metricTooltips.dashboard_dueInstallments")} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-xl border border-soft bg-soft-1/35 p-3">
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium">
              Department achievement
              <MetricInfo text={t("metricTooltips.dashboard_monthlyAchievementBar")} />
            </span>
            <span className="tabular-nums text-muted-foreground">{analysis.month}</span>
          </div>
          <div className="space-y-2.5">
            <DeptBar label="Account" pct={d.acc_achievement_pct} />
            <DeptBar label="Sales" pct={d.sales_achievement_pct} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
            <MiniCount label="New" value={d.mov_new} tip={t("metricTooltips.dashboard_movNew")} />
            <MiniCount label="Renewed" value={d.mov_renewed} tip={t("metricTooltips.dashboard_movRenewed")} />
            <MiniCount label="Lost" value={d.mov_lost} tip={t("metricTooltips.dashboard_movLost")} />
            <MiniCount label="On target" value={d.cnt_on_target} tip={t("metricTooltips.dashboard_cntOnTarget")} />
            <MiniCount label="Overdue" value={d.cnt_overdue} tip={t("metricTooltips.dashboard_cntOverdue")} />
            <MiniCount label="Hold" value={d.cnt_roster_hold} tip={t("metricTooltips.dashboard_cntHold")} />
          </div>
        </div>

        <div className="rounded-xl border border-soft bg-soft-1/35">
          <div className="flex items-center justify-between border-b border-soft px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              Top account managers
              <MetricInfo text={t("metricTooltips.dashboard_topAccountManagers")} />
            </span>
            <span className="text-[11px] text-muted-foreground">{amTargets.length} tracked</span>
          </div>
          {topAm.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No AM targets calculated yet.
            </p>
          ) : (
            <div className="divide-y divide-soft/70">
              {topAm.map((am) => (
                <div key={am.account_manager_id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {am.account_manager_name ?? "Unassigned"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {fmtSR(am.achieved_total)} / {fmtSR(am.expected_total)}
                    </span>
                  </span>
                  <Explained text={t("metricTooltips.dashboard_amAchievementPct")} className="self-center rounded-md border border-cc-green/25 bg-green-dim px-2 py-1 font-semibold tabular-nums text-status-success">
                    {am.achievement_pct.toFixed(0)}%
                  </Explained>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-amber/25 bg-amber-dim/30 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-amber">
        <AlertTriangle className="size-4" />
        {title}
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function AnalysisStat({
  label,
  value,
  tone,
  tip,
  sub,
}: {
  label: string;
  value: string | number;
  tone: "info" | "success" | "warning" | "danger";
  tip?: React.ReactNode;
  sub?: string;
}) {
  const toneCls = {
    info: "border-cc-blue/25 bg-blue-dim text-status-info",
    success: "border-cc-green/25 bg-green-dim text-status-success",
    warning: "border-amber/25 bg-amber-dim text-status-warning",
    danger: "border-cc-red/25 bg-red-dim text-status-danger",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3", toneCls)}>
      <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        {tip ? <MetricInfo text={tip} /> : null}
      </div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</div>
      {sub ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">{sub}</div>
      ) : null}
    </div>
  );
}

function DeptAchievementStat({
  label,
  pct,
  actual,
  expected,
  tip,
}: {
  label: string;
  pct: number;
  actual: number;
  expected: number;
  tip?: React.ReactNode;
}) {
  const tone = achievementTone(pct);
  const toneCls = {
    success: "border-cc-green/25 bg-green-dim text-status-success",
    warning: "border-amber/25 bg-amber-dim text-status-warning",
    danger: "border-cc-red/25 bg-red-dim text-status-danger",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3", toneCls)}>
      <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        {tip ? <MetricInfo text={tip} /> : null}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{Math.round(pct)}%</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
        {fmtSR(actual)} / {fmtSR(expected)}
      </div>
    </div>
  );
}

function DeptBar({ label, pct }: { label: string; pct: number }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-soft-2">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function MiniCount({ label, value, tip }: { label: string; value: number; tip?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-soft bg-card/60 px-2 py-1.5">
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 inline-flex items-center gap-1 truncate text-muted-foreground">
        {label}
        {tip ? <MetricInfo text={tip} /> : null}
      </div>
    </div>
  );
}

function fmtSR(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} SR`;
}

function fmtMaybePct(value: number | null): string {
  return value === null ? "N/A" : `${Math.round(value)}%`;
}

function achievementTone(value: number): "success" | "warning" | "danger" {
  if (value >= 80) return "success";
  if (value >= 40) return "warning";
  return "danger";
}

function scoreTone(score: number | null, confidence: "high" | "low"): string {
  if (score === null || confidence === "low") {
    return "border-soft bg-soft-1 text-muted-foreground";
  }
  if (score >= 70) return "border-cc-green/25 bg-green-dim text-status-success";
  if (score >= 50) return "border-amber/25 bg-amber-dim text-status-warning";
  return "border-cc-red/25 bg-red-dim text-status-danger";
}

function roleLabel(role: string): string {
  if (role === "account_manager") return "Account manager";
  if (role === "team_manager") return "Team manager";
  return "Agent";
}
