import { getTranslations } from "next-intl/server";
import { Truck, ArrowUp, ArrowDown, Minus, AlertTriangle, Clock, FolderKanban, Ban, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";
import { getDeliveryCommitment } from "@/lib/data/performance/delivery-commitment";

type PerfT = Awaited<ReturnType<typeof getTranslations<"MyPerformance">>>;

// A raw stat tile: big value + caption + optional tone for danger counts.
function StatTile({
  icon: Icon,
  label,
  tip,
  value,
  caption,
  tone,
  derived,
  derivedLabel,
}: {
  icon: typeof Clock;
  label: string;
  tip: string;
  value: string | number;
  caption?: string;
  tone?: "danger" | "warn" | "neutral";
  derived?: boolean;
  derivedLabel?: string;
}) {
  const valTone =
    tone === "danger"
      ? "text-cc-red"
      : tone === "warn"
        ? "text-amber"
        : "text-foreground";
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
        <span className={cn("text-3xl font-bold leading-none tabular-nums", valTone)}>{value}</span>
        {caption && <span className="text-[10px] text-muted-foreground">{caption}</span>}
      </div>
      {derived && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-soft-1 px-1.5 py-0.5 text-[9px] text-muted-foreground">
          <Ban className="size-2.5" /> {derivedLabel}
        </div>
      )}
    </div>
  );
}

export async function DeliveryCommitmentCard({
  orgId,
  employeeId,
}: {
  orgId: string;
  employeeId: string;
}) {
  const [d, t] = await Promise.all([
    getDeliveryCommitment(orgId, employeeId),
    getTranslations("MyPerformance"),
  ]);

  const gated = d.score === null || d.scoreConfidence === "low";
  const scoreTone = gated
    ? "text-muted-foreground"
    : d.score! >= 75
      ? "text-cc-green"
      : d.score! >= 55
        ? "text-amber"
        : "text-cc-red";

  // On-time trend arrow (higher is better).
  const ot = d.onTime;
  const Arrow = ot.delta === null || ot.delta === 0 ? Minus : ot.delta > 0 ? ArrowUp : ArrowDown;
  const otTone =
    ot.improved === null ? "text-muted-foreground" : ot.improved ? "text-cc-green" : "text-cc-red";
  const thinOnTime = ot.decidable < 5;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-cyan-dim text-cyan">
              <Truck className="size-3.5" />
            </span>
            {t("delivery.title")}
          </span>
          {d.scoreConfidence === "low" && (
            <span className="rounded-full bg-soft-1 px-2 py-0.5 text-[10px] text-muted-foreground">
              {t("delivery.building")}
            </span>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.9fr_2fr]">
          {/* Hero score */}
          <div className="flex items-end justify-between gap-3 rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 p-4">
            <div>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t("delivery.score")}
                <MetricInfo text={t("delivery.tips.score")} />
              </span>
              {gated ? (
                <div className="mt-2">
                  <div className="text-3xl font-bold leading-none text-muted-foreground">—</div>
                  <p className="mt-1.5 max-w-[15rem] text-[11px] leading-relaxed text-muted-foreground">
                    {t("delivery.notEnoughData")}
                  </p>
                </div>
              ) : (
                <div className={cn("mt-2 text-5xl font-bold leading-none tabular-nums", scoreTone)}>
                  {d.score}
                  <span className="text-2xl text-muted-foreground">/100</span>
                </div>
              )}
            </div>
            <span className="flex size-10 items-center justify-center rounded-xl bg-soft-1 text-muted-foreground">
              <Truck className="size-5" />
            </span>
          </div>

          {/* Sub-metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {/* On-time delivered */}
            <div className="rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {t("delivery.onTime")}
                  <MetricInfo text={t("delivery.tips.onTime")} />
                </span>
                <span className="flex size-8 items-center justify-center rounded-lg bg-soft-1 text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                </span>
              </div>
              <div className="mt-3 text-3xl font-bold leading-none tabular-nums text-foreground">
                {ot.pct === null ? "—" : `${ot.pct}%`}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px]">
                {ot.pct === null ? (
                  <span className="text-muted-foreground">{t("delivery.noDeadlines")}</span>
                ) : ot.noBaseline ? (
                  <span className="text-muted-foreground">{t("delivery.noBaseline")}</span>
                ) : (
                  <>
                    <Arrow className={cn("size-3", otTone)} />
                    <span className={cn("font-medium tabular-nums", otTone)}>
                      {ot.delta! > 0 ? "+" : ""}
                      {ot.delta}%
                    </span>
                    <span className="text-muted-foreground">{t("delivery.vsLastMonth")}</span>
                  </>
                )}
              </div>
              {ot.decidable > 0 && (
                <div className={cn("mt-1 text-[10px]", thinOnTime ? "text-amber" : "text-muted-foreground")}>
                  {t("delivery.ofDeliveries", { onTime: ot.onTime, total: ot.decidable })}
                </div>
              )}
            </div>

            <StatTile
              icon={AlertTriangle}
              label={t("delivery.overdue")}
              tip={t("delivery.tips.overdue")}
              value={d.overdueTasks}
              caption={t("delivery.ofOpen", { count: d.openTasks })}
              tone={d.overdueTasks > 0 ? "danger" : "neutral"}
            />
            <StatTile
              icon={Clock}
              label={t("delivery.avgLateness")}
              tip={t("delivery.tips.avgLateness")}
              value={d.avgLatenessDays === null ? "—" : d.avgLatenessDays}
              caption={d.avgLatenessDays === null ? undefined : t("delivery.days")}
              tone={d.avgLatenessDays && d.avgLatenessDays > 3 ? "warn" : "neutral"}
            />
            <StatTile
              icon={FolderKanban}
              label={t("delivery.lateProjects")}
              tip={t("delivery.tips.lateProjects")}
              value={d.lateProjects}
              tone={d.lateProjects > 0 ? "warn" : "neutral"}
            />
            <StatTile
              icon={Ban}
              label={t("delivery.blocked")}
              tip={t("delivery.tips.blocked")}
              value={d.blockedTasks}
              tone={d.blockedTasks > 0 ? "warn" : "neutral"}
              derived
              derivedLabel={t("delivery.derived")}
            />
          </div>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          {t("delivery.note")}
        </p>
      </CardContent>
    </Card>
  );
}
