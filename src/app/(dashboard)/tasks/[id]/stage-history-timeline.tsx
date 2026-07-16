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

// Working-hours dwell for one stage segment. Unlike the top pipeline bar
// (StageStepper), which shows calendar wall-clock so a stuck task reads as
// the real elapsed span, this "Task History" table is the SLA yardstick: it
// must answer "did this stage stay inside its SLA?" the same way Rwasem does.
// Rwasem/Odoo measures stage duration in WORKING HOURS (nights + weekends
// stripped by the resource calendar), which we import into `duration_seconds`.
// So we surface that column here to match Rwasem's Task Stage History Duration.
// For local, non-Odoo moves `duration_seconds` may be absent — fall back to
// the wall-clock span so those rows still show something.
function stageDurationSeconds(
  durationSeconds: number | null,
  enteredAt: string,
  exitedAt: string | null,
): number | null {
  if (durationSeconds != null && durationSeconds > 0) return durationSeconds;
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
          stageDurationSeconds(row.duration_seconds, row.entered_at, row.exited_at),
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
