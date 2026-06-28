import { AlertTriangle, Timer, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { HeroKpis, OnTimeTrendPoint } from "@/lib/data/executive";
import { Sparkline } from "./sparkline";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";

// Hero strip: ONE big metric (on-time %) + three secondary stats.
// Skill rule: 主役を1つ決めろ — on-time % is the single number a service
// agency CEO judges the operation by. Everything else is supporting.

function toneByOnTime(pct: number | null) {
  if (pct === null) return { value: "text-muted-foreground", border: "border-cyan/25", sparkClass: "text-muted-foreground" };
  if (pct >= 85) return { value: "text-cc-green", border: "border-cc-green/35", sparkClass: "text-cc-green" };
  if (pct >= 70) return { value: "text-amber", border: "border-amber/35", sparkClass: "text-amber" };
  return { value: "text-cc-red", border: "border-cc-red/35", sparkClass: "text-cc-red" };
}

function delta(current: number, weekAgo: number, lowerIsBetter = true) {
  const diff = current - weekAgo;
  if (diff === 0) return { sign: "0", DirIcon: Minus, tone: "text-muted-foreground" };
  const isUp = diff > 0;
  const tone = lowerIsBetter
    ? isUp ? "text-cc-red" : "text-cc-green"
    : isUp ? "text-cc-green" : "text-cc-red";
  return {
    sign: isUp ? `+${diff}` : `${diff}`,
    DirIcon: isUp ? TrendingUp : TrendingDown,
    tone,
  };
}

// Compute a sparkline mini-series from current+previous totals — keeps API
// flexible if/when we later feed a true daily series for the secondary cards.
function fakeSparkFromTrend(): number[] {
  return [];
}

export async function ExecutiveHeroRow({
  data,
  trend,
}: {
  data: HeroKpis;
  trend: OnTimeTrendPoint[];
}) {
  const t = await getTranslations("Executive.hero");
  const tone = toneByOnTime(data.onTime.pct);
  const overdueDelta = delta(data.overdue.current, data.overdue.weekAgo, true);
  const sparkData = trend.map((p) => p.pct);
  // For 7-day sample sparklines we don't have a series yet — show only the
  // big-3 stats with delta chips, no spark, to avoid faking data.

  return (
    <section className="mb-8 grid items-stretch gap-3 lg:grid-cols-[1.7fr_1fr]">
      {/* HERO */}
      <div className="relative h-full">
        <span className="absolute end-10 top-5 z-10">
          <MetricInfo text={t("metricTooltips.dashboard_heroOnTime")} />
        </span>
        <Link
          href="/reports"
          className={cn(
            "group relative flex h-full min-h-[180px] flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-card/40 p-6 transition-all",
            "hover:shadow-[0_0_40px_rgba(0,212,255,0.08)]",
            tone.border,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {t("onTimeLabel")}
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {t("onTimeRange")}
              </p>
            </div>
            <Timer className="size-4 text-cyan" />
          </div>

          <div className="mt-5 flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-1">
              <span className={cn("text-7xl font-bold tabular-nums leading-none", tone.value)}>
                {data.onTime.pct === null ? "—" : data.onTime.pct}
              </span>
              {data.onTime.pct !== null && (
                <span className={cn("text-3xl font-semibold", tone.value)}>%</span>
              )}
            </div>
            <div className={cn("w-32 shrink-0 opacity-90", tone.sparkClass)}>
              <Sparkline data={sparkData} width={128} height={44} reference={85} fill="currentColor" stroke="currentColor" />
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-[11px] text-muted-foreground">
            <span>
              {data.onTime.sample > 0
                ? t("onTimeSample", { sample: data.onTime.sample })
                : t("onTimeNoSample")}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider opacity-70">
              {t("benchmark")}
            </span>
          </div>
        </Link>
      </div>

      {/* Secondary */}
      {/* Stuck-in-review + client-changes moved up to the workflow indicators
          (team feedback 2026-06-28) — they're now full index cards with sub-
          metrics + correct filtered drills, so they're removed from the hero. */}
      <SecondaryCard
        label={t("overdueLabel")}
        value={data.overdue.current}
        icon={<AlertTriangle className="size-4" />}
        href="/tasks?f=overdue"
        accent={data.overdue.current > 50 ? "danger" : data.overdue.current > 0 ? "warning" : "neutral"}
        deltaInfo={overdueDelta}
        sparkData={fakeSparkFromTrend()}
        tip={t("metricTooltips.dashboard_heroOverdue")}
      />
    </section>
  );
}

function SecondaryCard({
  label,
  value,
  icon,
  href,
  accent,
  deltaInfo,
  hint,
  sparkData,
  tip,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  href: string;
  accent: "neutral" | "warning" | "danger";
  deltaInfo?: { sign: string; DirIcon: React.ElementType; tone: string };
  hint?: string;
  sparkData: number[];
  tip?: React.ReactNode;
}) {
  const valueTone =
    accent === "danger"
      ? "text-cc-red"
      : accent === "warning"
        ? "text-amber"
        : "text-foreground";
  const iconTone =
    accent === "danger"
      ? "text-cc-red bg-red-dim"
      : accent === "warning"
        ? "text-amber bg-amber-dim"
        : "text-muted-foreground bg-soft-2";
  const borderTone =
    accent === "danger"
      ? "border-cc-red/25"
      : accent === "warning"
        ? "border-amber/25"
        : "border-cyan/15";

  return (
    <div className="relative h-full">
      {tip ? (
        <span className="absolute end-12 top-4 z-10">
          <MetricInfo text={tip} />
        </span>
      ) : null}
      <Link
        href={href}
        className={cn(
          "group relative flex h-full min-h-[180px] flex-col overflow-hidden rounded-2xl border bg-card p-4 transition-all hover:border-cyan/35",
          borderTone,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </div>
          <span className={cn("flex size-8 items-center justify-center rounded-lg", iconTone)}>
            {icon}
          </span>
        </div>

        <div className={cn("mt-4 text-4xl font-bold tabular-nums leading-none", valueTone)}>
          {value}
        </div>

        <div className="mt-auto flex min-h-6 items-end justify-between gap-2 pt-4 text-[11px]">
          {deltaInfo ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full bg-soft-1 px-1.5 py-0.5 font-medium", deltaInfo.tone)}>
              <deltaInfo.DirIcon className="size-3" />
              {deltaInfo.sign}
            </span>
          ) : (
            <span className="text-muted-foreground">{hint}</span>
          )}
          {sparkData.length > 0 && (
            <div className={cn("w-16 opacity-70", valueTone)}>
              <Sparkline data={sparkData} width={64} height={20} stroke="currentColor" />
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}
