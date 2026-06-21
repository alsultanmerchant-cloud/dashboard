import { getTranslations } from "next-intl/server";
import { ArrowUp, ArrowDown, Minus, Gauge, Clock, RotateCcw, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";
import { getAgentGrowth, type MetricTrend } from "@/lib/data/agent-growth";
import { getAgentAiCache } from "@/lib/data/agent-ai-cache";
import type { GrowthCoachAi } from "@/lib/growth-coach/schema";
import { GrowthCoachCard } from "@/components/cockpit/growth-coach-card";

type GrowthT = Awaited<ReturnType<typeof getTranslations<"AgentCockpit">>>;

function fmt(value: number | null, unit: "pct" | "hours" | "count"): string {
  if (value === null) return "—";
  if (unit === "pct") return `${Math.round(value)}%`;
  if (unit === "hours") return `${value}${"h"}`;
  return `${value}`;
}

function deltaLabel(m: MetricTrend, unit: "pct" | "hours" | "count"): string {
  if (m.delta === null) return "";
  const sign = m.delta > 0 ? "+" : "";
  const suffix = unit === "pct" ? "%" : unit === "hours" ? "h" : "";
  return `${sign}${m.delta}${suffix}`;
}

// A single self-trend tile: big current value + an arrow vs the prior 30 days.
// Arrow direction follows the raw change; its COLOR follows `improved`
// (green = better given the metric's polarity, red = worse), so a faster
// turnaround (a down arrow) still reads green.
function TrendTile({
  icon: Icon,
  label,
  tip,
  m,
  unit,
  sampleKind,
  caption,
  t,
}: {
  icon: typeof Gauge;
  label: string;
  tip: string;
  m: MetricTrend;
  unit: "pct" | "hours" | "count";
  sampleKind: "checks" | "intervals";
  caption?: string;
  t: GrowthT;
}) {
  const Arrow = m.delta === null || m.delta === 0 ? Minus : m.delta > 0 ? ArrowUp : ArrowDown;
  const tone =
    m.improved === null
      ? "text-muted-foreground"
      : m.improved
        ? "text-cc-green"
        : "text-cc-red";
  const thin = m.sampleSize < 5;
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
          <MetricInfo text={tip} />
        </span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-soft-1 text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
          {fmt(m.value, unit)}
        </span>
        {caption && <span className="text-[10px] text-muted-foreground">{caption}</span>}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px]">
        {m.noBaseline || m.value === null ? (
          <span className="text-muted-foreground">{t("growth.noBaseline")}</span>
        ) : (
          <>
            <Arrow className={cn("size-3", tone)} />
            <span className={cn("tabular-nums font-medium", tone)}>{deltaLabel(m, unit)}</span>
            <span className="text-muted-foreground">{t("growth.vsLastMonth")}</span>
          </>
        )}
      </div>
      {/* Sample size so trust is self-evident — flagged when thin (<5). */}
      <div className={cn("mt-1 text-[10px]", thin ? "text-amber" : "text-muted-foreground")}>
        {t(`growth.basedOn.${sampleKind}`, { count: m.sampleSize })}
      </div>
    </div>
  );
}

export async function GrowthSection({
  orgId,
  employeeId,
}: {
  orgId: string;
  employeeId: string;
}) {
  const [g, cached, t] = await Promise.all([
    getAgentGrowth(orgId, employeeId),
    getAgentAiCache<GrowthCoachAi>(orgId, employeeId, "growth_coach"),
    getTranslations("AgentCockpit"),
  ]);

  // Gate the headline: when even the well-sampled signals are thin, don't show
  // a confident number — show it muted as "building" with the open-board size.
  const gated = g.score === null || g.scoreConfidence === "low";
  const scoreTone = gated
    ? "text-muted-foreground"
    : g.score! >= 70
      ? "text-cc-green"
      : g.score! >= 50
        ? "text-amber"
        : "text-cc-red";

  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_1.4fr]">
      {/* Scorecard */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">{t("growth.scorecardTitle")}</span>
            {g.scoreConfidence === "low" && (
              <span className="rounded-full bg-soft-1 px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("growth.building")}
              </span>
            )}
          </div>

          {/* Hero score */}
          <div className="mb-4 flex items-end justify-between gap-3 rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 p-4">
            <div>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t("growth.score")}
                <MetricInfo text={t("growth.tips.score")} />
              </span>
              {gated ? (
                <div className="mt-2">
                  <div className="text-3xl font-bold leading-none text-muted-foreground">—</div>
                  <p className="mt-1.5 max-w-[16rem] text-[11px] leading-relaxed text-muted-foreground">
                    {t("growth.notEnoughData")}
                  </p>
                </div>
              ) : (
                <div className={cn("mt-2 text-5xl font-bold leading-none tabular-nums", scoreTone)}>
                  {g.score}
                  <span className="text-2xl text-muted-foreground">/100</span>
                </div>
              )}
            </div>
            <span className="flex size-10 items-center justify-center rounded-xl bg-soft-1 text-muted-foreground">
              <Gauge className="size-5" />
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrendTile icon={Clock} label={t("growth.slaOnTime")} tip={t("growth.tips.slaOnTime")} m={g.onTimeRate} unit="pct" sampleKind="checks" t={t} />
            <TrendTile icon={Timer} label={t("growth.turnaround")} tip={t("growth.tips.turnaround")} m={g.avgTurnaroundHours} unit="hours" sampleKind="intervals" caption={t("growth.businessHours")} t={t} />
            <TrendTile icon={RotateCcw} label={t("growth.rework")} tip={t("growth.tips.rework")} m={g.reworkReturns} unit="count" sampleKind="intervals" t={t} />
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            {t("growth.privacyNote")}
          </p>
        </CardContent>
      </Card>

      {/* AI coach */}
      <GrowthCoachCard
        specialization={g.specialization}
        initial={cached?.payload ?? null}
        generatedAt={cached?.generatedAt ?? null}
      />
    </div>
  );
}
