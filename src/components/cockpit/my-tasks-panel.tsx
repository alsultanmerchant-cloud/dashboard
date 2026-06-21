"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { TaskRow } from "@/components/cockpit/task-row";
import type { MyTaskItem, UrgencyBucket } from "@/lib/data/cockpit";

// "مهامي" reimagined: instead of three stacked full-length lists (which grew
// into one long scroll), a compact segmented panel — one urgency bucket at a
// time, capped at CAP rows, with a "عرض الكل" link into the scoped kanban board
// for the rest. Defaults to the most-urgent non-empty bucket.

const CAP = 5;

const TABS: {
  key: UrgencyBucket;
  dot: string;
  due: string;
  accent: "red" | "amber" | "cyan";
  href: string;
}[] = [
  { key: "overdue", dot: "bg-cc-red", due: "text-cc-red", accent: "red", href: "/tasks?view=kanban&filter=mine,overdue" },
  { key: "today", dot: "bg-amber", due: "text-amber", accent: "amber", href: "/tasks?view=kanban&filter=mine,due_today" },
  { key: "upcoming", dot: "bg-cyan", due: "text-muted-foreground", accent: "cyan", href: "/tasks?view=kanban&filter=mine,open,due_week" },
];

export function MyTasksPanel({
  overdue,
  today,
  upcoming,
  now,
}: {
  overdue: MyTaskItem[];
  today: MyTaskItem[];
  upcoming: MyTaskItem[];
  now: number;
}) {
  const tr = useTranslations("AgentCockpit");
  const buckets: Record<UrgencyBucket, MyTaskItem[]> = { overdue, today, upcoming };
  const firstNonEmpty = TABS.find((t) => buckets[t.key].length)?.key ?? "overdue";
  const [active, setActive] = useState<UrgencyBucket>(firstNonEmpty);

  const tab = TABS.find((t) => t.key === active)!;
  const items = buckets[active];
  const visible = items.slice(0, CAP);
  const more = items.length - visible.length;
  const relDay = (d: string | null): string => {
    if (!d) return "—";
    const days = Math.round((new Date(d).getTime() - now) / 86_400_000);
    if (days === 0) return tr("relative.today");
    if (days < 0) return tr("relative.overdue", { count: -days });
    if (days === 1) return tr("relative.tomorrow");
    return tr("relative.inDays", { count: days });
  };

  return (
    <Card>
      <CardContent className="p-3">
        {/* Segmented urgency tabs with live counts. */}
        <div className="mb-3 flex gap-1 rounded-xl bg-soft-1 p-1">
          {TABS.map((t) => {
            const n = buckets[t.key].length;
            const on = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
                  on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", n ? t.dot : "bg-muted")} />
                <span className="truncate">{tr(`taskTabs.${t.key}`)}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                    on ? "bg-soft-2 text-foreground" : "text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{tr("noTasksInCategory")}</p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((t) => (
              <TaskRow
                key={t.id}
                href={`/tasks/${t.id}`}
                title={t.title}
                taskCode={t.taskCode}
                meta={t.clientName ?? t.projectName}
                stage={t.stage}
                priority={t.priority}
                progressPercent={t.progressPercent}
                accent={tab.accent}
                trailing={
                  <span className={cn("text-[10px] font-semibold tabular-nums", tab.due)}>{relDay(t.dueDate)}</span>
                }
              />
            ))}
            {more > 0 && (
              <Link
                href={tab.href}
                className="mt-1 flex items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan/40 hover:text-foreground"
              >
                {tr("viewAll", { count: items.length })} <ArrowLeft className="size-3 rtl:rotate-0 ltr:rotate-180" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
