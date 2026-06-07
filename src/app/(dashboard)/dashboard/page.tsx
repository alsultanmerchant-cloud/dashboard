import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileSignature } from "lucide-react";
import { requireSession, getDashboardScope, type ServerSession } from "@/lib/auth-server";
import { DepartmentDashboard } from "@/components/department/department-dashboard";
import { AgentDashboard } from "@/components/department/agent-dashboard";
import { getTeamActivityOverview } from "@/lib/data/activity-scores";
import { ActivityPulseBand } from "@/components/activity/activity-pulse-band";
import { getCeoCommercialTiles } from "@/lib/data/contracts";
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
import { Card, CardContent } from "@/components/ui/card";
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

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(n);

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

async function CommercialStrip({ orgId }: { orgId: string }) {
  const t = await getTranslations("Executive.commercial");
  const tiles = await getCeoCommercialTiles(orgId).catch(() => ({
    month: "",
    byType: {} as Record<string, { count: number; value: number }>,
    totalCount: 0,
    totalValue: 0,
  }));

  return (
    <section className="mb-8">
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <FileSignature className="size-4 text-cyan" />
              {t("title")}
            </p>
            <Link href="/contracts" className="text-xs text-cyan hover:underline">
              {t("open")}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {(["New", "Renew", "UPSELL", "WinBack", "Hold"] as const).map((k) => {
              const agg = tiles.byType[k] ?? { count: 0, value: 0 };
              return (
                <div key={k} className="rounded-xl border border-border bg-card p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`types.${k}`)}
                  </p>
                  <p className="mt-1 text-base font-semibold tabular-nums">{agg.count}</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {sar(agg.value)}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
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
    return <AgentDashboard session={session} employeeId={scope.employeeId} />;
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

      <Suspense fallback={<SectionSkeleton h={120} />}>
        <CommercialStrip orgId={orgId} />
      </Suspense>
    </div>
  );
}
