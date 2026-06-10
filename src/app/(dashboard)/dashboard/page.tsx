import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireSession, getDashboardScope, type ServerSession } from "@/lib/auth-server";
import { DepartmentDashboard } from "@/components/department/department-dashboard";
import { AgentCockpit } from "@/components/cockpit/agent-cockpit";
import { getTeamActivityOverview } from "@/lib/data/activity-scores";
import { ActivityPulseBand } from "@/components/activity/activity-pulse-band";
import { getCeoDashboardData, currentMonthIso } from "@/lib/data/ceo-dashboard";
import { FinancialSummary } from "@/components/executive/financial-summary";
import { getExecutiveScores } from "@/lib/data/executive-scores";
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

// ---- Sections (each streams behind its own Suspense) ---------------------

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
    <div>
      <PageHeader
        title={t("welcome", { name: session.fullName })}
        description={t("welcomeDescription")}
      />

      <Suspense fallback={<StripSkeleton />}>
        <PulseBand orgId={orgId} />
      </Suspense>

      <Suspense fallback={<ScoresSkeleton />}>
        <ScoresBand orgId={orgId} />
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
