import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CornerDownLeft, ArrowRight, ChevronLeft } from "lucide-react";
import type { StageFlowCell } from "@/lib/data/executive";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { WindowLabel } from "./window-label";
import { cn } from "@/lib/utils";

// Build a /tasks URL that lands on EXACTLY the tasks that made this backward
// from→to transition within the dashboard window — not every task currently in
// the destination stage. The page resolves `flow` + `fw` against
// task_stage_history (see _flow_filter.ts); `f=all` so the default open-stage
// filter doesn't drop a regressed task that has since moved to done.
function regressionHref(
  fromStage: TaskStage,
  toStage: TaskStage,
  win?: { from: string; to: string },
): string {
  const params = new URLSearchParams({ f: "all", flow: `${fromStage}~${toStage}` });
  if (win) params.set("fw", `${win.from}~${win.to}`);
  return `/tasks?${params.toString()}`;
}

export async function StageFlowMatrixSection({
  topBackward,
  totalForward,
  totalBackward,
  windowLabel,
  windowRange,
}: {
  cells: StageFlowCell[];
  topBackward: Array<{ from: TaskStage; to: TaskStage; count: number }>;
  totalForward: number;
  totalBackward: number;
  windowLabel?: string;
  // Dashboard range (ISO dates) so the drill-down matches the counted window.
  windowRange?: { from: string; to: string };
}) {
  const t = await getTranslations("Executive.stageFlow");
  const total = totalForward + totalBackward;
  const backwardPct = total > 0 ? Math.round((totalBackward / total) * 100) : 0;

  return (
    <section className="mb-10">
      <SectionTitle
        title={t("title")}
        description={t("description", { backwardPct })}
        actions={windowLabel ? <WindowLabel label={windowLabel} /> : undefined}
      />
      <Card className="border-cc-red/15">
        <CardContent className="p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-cc-red">
            <CornerDownLeft className="size-3.5 rtl:rotate-180" />
            {t("topBackwardTitle")}
          </div>
          {topBackward.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">{t("topBackwardEmpty")}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {topBackward.map((b, i) => (
                <li key={`${b.from}>${b.to}`}>
                  <Link
                    href={regressionHref(b.from, b.to, windowRange)}
                    className={cn(
                      "flex aspect-square min-h-16 flex-col justify-between rounded-lg border p-2 transition-colors hover:bg-soft-1",
                      i === 0 ? "border-cc-red/30 bg-cc-red/[0.04]" : "border-cc-red/15",
                    )}
                  >
                    <div className="min-w-0 space-y-0.5 text-[9px] leading-tight">
                      <span className="block truncate text-muted-foreground">{TASK_STAGE_LABELS[b.from]}</span>
                      <ArrowRight className="size-3 text-cc-red/70 rtl:rotate-180" />
                      <span className="block truncate font-medium">{TASK_STAGE_LABELS[b.to]}</span>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <span className="text-base font-bold tabular-nums text-cc-red">
                        {b.count}
                      </span>
                      <ChevronLeft className="size-3.5 text-muted-foreground/50 ltr:rotate-180" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
