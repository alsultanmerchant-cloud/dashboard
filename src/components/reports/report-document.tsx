import { getTranslations, getLocale } from "next-intl/server";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarClock,
  ClipboardList,
  Minus,
  Sparkles,
  Users,
  HeartHandshake,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ExecutiveReportFacts,
  ReportTrend,
} from "@/lib/data/executive-report";
import type { ExecutiveReportResult } from "@/lib/executive-report-schema";

// =========================================================================
// The report document — one presentational tree rendered from a FROZEN run
// (facts + AI narrative), shared verbatim by /reports (screen) and
// /reports/print (paper). No data fetching here: everything comes from
// executive_report_runs so both surfaces always agree.
// =========================================================================

type Tone = "good" | "bad" | "neutral";

const fmtInt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

function trendTone(trend: ReportTrend | null, goodWhen: "up" | "down"): Tone {
  if (!trend || trend.direction === "no_change") return "neutral";
  const isUp = trend.direction === "increase";
  return isUp === (goodWhen === "up") ? "good" : "bad";
}

function TrendChip({
  trend,
  goodWhen,
  suffix = "",
}: {
  trend: ReportTrend | null;
  goodWhen: "up" | "down";
  suffix?: string;
}) {
  if (!trend) return <span className="text-[11px] text-muted-foreground">—</span>;
  const tone = trendTone(trend, goodWhen);
  const Icon =
    trend.direction === "increase"
      ? ArrowUpRight
      : trend.direction === "decrease"
        ? ArrowDownRight
        : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        tone === "good" && "bg-green-dim text-status-success",
        tone === "bad" && "bg-red-dim text-status-danger",
        tone === "neutral" && "bg-soft-1 text-muted-foreground",
      )}
      dir="ltr"
    >
      <Icon className="size-3" />
      {trend.difference > 0 ? "+" : ""}
      {fmtInt(trend.difference)}
      {suffix}
    </span>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section mb-8 rounded-2xl border border-soft bg-card p-5">
      <div className="mb-4 border-b border-soft pb-3">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-cyan">{icon}</span>
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

// The analyst's paragraphs — the heart of the "human-made report" ask.
function Narrative({ paragraphs, missingLabel }: { paragraphs: string[] | null; missingLabel: string }) {
  if (!paragraphs || paragraphs.length === 0) {
    return (
      <p className="mb-4 rounded-xl border border-dashed border-soft bg-soft-1/30 px-3 py-2 text-xs text-muted-foreground">
        {missingLabel}
      </p>
    );
  }
  return (
    <div className="mb-5 space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-7 text-foreground/95">
          {p}
        </p>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  extra,
  tone = "neutral",
  isPrivate,
}: {
  label: string;
  value: string;
  extra?: React.ReactNode;
  tone?: Tone;
  isPrivate?: "money" | "person" | "client";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "good" && "border-cc-green/25 bg-green-dim/40",
        tone === "bad" && "border-cc-red/25 bg-red-dim/40",
        tone === "neutral" && "border-soft bg-soft-1/35",
      )}
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-lg font-bold tabular-nums"
        {...(isPrivate ? { "data-private": isPrivate } : {})}
      >
        {value}
      </p>
      {extra ? <div className="mt-1">{extra}</div> : null}
    </div>
  );
}

function DataTable({
  headers,
  rows,
  privateCols,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  /** column indexes whose cells get data-private (demo-mode blur) */
  privateCols?: { idx: number; kind: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-soft">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-soft bg-soft-1/50 text-start">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-start font-semibold text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-soft/70">
          {rows.map((cells, ri) => (
            <tr key={ri}>
              {cells.map((c, ci) => {
                const priv = privateCols?.find((p) => p.idx === ci);
                return (
                  <td
                    key={ci}
                    className="px-3 py-2 tabular-nums"
                    {...(priv ? { "data-private": priv.kind } : {})}
                  >
                    {c}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

export async function ReportDocument({
  facts,
  result,
  canFinance,
  completedAt,
  aiWarning,
}: {
  facts: ExecutiveReportFacts;
  result: ExecutiveReportResult | null;
  canFinance: boolean;
  completedAt: string | null;
  aiWarning: string | null;
}) {
  const t = await getTranslations("ReportsPage");
  const locale = await getLocale();
  const sr = (n: number) => `${fmtInt(n)} ${t("currency")}`;
  const generatedLabel = completedAt
    ? new Date(completedAt).toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
        timeZone: "Asia/Riyadh",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <div className="report-document">
      {/* ── Cover ─────────────────────────────────────────────────────── */}
      <div className="report-section mb-8 rounded-2xl border border-cyan/25 bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan">{facts.orgName}</p>
        <h1 className="mt-1 text-2xl font-extrabold">{t("cover.title")}</h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("cover.period")}: <span className="tabular-nums" dir="ltr">{facts.period.from} → {facts.period.to}</span>{" "}
            ({t("cover.days", { count: facts.period.days })})
          </span>
          <span>
            {t("cover.generatedAt")}: <span className="tabular-nums">{generatedLabel}</span>
          </span>
        </div>
        {aiWarning ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber/30 bg-amber-dim/40 px-2.5 py-1.5 text-[11px] text-status-warning">
            <AlertTriangle className="size-3.5" />
            {t("cover.aiPartial")}
          </p>
        ) : null}
      </div>

      {/* ── 1 · الملخص التنفيذي ───────────────────────────────────────── */}
      {canFinance ? (
        <Section icon={<Sparkles className="size-4" />} title={t("summary.title")}>
          <Narrative paragraphs={result?.summary?.paragraphs ?? null} missingLabel={t("narrativeMissing")} />
          {result?.summary ? (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("summary.keyFindings")}</h3>
              <ul className="mb-5 space-y-1.5">
                {result.summary.keyFindings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-6">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan" />
                    {f}
                  </li>
                ))}
              </ul>
              <h3 className="mb-2 text-sm font-semibold">{t("summary.recommendations")}</h3>
              <DataTable
                headers={[t("summary.recArea"), t("summary.recAction"), t("summary.recOwner")]}
                rows={result.summary.recommendations.map((r) => [
                  <span key="a" className="font-semibold">{r.area}</span>,
                  r.action,
                  r.owner,
                ])}
              />
              <p className="mt-4 rounded-xl border border-cyan/25 bg-cyan-dim/25 px-4 py-3 text-sm font-semibold leading-6">
                {result.summary.bottomLine}
              </p>
            </>
          ) : null}
        </Section>
      ) : null}

      {/* ── 2 · مؤشرات الفترة ─────────────────────────────────────────── */}
      {facts.indicators || facts.scores ? (
        <Section
          icon={<ClipboardList className="size-4" />}
          title={t("indicators.title")}
          subtitle={t("indicators.subtitle")}
        >
          {facts.indicators ? (
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatTile
                label={t("indicators.projectsAtRisk")}
                value={facts.indicators.projectsAtRisk.value === null ? "—" : fmtInt(facts.indicators.projectsAtRisk.value)}
                extra={<TrendChip trend={facts.indicators.projectsAtRisk.trend} goodWhen="down" />}
                tone={trendTone(facts.indicators.projectsAtRisk.trend, "down")}
              />
              <StatTile
                label={t("indicators.highRisk", { threshold: facts.indicators.highRisk.threshold })}
                value={facts.indicators.highRisk.value === null ? "—" : fmtInt(facts.indicators.highRisk.value)}
                extra={<TrendChip trend={facts.indicators.highRisk.trend} goodWhen="down" />}
                tone={trendTone(facts.indicators.highRisk.trend, "down")}
              />
              <StatTile
                label={t("indicators.overdue")}
                value={facts.indicators.overdue.value === null ? "—" : fmtInt(facts.indicators.overdue.value)}
                extra={<TrendChip trend={facts.indicators.overdue.trend} goodWhen="down" />}
                tone={trendTone(facts.indicators.overdue.trend, "down")}
              />
              <StatTile
                label={t("indicators.onTime")}
                value={pct(facts.indicators.onTime.pct)}
                extra={<TrendChip trend={facts.indicators.onTime.trend} goodWhen="up" />}
                tone={trendTone(facts.indicators.onTime.trend, "up")}
              />
              <StatTile
                label={t("indicators.clientChanges")}
                value={facts.indicators.clientChanges.value === null ? "—" : fmtInt(facts.indicators.clientChanges.value)}
                extra={<TrendChip trend={facts.indicators.clientChanges.trend} goodWhen="down" />}
                tone={trendTone(facts.indicators.clientChanges.trend, "down")}
              />
            </div>
          ) : null}
          {facts.scores ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {(
                [
                  ["delivery", facts.scores.delivery.score, facts.scores.delivery.delta],
                  ["quality", facts.scores.quality.score, facts.scores.quality.delta],
                  ["discipline", facts.scores.discipline.score, facts.scores.discipline.delta],
                  ["productivity", facts.scores.productivity.score, facts.scores.productivity.delta],
                  ["stability", facts.scores.stability.score, facts.scores.stability.delta],
                ] as const
              ).map(([key, score, delta]) => (
                <StatTile
                  key={key}
                  label={t(`scores.${key}`)}
                  value={`${score}`}
                  tone={score >= 70 ? "good" : score < 50 ? "bad" : "neutral"}
                  extra={
                    delta === null ? undefined : (
                      <span
                        className={cn(
                          "text-[11px] font-semibold tabular-nums",
                          delta > 0 ? "text-status-success" : delta < 0 ? "text-status-danger" : "text-muted-foreground",
                        )}
                        dir="ltr"
                      >
                        {delta > 0 ? "+" : ""}
                        {delta} {t("scores.delta")}
                      </span>
                    )
                  }
                />
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* ── 3 · المال والعقود (finance-gated) ─────────────────────────── */}
      {canFinance && facts.finance ? (
        <Section
          icon={<BadgeDollarSign className="size-4" />}
          title={t("finance.title")}
          subtitle={t("finance.subtitle", { month: facts.finance.month.slice(0, 7) })}
        >
          <Narrative
            paragraphs={result?.financeClients?.paragraphs ?? null}
            missingLabel={t("narrativeMissing")}
          />
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t("finance.expected")} value={sr(facts.finance.expectedIncome)} isPrivate="money" />
            <StatTile label={t("finance.actual")} value={sr(facts.finance.actualIncome)} tone="good" isPrivate="money" />
            <StatTile
              label={t("finance.achievement")}
              value={`${Math.round(facts.finance.achievementPct)}%`}
              tone={facts.finance.achievementPct >= 80 ? "good" : facts.finance.achievementPct < 40 ? "bad" : "neutral"}
            />
            <StatTile label={t("finance.installments")} value={sr(facts.finance.installmentsDueAndOverdue)} tone="bad" isPrivate="money" />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t("finance.movNew")} value={fmtInt(facts.finance.movement.newClients)} />
            <StatTile label={t("finance.movRenewed")} value={fmtInt(facts.finance.movement.renewed)} />
            <StatTile label={t("finance.movLost")} value={fmtInt(facts.finance.movement.lost)} tone={facts.finance.movement.lost > 0 ? "bad" : "neutral"} />
            <StatTile label={t("finance.rosterOverdue")} value={fmtInt(facts.finance.roster.overdue)} tone={facts.finance.roster.overdue > 0 ? "bad" : "neutral"} />
          </div>
          {facts.finance.amTargets.length ? (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("finance.amTitle")}</h3>
              <DataTable
                headers={[t("finance.amName"), t("finance.amTarget"), t("finance.amAchieved"), t("finance.amPct")]}
                rows={facts.finance.amTargets.map((am) => [
                  am.name,
                  sr(am.expected),
                  sr(am.achieved),
                  <span
                    key="p"
                    className={cn(
                      "font-semibold",
                      am.pct >= 80 ? "text-status-success" : am.pct < 40 ? "text-status-danger" : "text-status-warning",
                    )}
                  >
                    {Math.round(am.pct)}%
                  </span>,
                ])}
                privateCols={[
                  { idx: 0, kind: "person" },
                  { idx: 1, kind: "money" },
                  { idx: 2, kind: "money" },
                ]}
              />
            </>
          ) : null}
        </Section>
      ) : null}

      {/* ── 4 · التسليم والتنفيذ ──────────────────────────────────────── */}
      {facts.delivery ? (
        <Section icon={<Truck className="size-4" />} title={t("delivery.title")} subtitle={t("delivery.subtitle")}>
          <Narrative paragraphs={result?.delivery?.paragraphs ?? null} missingLabel={t("narrativeMissing")} />
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t("delivery.editsActive")} value={fmtInt(facts.delivery.clientEdits.activeNow)} tone={facts.delivery.clientEdits.activeNow > 0 ? "bad" : "neutral"} />
            <StatTile label={t("delivery.editsEntered")} value={fmtInt(facts.delivery.clientEdits.enteredThisPeriod)} />
            <StatTile label={t("delivery.editsExisted")} value={fmtInt(facts.delivery.clientEdits.existedThisPeriod)} />
            <StatTile label={t("delivery.editsPrev")} value={fmtInt(facts.delivery.clientEdits.existedLastPeriod)} />
          </div>
          {facts.delivery.services.length ? (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("delivery.servicesTitle")}</h3>
              <DataTable
                headers={[
                  t("delivery.colService"),
                  t("delivery.colDelivered"),
                  t("delivery.colOnTime"),
                  t("delivery.colPrevOnTime"),
                  t("delivery.colOverdue"),
                  t("delivery.colOpen"),
                  t("delivery.colEdits"),
                ]}
                rows={facts.delivery.services.map((s) => [
                  <span key="n" className="font-medium">{s.name}</span>,
                  fmtInt(s.delivered),
                  pct(s.onTimePct),
                  pct(s.onTimePctPrev),
                  s.overdueCount > 0 ? <span className="text-status-danger">{fmtInt(s.overdueCount)}</span> : "0",
                  fmtInt(s.openCount),
                  fmtInt(s.clientChanges),
                ])}
              />
            </>
          ) : null}
          {facts.delivery.supportingDepartments.length ? (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">{t("delivery.supportingTitle")}</h3>
              <DataTable
                headers={[
                  t("delivery.colService"),
                  t("delivery.colDelivered"),
                  t("delivery.colOnTime"),
                  t("delivery.colPrevOnTime"),
                  t("delivery.colOverdue"),
                  t("delivery.colOpen"),
                  t("delivery.colEdits"),
                ]}
                rows={facts.delivery.supportingDepartments.map((s) => [
                  <span key="n" className="font-medium">{s.name}</span>,
                  fmtInt(s.delivered),
                  pct(s.onTimePct),
                  pct(s.onTimePctPrev),
                  s.overdueCount > 0 ? <span className="text-status-danger">{fmtInt(s.overdueCount)}</span> : "0",
                  fmtInt(s.openCount),
                  fmtInt(s.clientChanges),
                ])}
              />
            </>
          ) : null}
          {facts.delivery.stageDwell.length ? (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">{t("delivery.dwellTitle")}</h3>
              <DataTable
                headers={[t("delivery.dwellStage"), t("delivery.dwellAvgDays"), t("delivery.dwellSamples")]}
                rows={facts.delivery.stageDwell.map((s) => [
                  s.stageLabel,
                  s.avgDays.toFixed(1),
                  fmtInt(s.segments),
                ])}
              />
            </>
          ) : null}
        </Section>
      ) : null}

      {/* ── 5 · الفريق والمساءلة ──────────────────────────────────────── */}
      {facts.team ? (
        <Section icon={<Users className="size-4" />} title={t("team.title")} subtitle={t("team.subtitle")}>
          <Narrative paragraphs={result?.team?.paragraphs ?? null} missingLabel={t("narrativeMissing")} />
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t("team.headcount")} value={fmtInt(facts.team.totals.headcount)} />
            <StatTile label={t("team.completedWeek")} value={fmtInt(facts.team.totals.completedThisWeek)} tone="good" />
            <StatTile label={t("team.pendingLate")} value={fmtInt(facts.team.totals.pendingLate)} tone={facts.team.totals.pendingLate > 0 ? "bad" : "neutral"} />
            <StatTile label={t("team.stalled")} value={fmtInt(facts.team.totals.stalledCount)} tone={facts.team.totals.stalledCount > 0 ? "bad" : "neutral"} />
          </div>
          {facts.team.departments.length ? (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("team.deptTitle")}</h3>
              <DataTable
                headers={[
                  t("team.colDept"),
                  t("team.colHead"),
                  t("team.colHeadcount"),
                  t("team.colActive"),
                  t("team.colStalled"),
                  t("team.colLate"),
                  t("team.colCompleted"),
                ]}
                rows={facts.team.departments.map((d) => [
                  <span key="n" className="font-medium">{d.name}</span>,
                  d.headName ?? "—",
                  fmtInt(d.headcount),
                  fmtInt(d.activeCount),
                  d.stalledCount > 0 ? <span className="text-status-danger">{fmtInt(d.stalledCount)}</span> : "0",
                  d.pendingLate > 0 ? <span className="text-status-warning">{fmtInt(d.pendingLate)}</span> : "0",
                  fmtInt(d.completedThisWeek),
                ])}
                privateCols={[{ idx: 1, kind: "person" }]}
              />
            </>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {facts.team.topPerformers.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("team.topTitle")}</h3>
                <DataTable
                  headers={[t("team.colName"), t("team.colRole"), t("team.colScore"), t("team.colOnTime")]}
                  rows={facts.team.topPerformers.map((p) => [
                    p.name,
                    p.role,
                    <span key="s" className="font-semibold text-status-success">{p.score}</span>,
                    pct(p.onTimeRate),
                  ])}
                  privateCols={[{ idx: 0, kind: "person" }]}
                />
              </div>
            ) : null}
            {facts.team.lowPerformers.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("team.lowTitle")}</h3>
                <DataTable
                  headers={[t("team.colName"), t("team.colRole"), t("team.colScore"), t("team.colOverdueOwned")]}
                  rows={facts.team.lowPerformers.map((p) => [
                    p.name,
                    p.role,
                    <span key="s" className="font-semibold text-status-danger">{p.score}</span>,
                    fmtInt(p.overdueOwned),
                  ])}
                  privateCols={[{ idx: 0, kind: "person" }]}
                />
              </div>
            ) : null}
          </div>
          {facts.team.designerOutput.length ? (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">{t("team.designersTitle")}</h3>
              <DataTable
                headers={[t("team.colName"), t("team.colDesigns"), t("team.colRevisions"), t("team.colTasks")]}
                rows={facts.team.designerOutput.map((d) => [
                  d.name,
                  fmtInt(d.designs),
                  fmtInt(d.revisions),
                  fmtInt(d.tasks),
                ])}
                privateCols={[{ idx: 0, kind: "person" }]}
              />
            </>
          ) : null}
        </Section>
      ) : null}

      {/* ── 6 · العملاء والرضا ────────────────────────────────────────── */}
      {facts.clients ? (
        <Section icon={<HeartHandshake className="size-4" />} title={t("clients.title")} subtitle={t("clients.subtitle")}>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t("clients.avgSatisfaction")}
              value={facts.clients.satisfaction.avgSatisfaction === null ? "—" : `${facts.clients.satisfaction.avgSatisfaction}%`}
              tone={
                facts.clients.satisfaction.avgSatisfaction === null
                  ? "neutral"
                  : facts.clients.satisfaction.avgSatisfaction >= 70
                    ? "good"
                    : "bad"
              }
            />
            <StatTile
              label={t("clients.briefAdherence")}
              value={facts.clients.satisfaction.avgBriefAdherence === null ? "—" : `${facts.clients.satisfaction.avgBriefAdherence}%`}
            />
            <StatTile label={t("clients.analyzed")} value={fmtInt(facts.clients.satisfaction.analyzedClients)} />
            <StatTile
              label={t("clients.atRisk")}
              value={fmtInt(facts.clients.satisfaction.atRiskClients)}
              tone={facts.clients.satisfaction.atRiskClients > 0 ? "bad" : "good"}
            />
          </div>
          {facts.clients.atRiskList.length ? (
            <>
              <h3 className="mb-2 text-sm font-semibold">{t("clients.atRiskTitle")}</h3>
              <DataTable
                headers={[t("clients.colClient"), t("clients.colSatisfaction"), t("clients.colSentiment")]}
                rows={facts.clients.atRiskList.map((c) => [
                  <span key="n" className="font-medium">{c.name}</span>,
                  c.satisfactionScore === null ? "—" : `${c.satisfactionScore}%`,
                  c.sentiment ?? "—",
                ])}
                privateCols={[{ idx: 0, kind: "client" }]}
              />
            </>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {facts.clients.worstClients.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("clients.worstTitle")}</h3>
                <DataTable
                  headers={[t("clients.colClient"), t("clients.colOnTime"), t("clients.colOverdue"), t("clients.colOpen")]}
                  rows={facts.clients.worstClients.map((c) => [
                    c.name,
                    pct(c.onTimePct),
                    c.overdue > 0 ? <span className="text-status-danger">{fmtInt(c.overdue)}</span> : "0",
                    fmtInt(c.open),
                  ])}
                  privateCols={[{ idx: 0, kind: "client" }]}
                />
              </div>
            ) : null}
            {facts.clients.bestClients.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("clients.bestTitle")}</h3>
                <DataTable
                  headers={[t("clients.colClient"), t("clients.colOnTime"), t("clients.colOverdue"), t("clients.colOpen")]}
                  rows={facts.clients.bestClients.map((c) => [
                    c.name,
                    pct(c.onTimePct),
                    fmtInt(c.overdue),
                    fmtInt(c.open),
                  ])}
                  privateCols={[{ idx: 0, kind: "client" }]}
                />
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* ── 7 · التجديدات والمواعيد ───────────────────────────────────── */}
      {facts.renewals ? (
        <Section
          icon={<CalendarClock className="size-4" />}
          title={t("renewals.title")}
          subtitle={t("renewals.subtitle", {
            count: facts.renewals.next90Count,
            deadlines: facts.renewals.deadlinesNext7Total,
          })}
        >
          {facts.renewals.next90.length ? (
            <DataTable
              headers={[t("renewals.colProject"), t("renewals.colClient"), t("renewals.colDate"), t("renewals.colDays")]}
              rows={facts.renewals.next90.map((r) => [
                <span key="p" className="font-medium">{r.project}</span>,
                r.client,
                <span key="d" dir="ltr">{r.date}</span>,
                fmtInt(r.daysUntil),
              ])}
              privateCols={[{ idx: 1, kind: "client" }]}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{t("renewals.empty")}</p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
