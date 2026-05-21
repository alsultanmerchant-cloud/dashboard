import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Hourglass } from "lucide-react";
import type { FunnelStageRow, BottleneckRow } from "@/lib/data/executive";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { EmptyState } from "@/components/empty-state";
import { relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

// Stage funnel: 8 horizontal bars. Bar width = count share. Side label = avg dwell.
// Skill rule: 70点を並べるな — make the biggest stage dominate visually.

function StageBar({
  row,
  maxCount,
}: {
  row: FunnelStageRow;
  maxCount: number;
}) {
  const widthPct = maxCount > 0 ? Math.max(2, (row.openCount / maxCount) * 100) : 0;
  const isReview = row.stage === "manager_review" || row.stage === "specialist_review";
  const isStuck = row.stage === "sent_to_client" || row.stage === "client_changes";
  const tone = row.stage === "done"
    ? "bg-cc-green/45"
    : isStuck
      ? "bg-amber/55"
      : isReview
        ? "bg-cc-purple/55"
        : "bg-cyan/45";

  return (
    <Link
      href={`/tasks?stage=${row.stage}`}
      className="group block px-3 py-2 transition-colors hover:bg-soft-1 rounded-lg"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs font-medium">{TASK_STAGE_LABELS[row.stage]}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {row.avgDwellHours > 0 ? `${row.avgDwellHours.toFixed(1)}h dwell` : "—"}
        </span>
      </div>
      <div className="relative h-7 rounded-md bg-soft-2 overflow-hidden">
        <div
          className={cn("absolute inset-y-0 right-0 transition-all", tone)}
          style={{ width: `${widthPct}%` }}
        />
        <div className="relative flex h-full items-center justify-end px-2.5 text-xs font-bold tabular-nums">
          {row.openCount}
        </div>
      </div>
    </Link>
  );
}

export async function DeliveryFlowSection({
  funnel,
  bottlenecks,
}: {
  funnel: FunnelStageRow[];
  bottlenecks: BottleneckRow[];
}) {
  const t = await getTranslations("Executive.flow");
  const maxCount = Math.max(...funnel.map((s) => s.openCount), 1);

  // Identify the worst non-done stage by pressure score (count × dwell-hours).
  // This is the bar that should grab attention — it's where the agency is
  // actually losing time.
  const worst = funnel
    .filter((s) => s.stage !== "done" && s.openCount > 0)
    .map((s) => ({ ...s, pressure: s.openCount * Math.max(s.avgDwellHours, 1) }))
    .sort((a, b) => b.pressure - a.pressure)[0];

  return (
    <section className="mb-10">
      <SectionTitle title={t("title")} description={t("description")} />

      {worst && (
        <Link
          href={`/tasks?stage=${worst.stage}`}
          className="group mb-3 block rounded-2xl border border-cc-red/25 bg-gradient-to-r from-cc-red/[0.06] to-transparent px-4 py-3 transition-colors hover:border-cc-red/45"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-cc-red">
                {t("worstStageLabel")}
              </p>
              <p className="mt-1 text-sm">
                <span className="text-xl font-bold tabular-nums text-cc-red">{worst.openCount}</span>{" "}
                <span className="font-semibold">{TASK_STAGE_LABELS[worst.stage]}</span>
                <span className="text-muted-foreground"> · {worst.avgDwellHours.toFixed(0)}h {t("avgDwell")}</span>
              </p>
            </div>
            <span className="text-[11px] text-cyan group-hover:underline">
              {t("openStage")} →
            </span>
          </div>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Funnel */}
        <Card>
          <CardContent className="p-3 space-y-1">
            {funnel.map((row) => (
              <StageBar key={row.stage} row={row} maxCount={maxCount} />
            ))}
          </CardContent>
        </Card>

        {/* Bottlenecks */}
        <Card className="border-amber/20">
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber">
              <Hourglass className="size-3.5" />
              {t("bottlenecksTitle")}
            </div>
            {bottlenecks.length === 0 ? (
              <EmptyState
                variant="compact"
                title={t("bottlenecksEmpty")}
                description=""
              />
            ) : (
              <ul className="space-y-1.5">
                {bottlenecks.map((b) => (
                  <li key={b.taskId}>
                    <Link
                      href={`/tasks/${b.taskId}`}
                      className="block rounded-lg border border-amber/15 bg-card px-3 py-2 transition-colors hover:border-amber/35"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium">{b.title}</span>
                        <span className="shrink-0 text-[11px] font-bold tabular-nums text-amber">
                          {b.businessHoursInStage}h
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
                        {b.projectName ?? "—"} · {TASK_STAGE_LABELS[b.stage as TaskStage] ?? b.stage} · {relativeTimeAr(b.enteredAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
