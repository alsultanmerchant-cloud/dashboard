// Phase T3 — "تاريخ المراحل" tab.
// Surfaces the canonical task_stage_history table (populated by the
// tg_task_stage_history trigger from migration 0007). Falls back to the
// activity feed's stage_change events if the history table is empty
// (e.g. for very old tasks predating the trigger).
//
// Server component — pure rendering; data comes from the page loader.

import { ArrowLeftRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { TaskStageBadge } from "@/components/status-badges";
import type { TaskActivity } from "@/lib/data/task-activity";
import type { TaskStageHistoryEntry } from "@/lib/data/task-detail";
import { TaskActivityFeed } from "../task-activity-feed";

function formatDateTime(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale === "ar" ? "ar-SA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Wall-clock dwell for one stage segment. We compute it from
// entered_at/exited_at rather than the stored `duration_seconds` column:
// for Odoo-imported rows that column mirrors Odoo's working-hours
// `total_duration_seconds` (nights + weekends stripped), which reads far
// lower than Odoo's own calendar-based stage pills. Wall-clock matches the
// pills (see page.tsx §TASK-INFO-1).
function wallClockSeconds(
  enteredAt: string,
  exitedAt: string | null,
): number | null {
  if (!exitedAt) return null; // open segment (current stage)
  const secs =
    (new Date(exitedAt).getTime() - new Date(enteredAt).getTime()) / 1000;
  return secs > 0 ? secs : null;
}

function formatDuration(
  seconds: number | null,
  t: Awaited<ReturnType<typeof getTranslations<"TaskDetailPage.stageHistory">>>,
): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return t("seconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes - hours * 60;
    return m > 0 ? t("hoursMinutes", { hours, minutes: m }) : t("hours", { count: hours });
  }
  const days = Math.floor(hours / 24);
  const h = hours - days * 24;
  return h > 0 ? t("daysHours", { days, hours: h }) : t("days", { count: days });
}

export async function StageHistoryTimeline({
  rows,
  fallbackActivity,
}: {
  rows: TaskStageHistoryEntry[];
  fallbackActivity: Extract<TaskActivity, { kind: "stage_change" }>[];
}) {
  const t = await getTranslations("TaskDetailPage.stageHistory");
  const locale = await getLocale();
  if (rows.length === 0) {
    if (fallbackActivity.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          {t("empty")}
        </p>
      );
    }
    return <TaskActivityFeed items={fallbackActivity} />;
  }

  return (
    <ol className="relative space-y-4 ms-3 border-s border-soft-2 ps-4">
      {rows.map((row) => {
        const duration = formatDuration(
          wallClockSeconds(row.entered_at, row.exited_at),
          t,
        );

        return (
          <li key={row.id} className="relative">
            <span className="absolute -start-[22px] top-1.5 size-3 rounded-full bg-cyan/60 ring-2 ring-card" />
            <div className="flex flex-wrap items-center gap-2">
              <TaskStageBadge stage={row.stage} />
              {row.exited_at == null && (
                <span className="text-[10px] uppercase tracking-wide text-cyan/80">
                  {t("current")}
                </span>
              )}
              {duration && (
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <ArrowLeftRight className="size-3" />
                  {duration}
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <span dir="ltr" className="tabular-nums">
                {formatDateTime(row.entered_at, locale)}
              </span>
              {row.changed_by_name && (
                <>
                  {" "}
                  · {t("by")}{" "}
                  <span className="text-foreground/80">{row.changed_by_name}</span>
                  {row.changed_by_role && (
                    <span
                      className="ms-1 inline-flex items-center rounded-full bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan"
                      title={t("roleAtMove")}
                    >
                      {row.changed_by_role}
                    </span>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
