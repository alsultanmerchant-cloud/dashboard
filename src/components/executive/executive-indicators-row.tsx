import { AlertTriangle, AlertOctagon, Timer, Clock, RefreshCcw, Hourglass, TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ExecutiveIndicators, KpiTrend, Period } from "@/lib/data/executive-indicators";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";

// Executive Indicators section (client spec — docs/EXECUTIVE_INDICATORS_SPEC.md).
// Each card = a big Main KPI Value (current live state) + a Trend chip (Selected
// vs Previous Equivalent Period) with a hover tooltip.

type T = Awaited<ReturnType<typeof getTranslations>>;

function fmtPeriod(p: Period) {
  return `${p.from} → ${p.to}`;
}

// Trend chip + tooltip shared by every KPI. `higherIsBetter` flips the colour
// polarity (on-time up = good; overdue up = bad).
function TrendChip({
  trend,
  higherIsBetter,
  unit,
  label,
  periods,
  t,
  percentMode = false,
}: {
  trend: KpiTrend;
  higherIsBetter: boolean;
  unit?: string;
  label: string;
  periods: { selected: Period; previous: Period };
  t: T;
  /** Spec KPI 5: display the % increase/decrease instead of the absolute diff. */
  percentMode?: boolean;
}) {
  const { difference, direction, available, percentChange } = trend;
  const Icon = direction === "increase" ? TrendingUp : direction === "decrease" ? TrendingDown : Minus;
  const good = direction === "no_change" ? null : (direction === "increase") === higherIsBetter;
  const tone = good === null ? "text-muted-foreground" : good ? "text-cc-green" : "text-cc-red";
  const sign = difference > 0 ? `+${difference}` : `${difference}`;
  const pctSign = percentChange != null ? (percentChange > 0 ? `+${percentChange}%` : `${percentChange}%`) : null;
  // In percentMode show the % change (fall back to absolute when previous is 0).
  const chipText = percentMode ? (pctSign ?? sign) : `${sign}${unit ?? ""}`;

  const tooltip = (
    <div className="space-y-1 text-start">
      <div className="font-semibold">{label}</div>
      <div className="text-muted-foreground">{t("tooltip.selectedPeriod")}: {fmtPeriod(periods.selected)}</div>
      <div className="text-muted-foreground">{t("tooltip.previousPeriod")}: {fmtPeriod(periods.previous)}</div>
      {available ? (
        <>
          <div>{t("tooltip.current")}: {trend.current}{unit}</div>
          <div>{t("tooltip.previous")}: {trend.previous}{unit}</div>
          <div>
            {t("tooltip.difference")}: {sign}{unit}
            {percentMode && pctSign ? ` (${pctSign})` : ""}
          </div>
          <div>{t("tooltip.direction")}: {t(`direction.${direction}`)}</div>
        </>
      ) : (
        <div className="text-amber">{t("tooltip.trendPending")}</div>
      )}
      <div className="pt-1 text-[10px] text-muted-foreground/70">{t("tooltip.note")}</div>
    </div>
  );

  return (
    <div className="inline-flex items-center gap-1">
      <span className={cn("inline-flex items-center gap-1 rounded-full bg-soft-1 px-1.5 py-0.5 text-[11px] font-medium", tone)}>
        <Icon className="size-3" />
        {available ? chipText : "—"}
      </span>
      <MetricInfo text={tooltip} />
    </div>
  );
}

function StatCard({
  label,
  icon: Icon,
  value,
  unit,
  sub,
  accent,
  href,
  trend,
  higherIsBetter,
  periods,
  t,
  percentMode,
}: {
  label: string;
  icon: LucideIcon;
  value: number | null;
  unit?: string;
  sub?: string;
  accent: "danger" | "warning" | "ok" | "neutral";
  href: string;
  trend: KpiTrend;
  higherIsBetter: boolean;
  periods: { selected: Period; previous: Period };
  t: T;
  percentMode?: boolean;
}) {
  const valueTone =
    accent === "danger" ? "text-cc-red" : accent === "warning" ? "text-amber" : accent === "ok" ? "text-cc-green" : "text-foreground";
  const iconTone =
    accent === "danger" ? "text-cc-red bg-red-dim" : accent === "warning" ? "text-amber bg-amber-dim" : accent === "ok" ? "text-cc-green bg-cc-green/10" : "text-muted-foreground bg-soft-2";
  const borderTone =
    accent === "danger" ? "border-cc-red/25" : accent === "warning" ? "border-amber/25" : accent === "ok" ? "border-cc-green/25" : "border-cyan/15";

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex h-full min-h-[150px] flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-card/50 p-4 transition-all hover:border-cyan/40 hover:shadow-[0_0_30px_rgba(0,212,255,0.06)]",
        borderTone,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", iconTone)}>
          <Icon className="size-4" />
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className={cn("text-[2.5rem] font-bold leading-none tabular-nums", valueTone)}>
          {value === null ? "—" : value}
        </span>
        {value !== null && unit ? <span className={cn("text-xl font-semibold", valueTone)}>{unit}</span> : null}
      </div>
      {sub ? <p className="mt-1.5 text-[11px] text-muted-foreground/80">{sub}</p> : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <TrendChip trend={trend} higherIsBetter={higherIsBetter} unit={unit} label={label} periods={periods} t={t} percentMode={percentMode} />
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">{t("liveLabel")}</span>
      </div>
    </Link>
  );
}

const REVIEW_HREF = `/tasks?view=list&sf=${encodeURIComponent(
  JSON.stringify([
    { field: "stage", value: "specialist_review" },
    { field: "stage", value: "manager_review" },
  ]),
)}`;

function ReviewStatCard({
  count,
  oldestDays,
  avgDwellDays,
  t,
}: {
  count: number;
  oldestDays: number | null;
  avgDwellDays: number | null;
  t: T;
}) {
  const tw = t;
  const valueTone = count > 30 ? "text-cc-red" : count > 0 ? "text-amber" : "text-foreground";
  const borderTone = count > 30 ? "border-cc-red/25" : count > 0 ? "border-amber/25" : "border-cyan/15";
  const iconTone = count > 30 ? "text-cc-red bg-red-dim" : count > 0 ? "text-amber bg-amber-dim" : "text-muted-foreground bg-soft-2";
  const days = (n: number | null) => (n === null ? "—" : tw("review.daysValue", { n }));

  return (
    <Link
      href={REVIEW_HREF}
      className={cn(
        "group relative flex h-full min-h-[150px] flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-card/50 p-4 transition-all hover:border-cyan/40 hover:shadow-[0_0_30px_rgba(0,212,255,0.06)]",
        borderTone,
      )}
    >
      <span className="absolute end-3 bottom-3 z-10">
        <MetricInfo text={tw("review.tooltip")} />
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {tw("review.label")}
        </div>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", iconTone)}>
          <Hourglass className="size-4" />
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className={cn("text-[2.5rem] font-bold leading-none tabular-nums", valueTone)}>
          {count}
        </span>
      </div>
      <p className="mt-auto pe-6 pt-3 text-[11px] text-muted-foreground/80">
        {tw("review.sub", { oldest: days(oldestDays), avg: days(avgDwellDays) })}
      </p>
    </Link>
  );
}

export async function ExecutiveIndicatorsRow({
  data,
  review,
}: {
  data: ExecutiveIndicators;
  review: { count: number; oldestDays: number | null; avgDwellDays: number | null };
}) {
  const t = await getTranslations("Executive.indicators");
  const { projectsAtRisk: risk, highRisk, onTime, overdue, clientChanges: cc, periods } = data;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t("sectionTitle")}</h2>
        <span className="text-[10px] text-muted-foreground/60">{t("subtitle")}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t("projectsAtRisk.label")}
          icon={AlertTriangle}
          value={risk.mainValue}
          sub={t("projectsAtRisk.minHint")}
          accent={risk.mainValue === null ? "neutral" : risk.mainValue > 0 ? "warning" : "ok"}
          href="/projects?atRisk=1"
          trend={risk.trend}
          higherIsBetter={false}
          periods={periods}
          t={t}
        />
        <StatCard
          label={t("highRisk.label")}
          icon={AlertOctagon}
          value={highRisk.mainValue}
          sub={t("highRisk.thresholdHint", { threshold: highRisk.threshold })}
          accent={highRisk.mainValue === null ? "neutral" : highRisk.mainValue > 0 ? "danger" : "ok"}
          href={`/projects?atRisk=1&min=${highRisk.threshold}`}
          trend={highRisk.trend}
          higherIsBetter={false}
          periods={periods}
          t={t}
        />
        <StatCard
          label={t("overdue.label")}
          icon={Clock}
          value={overdue.mainValue}
          sub={t("overdue.sub")}
          accent={overdue.mainValue === null ? "neutral" : overdue.mainValue > 50 ? "danger" : overdue.mainValue > 0 ? "warning" : "ok"}
          href="/tasks?f=overdue"
          trend={overdue.trend}
          higherIsBetter={false}
          periods={periods}
          t={t}
        />
        <StatCard
          label={t("onTime.label")}
          icon={Timer}
          value={onTime.onTimePct}
          unit="%"
          sub={t("onTime.sub", { completed: onTime.completedCount, today: onTime.mainValue ?? 0 })}
          accent={onTime.onTimePct === null ? "neutral" : onTime.onTimePct >= 85 ? "ok" : onTime.onTimePct >= 70 ? "warning" : "danger"}
          href="/reports"
          trend={onTime.trend}
          higherIsBetter
          periods={periods}
          t={t}
        />
        <StatCard
          label={t("clientChanges.label")}
          icon={RefreshCcw}
          value={cc.mainValue}
          sub={t("clientChanges.sub")}
          accent={cc.mainValue === null ? "neutral" : cc.mainValue > 40 ? "danger" : cc.mainValue > 0 ? "warning" : "ok"}
          href="/tasks?stage=client_changes"
          trend={cc.trend}
          higherIsBetter={false}
          periods={periods}
          t={t}
          percentMode
        />
        <ReviewStatCard
          count={review.count}
          oldestDays={review.oldestDays}
          avgDwellDays={review.avgDwellDays}
          t={t}
        />
      </div>
    </section>
  );
}
