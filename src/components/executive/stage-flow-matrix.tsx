import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CornerDownLeft, ArrowRight, ChevronLeft } from "lucide-react";
import type { StageFlowCell } from "@/lib/data/executive";
import { FUNNEL_STAGE_ORDER } from "@/lib/data/executive";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { WindowLabel } from "./window-label";
import { cn } from "@/lib/utils";

// Build a /tasks URL pre-filtered to the "to" stage so the CEO can drill into
// exactly which tasks regressed into that stage.
function regressionHref(toStage: TaskStage): string {
  const sf = JSON.stringify([{ field: "stage", value: toStage }]);
  return `/tasks?sf=${encodeURIComponent(sf)}`;
}

export async function StageFlowMatrixSection({
  cells: _cells,
  topBackward,
  totalForward,
  totalBackward,
  windowLabel,
}: {
  cells: StageFlowCell[];
  topBackward: Array<{ from: TaskStage; to: TaskStage; count: number }>;
  totalForward: number;
  totalBackward: number;
  windowLabel?: string;
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
            <ul className="space-y-1.5">
              {topBackward.map((b, i) => (
                <li key={`${b.from}>${b.to}`}>
                  <Link
                    href={regressionHref(b.to)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-soft-1",
                      i === 0 ? "border-cc-red/30 bg-cc-red/[0.04]" : "border-cc-red/15",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                      <span className="truncate">{TASK_STAGE_LABELS[b.from]}</span>
                      <ArrowRight className="size-3 shrink-0 text-cc-red/70 rtl:rotate-180" />
                      <span className="truncate font-medium">{TASK_STAGE_LABELS[b.to]}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-bold tabular-nums text-cc-red">
                        {b.count}
                      </span>
                      <ChevronLeft className="size-3.5 text-muted-foreground/50 ltr:rotate-180" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">{t("caption")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
