import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  CheckCircle2, AlertTriangle, Sparkles,
  ArrowUpLeft, Clock, RefreshCw, ShieldAlert, FileSignature, Wallet,
  Activity, Timer, ListChecks, TrendingUp, Users, Send,
  Briefcase, Target, ShieldCheck,
} from "lucide-react";
import { countRenewalsThisMonth } from "@/lib/data/renewals";
import { getCeoCommercialTiles } from "@/lib/data/contracts";
import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  getRecentHandovers, getActivityFeed,
} from "@/lib/data/dashboard";
import {
  getDashboardOdooMetrics, getOdooGovernanceViolations,
} from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  HandoverStatusBadge, UrgencyBadge, PriorityBadge,
} from "@/components/status-badges";
import { relativeTimeAr } from "@/lib/utils-format";
import { AI_EVENT_META } from "@/lib/labels";
import { TaskStageBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";
import { StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// Pick an icon by event-type prefix so the feed reads at a glance.
function eventIcon(eventType: string) {
  if (eventType.startsWith("HANDOVER")) return Send;
  if (eventType.startsWith("CLIENT")) return Users;
  if (eventType.startsWith("PROJECT")) return Briefcase;
  if (eventType.startsWith("CONTRACT") || eventType.startsWith("RENEWAL")) return FileSignature;
  if (eventType.startsWith("EXCEPTION") || eventType.startsWith("ESCALATION")) return ShieldAlert;
  if (eventType.startsWith("GOVERNANCE")) return ShieldCheck;
  if (eventType.startsWith("SLA") || eventType.startsWith("TASK_OVERDUE")) return AlertTriangle;
  if (eventType.startsWith("EMPLOYEE") || eventType.startsWith("ORG")) return Users;
  if (eventType.startsWith("WEEKLY_DIGEST")) return ListChecks;
  if (eventType.startsWith("TASK")) return Target;
  return Activity;
}

// Map an event-type to a context key under `Dashboard.activity.context`.
function eventContextKey(eventType: string): string {
  if (eventType.startsWith("HANDOVER")) return "sales";
  if (eventType.startsWith("CLIENT")) return "clients";
  if (eventType.startsWith("PROJECT")) return "projects";
  if (eventType.startsWith("CONTRACT") || eventType.startsWith("RENEWAL")) return "contracts";
  if (eventType.startsWith("EXCEPTION") || eventType.startsWith("ESCALATION")) return "escalations";
  if (eventType.startsWith("GOVERNANCE")) return "governance";
  if (eventType.startsWith("SLA")) return "sla";
  if (eventType.startsWith("EMPLOYEE") || eventType.startsWith("ORG")) return "employees";
  if (eventType.startsWith("WEEKLY_DIGEST")) return "system";
  if (eventType.startsWith("TASK")) return "tasks";
  return "system";
}

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(n);

const EMPTY_ODOO_METRICS = {
  overdueCount: 0, reworkCount: 0, reviewBacklog: 0, closedThisWeek: 0,
  onTimePct: null as number | null, onTimeSample: 0, onTimeHits: 0,
  overdueTasks: [] as Array<{
    odooId: number;
    name: string;
    projectName: string | null;
    deadline: string | null;
    stage: string;
    priority: string;
    assigneeIds: number[];
  }>,
  totalProjects: 0, totalActiveProjects: 0, totalClients: 0,
};

// ── Hero KPIs (revenue / overdue / governance / renewals) ────────────────
async function HeroKPIs({ orgId }: { orgId: string }) {
  const t = await getTranslations("Dashboard.metrics");
  const [odooMetrics, governance, renewalsThisMonth, commercialTiles] = await Promise.all([
    getDashboardOdooMetrics().catch(() => EMPTY_ODOO_METRICS),
    getOdooGovernanceViolations().catch(() => ({
      violations: [], countsByKind: {
        unowned_task: 0, missing_deadline: 0,
        stuck_in_review: 0, overdue_no_progress: 0,
      }, total: 0,
    })),
    countRenewalsThisMonth(orgId),
    getCeoCommercialTiles(orgId).catch(() => ({
      month: "", byType: {} as Record<string, { count: number; value: number }>,
      totalCount: 0, totalValue: 0,
    })),
  ]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <MetricCard
        label={t("monthlyRevenue")}
        value={sar(commercialTiles.totalValue)}
        hint={t("contractsCount", { count: commercialTiles.totalCount })}
        icon={<Wallet className="size-5" />}
        tone="success"
        href="/contracts"
      />
      <MetricCard
        label={t("overdueTasks")}
        value={odooMetrics.overdueCount}
        hint={odooMetrics.overdueCount > 0 ? t("overdueTasksHintWith") : t("overdueTasksHintZero")}
        icon={<AlertTriangle className="size-5" />}
        tone={odooMetrics.overdueCount > 0 ? "destructive" : "default"}
        href="/tasks?filter=overdue"
      />
      <MetricCard
        label={t("governanceViolations")}
        value={governance.total}
        hint={governance.total > 0 ? t("governanceHintWith") : t("governanceHintZero")}
        icon={<ShieldAlert className="size-5" />}
        tone={governance.total > 0 ? "destructive" : "default"}
        href="/governance"
      />
      <MetricCard
        label={t("renewalsThisMonth")}
        value={renewalsThisMonth}
        hint={renewalsThisMonth > 0 ? t("renewalsHintWith") : t("renewalsHintZero")}
        icon={<RefreshCw className="size-5" />}
        tone={renewalsThisMonth > 0 ? "warning" : "default"}
        href="/projects?filter=renewals_this_month"
      />
    </div>
  );
}

// ── Operational KPIs (rework / on-time / productivity / review backlog) ──
async function OperationalKPIs() {
  const t = await getTranslations("Dashboard.metrics");
  const odooMetrics = await getDashboardOdooMetrics().catch(() => EMPTY_ODOO_METRICS);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <MetricCard
        label={t("rework")}
        value={odooMetrics.reworkCount}
        hint={odooMetrics.reworkCount > 0 ? t("reworkHintWith") : t("reworkHintZero")}
        icon={<Activity className="size-5" />}
        tone={odooMetrics.reworkCount > 0 ? "warning" : "default"}
        href="/tasks"
      />
      <MetricCard
        label={t("onTime")}
        value={odooMetrics.onTimePct === null ? "—" : `${odooMetrics.onTimePct}%`}
        hint={odooMetrics.onTimeSample === 0 ? t("onTimeNoSample") : t("onTimeSample", { sample: odooMetrics.onTimeSample })}
        icon={<Timer className="size-5" />}
        tone={odooMetrics.onTimePct === null
          ? "default"
          : odooMetrics.onTimePct >= 85
            ? "success"
            : odooMetrics.onTimePct >= 70
              ? "warning"
              : "destructive"}
        href="/tasks"
      />
      <MetricCard
        label={t("weeklyProductivity")}
        value={odooMetrics.closedThisWeek}
        hint={t("weeklyProductivityHint")}
        icon={<TrendingUp className="size-5" />}
        tone={odooMetrics.closedThisWeek > 0 ? "info" : "default"}
        href="/tasks"
      />
      <MetricCard
        label={t("reviewBacklog")}
        value={odooMetrics.reviewBacklog}
        hint={odooMetrics.reviewBacklog > 0 ? t("reviewBacklogHintWith") : t("reviewBacklogHintZero")}
        icon={<ListChecks className="size-5" />}
        tone={odooMetrics.reviewBacklog > 0 ? "destructive" : "default"}
        href="/tasks"
      />
    </div>
  );
}

// ── Commercial mix ──
async function CommercialMix({ orgId }: { orgId: string }) {
  const t = await getTranslations("Dashboard.commercialMix");
  const commercialTiles = await getCeoCommercialTiles(orgId).catch(() => ({
    month: "", byType: {} as Record<string, { count: number; value: number }>,
    totalCount: 0, totalValue: 0,
  }));

  return (
    <Card className="mb-6 border-cyan/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <FileSignature className="size-4 text-cyan" />
              {t("title")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("description")}
            </p>
          </div>
          <Link href="/contracts" className="text-xs text-cyan hover:underline">
            {t("openContracts")}
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
          {(["New","Renew","UPSELL","WinBack","Hold"] as const).map((k) => {
            const agg = commercialTiles.byType[k] ?? { count: 0, value: 0 };
            return (
              <div key={k} className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground">{t(`types.${k}`)}</p>
                <p className="text-base font-semibold tabular-nums">{agg.count}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {sar(agg.value)}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Open exceptions watch-list ──
async function ExceptionsWatchList({ orgId }: { orgId: string }) {
  const t = await getTranslations("Dashboard.exceptions");
  const { data: openExceptionsRaw } = await supabaseAdmin
    .from("exceptions")
    .select("kind")
    .eq("organization_id", orgId)
    .is("resolved_at", null);

  const openExceptions = openExceptionsRaw ?? [];
  const exceptionsByKind: Record<string, number> = {
    client: 0, deadline: 0, quality: 0, resource: 0,
  };
  for (const r of openExceptions) {
    exceptionsByKind[r.kind as string] = (exceptionsByKind[r.kind as string] ?? 0) + 1;
  }
  const totalOpenExceptions = openExceptions.length;

  return (
    <div>
      <SectionTitle
        title={t("title")}
        description={totalOpenExceptions > 0
          ? t("openCount", { count: totalOpenExceptions })
          : t("noneOpen")}
        actions={
          <Link href="/escalations" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
            <ArrowUpLeft className="size-3 icon-flip-rtl" />
            {t("inbox")}
          </Link>
        }
      />
      {totalOpenExceptions === 0 ? (
        <EmptyState
          variant="compact"
          icon={<ShieldAlert className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Card>
          <CardContent className="p-3.5 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t("kindClient")} · {exceptionsByKind.client}</Badge>
              <Badge variant="outline">{t("kindDeadline")} · {exceptionsByKind.deadline}</Badge>
              <Badge variant="outline">{t("kindQuality")} · {exceptionsByKind.quality}</Badge>
              <Badge variant="outline">{t("kindResource")} · {exceptionsByKind.resource}</Badge>
            </div>
            <Link
              href="/escalations"
              className="block text-xs text-cyan hover:underline pt-1"
            >
              {t("viewAll")} →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Overdue tasks watch-list ──
async function OverdueTasksWatchList() {
  const t = await getTranslations("Dashboard.overdue");
  const odooMetrics = await getDashboardOdooMetrics().catch(() => EMPTY_ODOO_METRICS);
  return (
    <div>
      <SectionTitle
        title={t("title")}
        description={odooMetrics.overdueCount > 0
          ? t("countOverdue", { count: odooMetrics.overdueCount })
          : t("allOnTime")}
        actions={
          <Link href="/tasks?filter=overdue" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
            <ArrowUpLeft className="size-3 icon-flip-rtl" />
            {t("viewAll")}
          </Link>
        }
      />
      {odooMetrics.overdueTasks.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<CheckCircle2 className="size-6" />}
          title={t("noneTitle")}
          description={t("noneDescription")}
        />
      ) : (
        <div className="space-y-2">
          {odooMetrics.overdueTasks.map((task) => {
            const daysLate = task.deadline
              ? Math.floor((Date.now() - new Date(task.deadline).getTime()) / 86400000)
              : 0;
            return (
              <Link
                key={task.odooId}
                href={`/tasks/odoo/${task.odooId}`}
                className="group block"
              >
                <Card className="border-cc-red/30 transition-colors group-hover:border-cc-red/60 group-hover:bg-cc-red/[0.03]">
                  <CardContent className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium line-clamp-1 group-hover:text-cyan transition-colors">
                          {task.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                          {task.projectName ?? "—"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <TaskStageBadge stage={task.stage} />
                          <PriorityBadge priority={task.priority} />
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Users className="size-3" />
                            {task.assigneeIds.length}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center justify-center rounded-lg bg-cc-red/15 px-3 py-2 shrink-0 min-w-[60px]">
                        <span className="text-2xl font-bold tabular-nums leading-none text-cc-red">
                          {daysLate}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-cc-red/80 mt-1">
                          {t("daysLate")}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Recent handovers watch-list ──
async function RecentHandoversList({ orgId }: { orgId: string }) {
  const t = await getTranslations("Dashboard.handovers");
  const handovers = await getRecentHandovers(orgId, 4);
  return (
    <div>
      <SectionTitle
        title={t("title")}
        description={handovers.length > 0
          ? t("recentCount", { count: handovers.length })
          : t("none")}
        actions={
          <Link href="/handover" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
            <ArrowUpLeft className="size-3 icon-flip-rtl" />
            {t("viewAll")}
          </Link>
        }
      />
      {handovers.length === 0 ? (
        <EmptyState
          variant="compact"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="space-y-2">
          {handovers.map((h) => {
            const project = Array.isArray(h.project) ? h.project[0] : h.project;
            return (
              <Card key={h.id}>
                <CardContent className="p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{h.client_name}</span>
                      <HandoverStatusBadge status={h.status} />
                      <UrgencyBadge level={h.urgency_level} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {relativeTimeAr(h.created_at)}
                      {project?.id && (
                        <>
                          {" · "}
                          <Link href={`/projects/${project.id}`} className="text-cyan hover:underline">
                            {t("projectLink")}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Activity feed ──
async function ActivityFeedSection({ orgId }: { orgId: string }) {
  const t = await getTranslations("Dashboard.activity");
  const activity = await getActivityFeed(orgId, 30);
  const filtered = activity
    .filter((a) => {
      const meta = AI_EVENT_META[a.event_type];
      return !meta || meta.tier !== "noise";
    })
    .slice(0, 8);

  return (
    <>
      <SectionTitle
        title={t("title")}
        description={
          filtered.length > 0
            ? t("descriptionWith")
            : t("descriptionEmpty")
        }
        actions={
          <Link href="/ai-insights" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            {t("viewAll")}
          </Link>
        }
      />
      {filtered.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<Activity className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-white/[0.04]">
              {filtered.map((a) => {
                const meta = AI_EVENT_META[a.event_type];
                const label = meta?.label ?? a.event_type;
                const isKey = meta?.tier === "key";
                const isHigh = a.importance === "high" || a.importance === "critical";
                const accent = isHigh
                  ? "bg-cc-red/15 text-cc-red"
                  : isKey
                    ? "bg-cyan-dim text-cyan"
                    : "bg-soft-2 text-muted-foreground";
                const Icon = eventIcon(a.event_type);
                return (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg shrink-0",
                          accent,
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t(`context.${eventContextKey(a.event_type)}`)}
                          {isHigh && (
                            <>
                              {" · "}
                              <span className="text-cc-red">{t("highImportance")}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {relativeTimeAr(a.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// Sky Light executive view: shell renders immediately, each block streams
// independently behind its own Suspense boundary so a slow Odoo call no
// longer blocks the whole page.
export default async function DashboardPage() {
  const session = await requireSession();
  const orgId = session.orgId;
  const t = await getTranslations("Dashboard");

  return (
    <div>
      <PageHeader
        title={t("welcome", { name: session.fullName })}
        description={t("welcomeDescription")}
      />

      <Suspense fallback={<div className="mb-6"><StatRowSkeleton count={4} /></div>}>
        <HeroKPIs orgId={orgId} />
      </Suspense>

      <Suspense fallback={<div className="mb-6"><StatRowSkeleton count={4} /></div>}>
        <OperationalKPIs />
      </Suspense>

      <Suspense fallback={
        <div className="mb-6 rounded-2xl border border-cyan/15 bg-card p-4">
          <Skeleton className="h-4 w-48 mb-3" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </div>
      }>
        <CommercialMix orgId={orgId} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        <Suspense fallback={<CardListSkeleton rows={2} />}>
          <ExceptionsWatchList orgId={orgId} />
        </Suspense>
        <Suspense fallback={<CardListSkeleton rows={3} />}>
          <OverdueTasksWatchList />
        </Suspense>
        <Suspense fallback={<CardListSkeleton rows={3} />}>
          <RecentHandoversList orgId={orgId} />
        </Suspense>
      </div>

      <Suspense fallback={<CardListSkeleton rows={5} />}>
        <ActivityFeedSection orgId={orgId} />
      </Suspense>
    </div>
  );
}
