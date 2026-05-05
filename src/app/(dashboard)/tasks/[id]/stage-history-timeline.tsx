// Phase T3 — "تاريخ المراحل" tab.
// Surfaces the canonical task_stage_history table (populated by the
// tg_task_stage_history trigger from migration 0007). Falls back to the
// activity feed's stage_change events if the history table is empty
// (e.g. for very old tasks predating the trigger).
//
// Server component — pure rendering; data comes from the page loader.

import { ArrowLeftRight } from "lucide-react";
import { TaskStageBadge } from "@/components/status-badges";
import { formatArabicDateTime } from "@/lib/utils-format";
import type { TaskActivity } from "@/lib/data/task-activity";
import type { TaskStageHistoryEntry } from "@/lib/data/task-detail";
import { TaskActivityFeed } from "../task-activity-feed";

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes - hours * 60;
    return m > 0 ? `${hours} ساعة و${m} دقيقة` : `${hours} ساعة`;
  }
  const days = Math.floor(hours / 24);
  const h = hours - days * 24;
  return h > 0 ? `${days} يوم و${h} ساعة` : `${days} يوم`;
}

export function StageHistoryTimeline({
  rows,
  fallbackActivity,
}: {
  rows: TaskStageHistoryEntry[];
  fallbackActivity: Extract<TaskActivity, { kind: "stage_change" }>[];
}) {
  if (rows.length === 0) {
    if (fallbackActivity.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          لم تنتقل المهمة بين المراحل بعد.
        </p>
      );
    }
    return <TaskActivityFeed items={fallbackActivity} />;
  }

  return (
    <ol className="relative space-y-4 ms-3 border-s border-soft-2 ps-4">
      {rows.map((row) => {
        const duration = formatDuration(row.duration_seconds);

        return (
          <li key={row.id} className="relative">
            <span className="absolute -start-[22px] top-1.5 size-3 rounded-full bg-cyan/60 ring-2 ring-card" />
            <div className="flex flex-wrap items-center gap-2">
              <TaskStageBadge stage={row.stage} />
              {row.exited_at == null && (
                <span className="text-[10px] uppercase tracking-wide text-cyan/80">
                  المرحلة الحالية
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
                {formatArabicDateTime(row.entered_at)}
              </span>
              {row.changed_by_name && (
                <>
                  {" "}
                  · بواسطة <span className="text-foreground/80">{row.changed_by_name}</span>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
