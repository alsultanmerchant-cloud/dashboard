import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CornerDownLeft, ArrowRight } from "lucide-react";
import type { StageFlowCell } from "@/lib/data/executive";
import { FUNNEL_STAGE_ORDER } from "@/lib/data/executive";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

// Compact 8×8 stage transition matrix. Rows = from, columns = to.
// Diagonal is masked. Backward cells use red intensity, forward cells use cyan.
// Intensity = log-scaled count (so a single hot cell doesn't wash out the rest).

function logIntensity(count: number, max: number): number {
  if (count === 0) return 0;
  const lc = Math.log(count + 1);
  const lm = Math.log(max + 1);
  return lm > 0 ? lc / lm : 0;
}

// Short stage labels for column headers (the 8 full names won't fit).
const STAGE_SHORT: Record<TaskStage, string> = {
  new: "جديد",
  in_progress: "تنفيذ",
  manager_review: "مدير",
  specialist_review: "أخصائي",
  ready_to_send: "جاهز",
  sent_to_client: "للعميل",
  client_changes: "تعديل",
  done: "تم",
};

export async function StageFlowMatrixSection({
  cells,
  topBackward,
  totalForward,
  totalBackward,
}: {
  cells: StageFlowCell[];
  topBackward: Array<{ from: TaskStage; to: TaskStage; count: number }>;
  totalForward: number;
  totalBackward: number;
}) {
  const t = await getTranslations("Executive.stageFlow");
  const max = Math.max(...cells.map((c) => c.count), 1);
  const total = totalForward + totalBackward;
  const backwardPct = total > 0 ? Math.round((totalBackward / total) * 100) : 0;

  // Index cells by from→to for grid lookup.
  const cellMap = new Map<string, StageFlowCell>();
  for (const c of cells) cellMap.set(`${c.from}>${c.to}`, c);

  return (
    <section className="mb-10">
      <SectionTitle
        title={t("title")}
        description={t("description", { backwardPct })}
      />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Matrix */}
        <Card>
          <CardContent className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-[10px]">
                <thead>
                  <tr>
                    <th className="text-start text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                      {t("fromHeader")}
                    </th>
                    {FUNNEL_STAGE_ORDER.map((to) => (
                      <th key={to} className="text-center text-[9px] font-medium text-muted-foreground">
                        {STAGE_SHORT[to]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FUNNEL_STAGE_ORDER.map((from) => (
                    <tr key={from}>
                      <td className="whitespace-nowrap pr-2 text-[10px] font-medium text-muted-foreground">
                        {STAGE_SHORT[from]}
                      </td>
                      {FUNNEL_STAGE_ORDER.map((to) => {
                        if (from === to) {
                          return (
                            <td key={to} className="size-8 rounded bg-soft-2/40" />
                          );
                        }
                        const cell = cellMap.get(`${from}>${to}`);
                        const count = cell?.count ?? 0;
                        const intensity = logIntensity(count, max);
                        const tone = cell?.isBackward ? "bg-cc-red" : "bg-cyan";
                        return (
                          <td
                            key={to}
                            className={cn(
                              "size-8 rounded text-center align-middle tabular-nums",
                              count > 0 ? "text-foreground font-semibold" : "text-muted-foreground/40",
                            )}
                            style={{
                              backgroundColor: count > 0 ? undefined : "var(--soft-2, rgba(120,120,140,0.08))",
                            }}
                          >
                            <div
                              className={cn(
                                "flex h-full w-full items-center justify-center rounded",
                                count > 0 && tone,
                              )}
                              style={{
                                opacity: count > 0 ? Math.max(0.15, intensity) : 1,
                              }}
                            >
                              <span style={{ opacity: count > 0 ? 1 / Math.max(0.4, intensity) : 1 }}>
                                {count > 0 ? count : ""}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end gap-4 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm bg-cyan" />
                {t("forward")} · {totalForward}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm bg-cc-red" />
                {t("backward")} · {totalBackward}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Top backward transitions */}
        <Card className="border-cc-red/15">
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cc-red">
              <CornerDownLeft className="size-3.5 rtl:rotate-180" />
              {t("topBackwardTitle")}
            </div>
            {topBackward.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t("topBackwardEmpty")}</p>
            ) : (
              <ul className="space-y-1.5">
                {topBackward.map((b, i) => (
                  <li
                    key={`${b.from}>${b.to}`}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border px-3 py-2",
                      i === 0 ? "border-cc-red/30 bg-cc-red/[0.04]" : "border-cc-red/15",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                      <span className="truncate">{TASK_STAGE_LABELS[b.from]}</span>
                      <ArrowRight className="size-3 shrink-0 text-cc-red/70 rtl:rotate-180" />
                      <span className="truncate font-medium">{TASK_STAGE_LABELS[b.to]}</span>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-cc-red">
                      {b.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[10px] text-muted-foreground">{t("caption")}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
