import { Suspense } from "react";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import {
  Activity, AlertTriangle, BarChart3, ListChecks, Sparkles,
  Timer, TrendingUp, Users,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { MetricInfo, Explained } from "@/components/metric-info";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatRowSkeleton } from "@/components/skeletons";
import { getReportsOdooData } from "@/lib/odoo/live";
import {
  getRenewalForecast90d, getLatestStoredDigest,
} from "@/lib/data/reports";
import {
  getStageDwellAverages,
  getSpecialistLoad,
  getBehindScheduleBuckets,
  getDesignerMonthlyOutput,
  getLeadershipNameSet,
} from "@/lib/data/reports-extras";
import { SummarizeWeekButton } from "./summarize-week-button";
import { StageDwellChart } from "./stage-dwell-chart";
import { SpecialistLoadChart } from "./specialist-load-chart";
import { SlipHeatmapChart } from "./slip-heatmap-chart";
import { DesignerMonthlyOutput } from "./designer-monthly-output";

export const dynamic = "force-dynamic";

function pctTone(pct: number | null): "success" | "warning" | "destructive" | "default" {
  if (pct === null) return "default";
  if (pct >= 85) return "success";
  if (pct >= 70) return "warning";
  return "destructive";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ designerMonth?: string }>;
}) {
  const session = await requirePagePermission("reports.view");
  const t = await getTranslations("ReportsPage");
  const sp = (await searchParams) ?? {};
  // Default the picker to "this month" so the page renders sensibly without
  // any URL param. Parsing is forgiving — bad input falls back to today.
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthParam = typeof sp.designerMonth === "string" && /^\d{4}-\d{2}$/.test(sp.designerMonth)
    ? sp.designerMonth
    : defaultMonth;
  const [yearStr, monthStr] = monthParam.split("-");
  const designerYear = parseInt(yearStr, 10);
  const designerMonth = parseInt(monthStr, 10);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            {t("smartDigestBadge")}
          </Badge>
        }
      />

      <Card className="mb-6 border-cyan/20">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Sparkles className="size-4 text-cyan" />
              {t("executiveDigest.title")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("executiveDigest.description")}
            </p>
          </div>
          <SummarizeWeekButton />
        </CardContent>
      </Card>

      {/* Odoo-backed sections share one heavy fetch — wrap them together so we
          pay the JSON-RPC round-trip once, but everything Supabase-backed
          streams in independently below. */}
      <Suspense fallback={<OdooSectionsFallback title={t("weeklyMetrics.title")} description={t("weeklyMetrics.description")} />}>
        <OdooSections orgId={session.orgId} />
      </Suspense>

      <SectionTitle
        title={t("sections.stageDwell.title")}
        description={t("sections.stageDwell.description")}
        actions={<MetricInfo text={t("metricTooltips.reports_stageDwell")} />}
      />
      <Suspense fallback={<ChartFallback />}>
        <StageDwellSection orgId={session.orgId} />
      </Suspense>

      <SectionTitle
        title={t("sections.specialistLoad.title")}
        description={t("sections.specialistLoad.description")}
        actions={<MetricInfo text={t("metricTooltips.reports_specialistLoad")} />}
      />
      <Suspense fallback={<ChartFallback />}>
        <SpecialistLoadSection orgId={session.orgId} />
      </Suspense>

      <SectionTitle
        title={t("sections.designerOutput.title")}
        description={t("sections.designerOutput.description")}
        actions={<MetricInfo text={t("metricTooltips.reports_designerOutput")} />}
      />
      <Suspense fallback={<ChartFallback />}>
        <DesignerOutputSection
          orgId={session.orgId}
          year={designerYear}
          month={designerMonth}
          monthParam={monthParam}
        />
      </Suspense>

      <SectionTitle
        title={t("sections.slipHeatmap.title")}
        description={t("sections.slipHeatmap.description")}
        actions={<MetricInfo text={t("metricTooltips.reports_slipHeatmap")} />}
      />
      <Suspense fallback={<ChartFallback />}>
        <SlipHeatmapSection orgId={session.orgId} />
      </Suspense>

      <SectionTitle
        title={t("sections.renewals.title")}
        description={t("sections.renewals.description")}
        actions={
          <span className="inline-flex items-center gap-2">
            <MetricInfo text={t("metricTooltips.reports_renewalDays")} />
            <Link href="/projects?filter=renewals_this_month" className="text-xs text-cyan hover:underline">
              {t("sections.renewals.openProjects")}
            </Link>
          </span>
        }
      />
      <Suspense fallback={<ListFallback />}>
        <RenewalsSection orgId={session.orgId} />
      </Suspense>

      <Suspense fallback={<DigestFallback title={t("storedDigest.title")} description={t("loading")} />}>
        <DigestSection orgId={session.orgId} />
      </Suspense>

      <div className="mt-4 rounded-2xl border border-cyan/20 bg-cyan-dim/20 p-5 flex items-start gap-3">
        <BarChart3 className="size-5 text-cyan shrink-0 mt-0.5" />
        <div className="text-sm text-foreground/90 leading-relaxed">
          {t("footerNote")}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Odoo-backed sections ─────────────────────────

async function OdooSections({ orgId }: { orgId: string }) {
  const t = await getTranslations("ReportsPage");
  let reports;
  try {
    reports = await getReportsOdooData();
  } catch (err) {
    console.error("[reports] Odoo fetch failed:", err);
    return (
      <>
        <SectionTitle
          title={t("weeklyMetrics.title")}
          description={t("weeklyMetrics.description")}
        />
        <div className="mb-8 rounded-2xl border border-amber/30 bg-amber/[0.05] px-5 py-6 text-sm text-foreground/85">
          {t("weeklyMetrics.odooUnavailable")}
        </div>
      </>
    );
  }
  // Agents-only People Board: drop leadership (dept managers, CSO, leads). The
  // Odoo leaderboard has no position data, so we filter by name against the
  // Supabase leadership set (same org, same names → exact-after-trim match).
  const leadershipNames = await getLeadershipNameSet(orgId);
  const agentLeaderboard = reports.agentLeaderboard.filter(
    (l) => !leadershipNames.has(l.fullName.trim().replace(/\s+/g, " ")),
  );
  const maxRework = Math.max(1, ...reports.reworkByProject.map((h) => h.count));
  const maxLb = Math.max(1, ...agentLeaderboard.map((l) => l.closedCount));

  return (
    <>
      <SectionTitle
        title={t("weeklyMetrics.title")}
        description={t("weeklyMetrics.description")}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Explained text={t("metricTooltips.reports_onTime")} className="block">
          <MetricCard
            label={t("weeklyMetrics.cards.onTime")}
            value={reports.onTime.pct === null ? "—" : `${reports.onTime.pct}%`}
            hint={reports.onTime.sample === 0 ? t("weeklyMetrics.hints.noSample") : t("weeklyMetrics.hints.sample", { count: reports.onTime.sample })}
            icon={<Timer className="size-5" />}
            tone={pctTone(reports.onTime.pct)}
          />
        </Explained>
        <Explained text={t("metricTooltips.reports_reviewBacklog")} className="block">
          <MetricCard
            label={t("weeklyMetrics.cards.reviewBacklog")}
            value={reports.reviewBacklog.length}
            hint={reports.reviewBacklog.length === 0 ? t("weeklyMetrics.hints.noDelay") : t("weeklyMetrics.hints.waitingReview")}
            icon={<AlertTriangle className="size-5" />}
            tone={reports.reviewBacklog.length > 0 ? "destructive" : "default"}
          />
        </Explained>
        <Explained text={t("metricTooltips.reports_rework")} className="block">
          <MetricCard
            label={t("weeklyMetrics.cards.rework")}
            value={reports.reworkTotal}
            hint={t("weeklyMetrics.hints.affectedProjects", { count: reports.reworkByProject.length })}
            icon={<Activity className="size-5" />}
            tone={reports.reworkTotal > 0 ? "warning" : "default"}
          />
        </Explained>
        <Explained text={t("metricTooltips.reports_odooTasks")} className="block">
          <MetricCard
            label={t("weeklyMetrics.cards.odooTasks")}
            value={agentLeaderboard.reduce((s, r) => s + r.closedCount, 0)}
            hint={t("weeklyMetrics.hints.last4Weeks")}
            icon={<TrendingUp className="size-5" />}
            tone="info"
          />
        </Explained>
      </div>

      <SectionTitle
        title={t("reworkByProject.title")}
        description={t("reworkByProject.description")}
        actions={<MetricInfo text={t("metricTooltips.reports_reworkByProject")} />}
      />
      {reports.reworkByProject.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center mb-8">
          {t("reworkByProject.empty")}
        </p>
      ) : (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3">
            {reports.reworkByProject.map((h) => {
              const pct = (h.count / maxRework) * 100;
              return (
                <div key={h.projectId}>
                  <div className="flex items-center justify-between mb-1.5">
                    <Link
                      href={`/projects/odoo/${h.projectId}`}
                      className="text-sm font-medium hover:text-cyan transition-colors truncate max-w-[60%]"
                    >
                      {h.projectName}
                    </Link>
                    <span className="text-sm font-bold tabular-nums">{h.count}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-soft-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-amber to-cc-red"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <SectionTitle
        title={t("peopleBoard.title")}
        description={t("peopleBoard.description")}
        actions={
          <span className="inline-flex items-center gap-2">
            <MetricInfo text={t("metricTooltips.reports_peopleBoard")} />
            <Users className="size-4 text-muted-foreground" />
          </span>
        }
      />
      {agentLeaderboard.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center mb-8">
          {t("peopleBoard.empty")}
        </p>
      ) : (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3">
            {agentLeaderboard.map((row) => {
              const pct = (row.closedCount / maxLb) * 100;
              return (
                <div key={row.userId}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{row.fullName}</span>
                    <span className="text-sm tabular-nums">
                      <span className="font-bold">{row.closedCount}</span>
                      <span className="text-xs text-muted-foreground mx-1.5"> · {row.utilizationPct}%</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-soft-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-cyan to-cc-purple"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function OdooSectionsFallback({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <SectionTitle
        title={title}
        description={description}
      />
      <div className="mb-8">
        <StatRowSkeleton count={4} />
      </div>
      <Skeleton className="h-48 w-full mb-8 rounded-2xl" />
      <Skeleton className="h-48 w-full mb-8 rounded-2xl" />
    </>
  );
}

// ───────────────────── Supabase-backed sections ─────────────────────

async function StageDwellSection({ orgId }: { orgId: string }) {
  const t = await getTranslations("ReportsPage");
  const stageDwell = await getStageDwellAverages(orgId);
  if (stageDwell.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center mb-8">
        {t("sections.stageDwell.empty")}
      </p>
    );
  }
  return (
    <Card className="mb-8">
      <CardContent className="p-4">
        <StageDwellChart rows={stageDwell} />
      </CardContent>
    </Card>
  );
}

async function SpecialistLoadSection({ orgId }: { orgId: string }) {
  const t = await getTranslations("ReportsPage");
  const specialistLoad = await getSpecialistLoad(orgId);
  if (specialistLoad.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center mb-8">
        {t("sections.specialistLoad.empty")}
      </p>
    );
  }
  return (
    <Card className="mb-8">
      <CardContent className="p-4">
        <SpecialistLoadChart rows={specialistLoad} />
      </CardContent>
    </Card>
  );
}

async function DesignerOutputSection({
  orgId,
  year,
  month,
  monthParam,
}: {
  orgId: string;
  year: number;
  month: number;
  monthParam: string;
}) {
  const rows = await getDesignerMonthlyOutput(orgId, year, month);
  return <DesignerMonthlyOutput rows={rows} selectedMonth={monthParam} />;
}

async function SlipHeatmapSection({ orgId }: { orgId: string }) {
  const slipBuckets = await getBehindScheduleBuckets(orgId);
  return (
    <Card className="mb-8">
      <CardContent className="p-4">
        <SlipHeatmapChart rows={slipBuckets} />
      </CardContent>
    </Card>
  );
}

async function RenewalsSection({ orgId }: { orgId: string }) {
  const t = await getTranslations("ReportsPage");
  const renewals = await getRenewalForecast90d(orgId);
  if (renewals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center mb-8">
        {t("sections.renewals.empty")}
      </p>
    );
  }
  return (
    <Card className="mb-8">
      <CardContent className="p-0">
        <ul className="divide-y divide-white/[0.04]">
          {renewals.slice(0, 12).map((r) => (
            <li key={r.project_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <Link
                  href={`/projects/${r.project_id}`}
                  className="text-sm font-medium hover:text-cyan transition-colors truncate"
                >
                  {r.project_name}
                </Link>
                <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                  {r.client_name}
                </p>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="text-xs tabular-nums" dir="ltr">
                  {r.next_renewal_date}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("renewalInDays", { count: r.days_until })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

async function DigestSection({ orgId }: { orgId: string }) {
  const t = await getTranslations("ReportsPage");
  const locale = await getLocale();
  const latestDigest = await getLatestStoredDigest(orgId);
  return (
    <>
      <SectionTitle
        title={t("storedDigest.title")}
        description={
          latestDigest
            ? t("storedDigest.generatedAt", { date: new Date(latestDigest.generated_at).toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US") })
            : t("storedDigest.notGenerated")
        }
        actions={<ListChecks className="size-4 text-muted-foreground" />}
      />
      {latestDigest ? (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  {t("storedDigest.cards.onTime")}
                  <MetricInfo text={t("metricTooltips.reports_digestOnTime")} />
                </p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.on_time.pct === null ? "—" : `${latestDigest.payload.on_time.pct}%`}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  {t("storedDigest.cards.weekClosures")}
                  <MetricInfo text={t("metricTooltips.reports_digestWeekClosures")} />
                </p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.productivity.closed_this_week}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  {t("storedDigest.cards.reviewBacklog")}
                  <MetricInfo text={t("metricTooltips.reports_digestReviewBacklog")} />
                </p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.review_backlog.count}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  {t("storedDigest.cards.renewals90d")}
                  <MetricInfo text={t("metricTooltips.reports_digestRenewals90d")} />
                </p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.renewals_next_90d.count}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("storedDigest.note")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-soft-2 bg-card/30 px-4 py-6 text-center mb-8">
          {t("storedDigest.empty")}
        </p>
      )}
    </>
  );
}

function ChartFallback() {
  return <Skeleton className="h-48 w-full mb-8 rounded-2xl" />;
}

function ListFallback() {
  return <Skeleton className="h-64 w-full mb-8 rounded-2xl" />;
}

function DigestFallback({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <SectionTitle
        title={title}
        description={description}
        actions={<ListChecks className="size-4 text-muted-foreground" />}
      />
      <Skeleton className="h-32 w-full mb-8 rounded-2xl" />
    </>
  );
}
