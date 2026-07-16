"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Eye, Loader2, RefreshCw } from "lucide-react";
import { MetricInfo } from "@/components/metric-info";
import type { AccountabilityEvidence } from "@/lib/data/accountability";

const NA = "—";

function formatMinutes(
  min: number | null,
  t: ReturnType<typeof useTranslations>,
): string {
  if (min == null) return NA;
  const m = Math.round(min);
  if (m < 60) return t("fmt.minutes", { n: m });
  const h = m / 60;
  if (h < 8) return t("fmt.hours", { n: Math.round(h * 10) / 10 });
  return t("fmt.workdays", { n: Math.round((h / 8) * 10) / 10 });
}

export function EmployeeEvidence({
  evidence,
  loading,
  error = null,
  onRetry,
}: {
  evidence: AccountabilityEvidence | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const t = useTranslations("AccountabilityPage");
  const tStages = useTranslations("TasksBoard.stages");
  // `done` is a terminal state, not an accountable work interval. The server
  // query excludes it too; this guard protects the UI from stale/cached data.
  const items = (evidence?.items ?? []).filter((item) => item.stage !== "done");

  const stageLabel = (stage: string) => {
    try {
      return tStages(stage);
    } catch {
      return stage;
    }
  };

  return (
    <section>
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold">
        <Eye className="size-4 text-cyan" />
        الأدلة
        <MetricInfo
          text={t("metricTooltips.accountability_evidenceDwell")}
          label={t("col.avgDwell")}
        />
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{t("evidence.hint")}</p>

      {loading ? (
        <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-soft-1/60 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-cyan" />
          جارٍ تحميل الأدلة…
        </div>
      ) : error ? (
        <div className="mt-2 flex flex-col items-center gap-2 rounded-lg border border-cc-red/20 bg-red-dim/30 px-3 py-4 text-center text-xs text-muted-foreground">
          <p>تعذّر تحميل الأدلة.</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-soft-1"
            >
              <RefreshCw className="size-3" />
              إعادة المحاولة
            </button>
          )}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {t("evidence.empty")}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={`${item.taskId}-${item.stage}-${item.enteredAt}`}>
              <Link
                href={`/tasks/${item.taskId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-cyan/30 hover:bg-soft-1"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {item.taskCode && (
                    <span
                      dir="ltr"
                      className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground/70"
                    >
                      {item.taskCode}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block max-w-[16rem] truncate">{item.title}</span>
                    {item.projectName && (
                      <span
                        className="block max-w-[16rem] truncate text-[11px] text-muted-foreground"
                        title={item.projectName}
                      >
                        المشروع: {item.projectName}
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px]">
                  <span className="rounded bg-soft-2 px-1.5 py-0.5 text-muted-foreground">
                    {stageLabel(item.stage)}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMinutes(item.dwellBusinessMinutes, t)}
                  </span>
                  {item.exitedAt === null && (
                    <span className="rounded bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
                      {t("evidence.inStageNow")}
                    </span>
                  )}
                  {item.isOverdue && (
                    <span className="rounded bg-red-dim px-1.5 py-0.5 text-[10px] font-medium text-cc-red">
                      {item.delayDays !== null
                        ? t("evidence.delayDays", { n: item.delayDays })
                        : t("evidence.overdue")}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
