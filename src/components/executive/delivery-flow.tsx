import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { FunnelStageRow } from "@/lib/data/executive";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

// Build a URL that shows overdue tasks in a specific stage.
function overdueStageHref(stage: TaskStage): string {
  const sf = JSON.stringify([{ field: "stage", value: stage }]);
  return `/tasks?f=overdue&sf=${encodeURIComponent(sf)}`;
}

// Stages excluded from this view (new = not started, done = finished).
const EXCLUDE = new Set<TaskStage>(["new", "done"]);

const STAGE_TONE: Partial<Record<TaskStage, { bar: string; badge: string }>> = {
  manager_review:    { bar: "bg-cc-purple",  badge: "bg-cc-purple/10 text-cc-purple" },
  specialist_review: { bar: "bg-cc-purple",  badge: "bg-cc-purple/10 text-cc-purple" },
  client_changes:    { bar: "bg-amber",      badge: "bg-amber-dim text-amber" },
  sent_to_client:    { bar: "bg-amber",      badge: "bg-amber-dim text-amber" },
  in_progress:       { bar: "bg-cyan",       badge: "bg-cyan-dim text-cyan" },
  ready_to_send:     { bar: "bg-cyan",       badge: "bg-cyan-dim text-cyan" },
};

export async function DeliveryFlowSection({
  funnel,
  bottlenecks: _bottlenecks,
}: {
  funnel: FunnelStageRow[];
  bottlenecks: unknown[];
}) {
  const t = await getTranslations("Executive.flow");

  // Only stages with at least one overdue task, sorted desc.
  const rows = funnel
    .filter((r) => !EXCLUDE.has(r.stage) && r.overdueCount > 0)
    .sort((a, b) => b.overdueCount - a.overdueCount);

  const maxOverdue = rows[0]?.overdueCount ?? 1;
  const worst = rows[0];

  return (
    <section className="mb-10">
      <SectionTitle title={t("title")} description={t("overdueDesc")} />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-cc-green/25 bg-cc-green/[0.04] px-5 py-8 text-center text-sm text-cc-green">
          {t("noOverdue")}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Worst-stage hero */}
          {worst && (
            <Link
              href={overdueStageHref(worst.stage)}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-cc-red/25 bg-cc-red/[0.04] px-5 py-4 transition-colors hover:bg-cc-red/[0.07]"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-cc-red">
                  {t("worstStageLabel")}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-2xl font-bold tabular-nums text-cc-red">
                    {worst.overdueCount}
                  </span>{" "}
                  <span className="font-semibold">{TASK_STAGE_LABELS[worst.stage]}</span>
                  {worst.openCount > worst.overdueCount && (
                    <span className="text-muted-foreground">
                      {" "}· {t("ofTotal", { total: worst.openCount })}
                    </span>
                  )}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-cyan group-hover:underline">
                {t("openStage")} ←
              </span>
            </Link>
          )}

          {/* Ranked list of all stages with overdue tasks */}
          <div className="rounded-2xl border border-soft bg-card">
            {rows.map((row, i) => {
              const tone = STAGE_TONE[row.stage] ?? { bar: "bg-muted-foreground/40", badge: "bg-soft-2 text-muted-foreground" };
              const barPct = Math.max(4, (row.overdueCount / maxOverdue) * 100);
              const overduePct = row.openCount > 0
                ? Math.round((row.overdueCount / row.openCount) * 100)
                : 0;

              return (
                <Link
                  key={row.stage}
                  href={overdueStageHref(row.stage)}
                  className={cn(
                    "group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-soft-1",
                    i > 0 && "border-t border-soft/60",
                  )}
                >
                  {/* Rank */}
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-soft-2 text-[10px] font-bold text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>

                  {/* Stage name + bar */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold", tone.badge)}>
                        {TASK_STAGE_LABELS[row.stage]}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {overduePct}% {t("ofStage")}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soft-2">
                      <div
                        className={cn("h-full rounded-full transition-all", tone.bar)}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Overdue count */}
                  <span className="shrink-0 text-xl font-bold tabular-nums text-cc-red">
                    {row.overdueCount}
                  </span>

                  <span className="shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground">
                    ←
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
