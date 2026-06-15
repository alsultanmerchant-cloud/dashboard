import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeDollarSign,
  Scale,
} from "lucide-react";
import { requireSession, getDashboardScope, type ServerSession } from "@/lib/auth-server";
import { DepartmentDashboard } from "@/components/department/department-dashboard";
import { AgentCockpit } from "@/components/cockpit/agent-cockpit";
import { getTeamActivityOverview } from "@/lib/data/activity-scores";
import { ActivityPulseBand } from "@/components/activity/activity-pulse-band";
import { getCeoDashboardData, currentMonthIso } from "@/lib/data/ceo-dashboard";
import { FinancialSummary } from "@/components/executive/financial-summary";
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
  getOnTimeTrend30d,
  getPulseStats,
  getClientHealth,
  getStageFunnel,
  getApprovalBottlenecks,
  getSpecialistLoadTop,
  getPerformerLeaderboard,
  getServiceLineHealth,
  getTopStuckProjects,
  getUpcomingDeadlines,
  getWipAging,
  getStageFlowMatrix,
  getTopRevisedTasks,
} from "@/lib/data/executive";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecutiveScoresBand } from "@/components/executive/scores-band";
import { CeoBriefCard } from "@/components/executive/ceo-brief-card";
import { DashboardSelectionAssistant } from "@/components/executive/dashboard-selection-assistant";
import { getCurrentCeoBrief } from "@/lib/ceo-brief-generate";
import { ExecutiveHeroRow } from "@/components/executive/hero-row";
import { PulseStrip } from "@/components/executive/pulse-strip";
import { ClientHealthSection } from "@/components/executive/client-health";
import { DeliveryFlowSection } from "@/components/executive/delivery-flow";
import { TeamCapacitySection } from "@/components/executive/team-capacity";
import { ServiceHealthSection } from "@/components/executive/service-health";
import { StuckProjectsSection } from "@/components/executive/stuck-projects";
import { UpcomingDeadlinesSection } from "@/components/executive/upcoming-deadlines";
import { WipAgingSection } from "@/components/executive/wip-aging";
import { StageFlowMatrixSection } from "@/components/executive/stage-flow-matrix";
import { TopRevisedTasksSection } from "@/components/executive/top-revised";
import { cn } from "@/lib/utils";

// ---- Sections (each streams behind its own Suspense) ---------------------

async function BriefSection({ orgId }: { orgId: string }) {
  // Read the cached brief (daily cron + on-demand refresh keep it fresh). The
  // card is interactive client-side; we only seed it with the current run.
  const current = await getCurrentCeoBrief(orgId);
  return <CeoBriefCard initialBrief={current} />;
}

async function ScoresBand({ orgId }: { orgId: string }) {
  const data = await getExecutiveScores(orgId);
  return <ExecutiveScoresBand data={data} />;
}

async function PulseBand({ orgId }: { orgId: string }) {
  const data = await getTeamActivityOverview(orgId);
  return <ActivityPulseBand data={data} />;
}

async function HeroSection({ orgId }: { orgId: string }) {
  const [data, trend] = await Promise.all([getHeroKpis(orgId), getOnTimeTrend30d(orgId)]);
  return <ExecutiveHeroRow data={data} trend={trend} />;
}

async function Pulse({ orgId }: { orgId: string }) {
  const data = await getPulseStats(orgId);
  return <PulseStrip data={data} />;
}

async function ClientHealth({ orgId }: { orgId: string }) {
  const { worst, best } = await getClientHealth(orgId);
  return <ClientHealthSection worst={worst} best={best} />;
}

async function ServiceHealth({ orgId }: { orgId: string }) {
  const rows = await getServiceLineHealth(orgId);
  return <ServiceHealthSection rows={rows} />;
}

async function WipAging({ orgId }: { orgId: string }) {
  const rows = await getWipAging(orgId);
  return <WipAgingSection rows={rows} />;
}

async function StageFlow({ orgId }: { orgId: string }) {
  const data = await getStageFlowMatrix(orgId);
  return <StageFlowMatrixSection {...data} />;
}

async function TopRevised({ orgId }: { orgId: string }) {
  const rows = await getTopRevisedTasks(orgId);
  return <TopRevisedTasksSection rows={rows} />;
}

async function DeliveryFlow({ orgId }: { orgId: string }) {
  const [funnel, bottlenecks] = await Promise.all([
    getStageFunnel(orgId),
    getApprovalBottlenecks(orgId),
  ]);
  return <DeliveryFlowSection funnel={funnel} bottlenecks={bottlenecks} />;
}

async function StuckProjects({ orgId }: { orgId: string }) {
  const rows = await getTopStuckProjects(orgId);
  return <StuckProjectsSection rows={rows} />;
}

async function UpcomingDeadlines({ orgId }: { orgId: string }) {
  const days = await getUpcomingDeadlines(orgId);
  return <UpcomingDeadlinesSection days={days} />;
}

async function TeamCapacity({ orgId }: { orgId: string }) {
  const [specialists, performers] = await Promise.all([
    getSpecialistLoadTop(orgId),
    getPerformerLeaderboard(orgId),
  ]);
  return <TeamCapacitySection specialists={specialists} performers={performers} />;
}

async function FinancialSummarySection({ orgId }: { orgId: string }) {
  const data = await getCeoDashboardData(orgId, currentMonthIso());
  return <FinancialSummary data={data} />;
}

// ---- Skeletons -----------------------------------------------------------

function ScoresSkeleton() {
  return (
    <div className="mb-8 grid gap-3 lg:grid-cols-[1.15fr_2fr]">
      <Skeleton className="h-[220px] rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-[220px] rounded-2xl" />
        <Skeleton className="h-[220px] rounded-2xl" />
        <Skeleton className="h-[220px] rounded-2xl" />
        <Skeleton className="h-[220px] rounded-2xl" />
      </div>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="mb-8 grid gap-3 lg:grid-cols-[1.7fr_1fr_1fr_1fr]">
      <Skeleton className="h-[180px] rounded-2xl" />
      <Skeleton className="h-[180px] rounded-2xl" />
      <Skeleton className="h-[180px] rounded-2xl" />
      <Skeleton className="h-[180px] rounded-2xl" />
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

// ---- Page ----------------------------------------------------------------

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  const scope = await getDashboardScope(session);

  if (scope.kind === "ceo") {
    return <ExecutiveDashboard session={session} />;
  }

  if (scope.kind === "agent") {
    return <AgentCockpit session={session} employeeId={scope.employeeId} />;
  }

  const { month } = await searchParams;

  return (
    <DepartmentDashboard
      session={session}
      scope={scope}
      canMonthlyClosing={scope.kind === "head"}
      month={month}
    />
  );
}

async function ExecutiveDashboard({ session }: { session: ServerSession }) {
  const orgId = session.orgId;
  const t = await getTranslations("Dashboard");

  return (
    <div data-dashboard-root>
      {/* Select any text on the dashboard to ask, correct, or teach the AI. */}
      <DashboardSelectionAssistant />

      <PageHeader
        title={t("welcome", { name: session.fullName })}
        description={t("welcomeDescription")}
      />

      <Suspense fallback={<Skeleton className="mb-8 h-[360px] rounded-2xl" />}>
        <BriefSection orgId={orgId} />
      </Suspense>

      <Suspense fallback={<StripSkeleton />}>
        <PulseBand orgId={orgId} />
      </Suspense>

      <Suspense fallback={<ScoresSkeleton />}>
        <ScoresBand orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={300} />}>
        <CeoAnalysisSection orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={200} />}>
        <FinancialSummarySection orgId={orgId} />
      </Suspense>

      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection orgId={orgId} />
      </Suspense>

      <Suspense fallback={<StripSkeleton />}>
        <Pulse orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={260} />}>
        <ClientHealth orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={200} />}>
        <ServiceHealth orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={180} />}>
        <WipAging orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={320} />}>
        <StageFlow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={260} />}>
        <TopRevised orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={360} />}>
        <DeliveryFlow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={180} />}>
        <StuckProjects orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={180} />}>
        <UpcomingDeadlines orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton h={300} />}>
        <TeamCapacity orgId={orgId} />
      </Suspense>
    </div>
  );
}

async function CeoAnalysisSection({ orgId }: { orgId: string }) {
  const [accountability, contracts] = await Promise.all([
    loadAccountabilitySummary(orgId),
    loadContractAnalysis(orgId),
  ]);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">CEO analysis</h2>
          <p className="text-xs text-muted-foreground">
            Accountability signals and contract revenue movement for the current month.
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
          <Link
            href="/contracts?view=dashboard"
            className="inline-flex items-center gap-1 rounded-lg border border-soft bg-card px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            Contracts
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <AccountabilityAnalysisCard summary={accountability} />
        <ContractsAnalysisCard analysis={contracts} />
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

function AccountabilityAnalysisCard({ summary }: { summary: AccountabilitySummary }) {
  if (!summary.ok) {
    return <AnalysisUnavailable title="Accountability" message={summary.message} />;
  }

  return (
    <div className="rounded-2xl border border-soft bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="size-4 text-violet-300" />
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
        <AnalysisStat label="Median score" value={fmtMaybePct(summary.medianScore)} tone="info" />
        <AnalysisStat label="High risk" value={summary.highRiskCount} tone="danger" />
        <AnalysisStat label="Overdue tasks" value={summary.overdueTasks} tone="warning" />
        <AnalysisStat label="AI risk" value={summary.aiRiskSignals} tone="warning" />
      </div>

      <div className="mt-4 rounded-xl border border-soft bg-soft-1/35">
        <div className="flex items-center justify-between border-b border-soft px-3 py-2">
          <span className="text-xs font-medium">Lowest current scorecards</span>
          <span className="text-[11px] text-muted-foreground">
            {summary.lowConfidenceCount} low confidence
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

function ContractsAnalysisCard({ analysis }: { analysis: ContractAnalysis }) {
  if (!analysis.ok) {
    return <AnalysisUnavailable title="Contracts analysis" message={analysis.message} />;
  }

  const { dashboard: d, amTargets, buckets } = analysis;
  const achievement = Math.min(100, Math.max(0, d.achievement_pct));
  const topAm = [...amTargets].sort((a, b) => b.achievement_pct - a.achievement_pct).slice(0, 3);
  const totalDue = buckets.installments_due.reduce((sum, row) => sum + row.expected_amount, 0);

  return (
    <div className="rounded-2xl border border-soft bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BadgeDollarSign className="size-4 text-emerald-300" />
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

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <AnalysisStat label="Expected" value={fmtSR(d.total_expected)} tone="info" />
        <AnalysisStat label="Actual" value={fmtSR(d.total_actual)} tone="success" />
        <AnalysisStat label="Achievement" value={`${d.achievement_pct.toFixed(1)}%`} tone={achievementTone(d.achievement_pct)} />
        <AnalysisStat label="Due installments" value={fmtSR(totalDue)} tone="warning" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-xl border border-soft bg-soft-1/35 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium">Monthly achievement</span>
            <span className="tabular-nums text-muted-foreground">{analysis.month}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-soft-2">
            <div
              className={cn(
                "h-full rounded-full",
                d.achievement_pct >= 80
                  ? "bg-emerald-500"
                  : d.achievement_pct >= 40
                    ? "bg-amber-500"
                    : "bg-rose-500",
              )}
              style={{ width: `${achievement}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
            <MiniCount label="New" value={d.mov_new} />
            <MiniCount label="Renewed" value={d.mov_renewed} />
            <MiniCount label="Lost" value={d.mov_lost} />
            <MiniCount label="On target" value={d.cnt_on_target} />
            <MiniCount label="Overdue" value={d.cnt_overdue} />
            <MiniCount label="Hold" value={d.mov_hold} />
          </div>
        </div>

        <div className="rounded-xl border border-soft bg-soft-1/35">
          <div className="flex items-center justify-between border-b border-soft px-3 py-2">
            <span className="text-xs font-medium">Top account managers</span>
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
                  <span className="self-center rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-semibold tabular-nums text-emerald-300">
                    {am.achievement_pct.toFixed(0)}%
                  </span>
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
}: {
  label: string;
  value: string | number;
  tone: "info" | "success" | "warning" | "danger";
}) {
  const toneCls = {
    info: "border-sky-500/25 bg-sky-500/5 text-sky-200",
    success: "border-emerald-500/25 bg-emerald-500/5 text-emerald-200",
    warning: "border-amber-500/25 bg-amber-500/5 text-amber-200",
    danger: "border-rose-500/25 bg-rose-500/5 text-rose-200",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3", toneCls)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-soft bg-card/60 px-2 py-1.5">
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-muted-foreground">{label}</div>
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
  if (score >= 70) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (score >= 50) return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return "border-rose-500/25 bg-rose-500/10 text-rose-300";
}

function roleLabel(role: string): string {
  if (role === "account_manager") return "Account manager";
  if (role === "team_manager") return "Team manager";
  return "Agent";
}
