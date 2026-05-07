"use client";

import {
  ListTree,
  Link2,
  Clock,
  MessageSquare,
  AlarmClock,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SmartButton = {
  target: string;
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "amber";
};

export function TaskSmartButtons({
  subtaskCount,
  linkCount,
  timesheetHours,
  commentCount,
  openActivityCount,
}: {
  subtaskCount: number;
  linkCount: number;
  timesheetHours: number;
  commentCount: number;
  openActivityCount: number;
}) {
  const buttons: SmartButton[] = [
    {
      target: "subtasks",
      label: "مهام فرعية",
      value: String(subtaskCount),
      icon: ListTree,
    },
    {
      target: "links",
      label: "ربط",
      value: String(linkCount),
      icon: Link2,
    },
    {
      target: "timesheets",
      label: "ساعات",
      value: formatHours(timesheetHours),
      icon: Clock,
    },
    {
      target: "activity",
      label: "تعليقات",
      value: String(commentCount),
      icon: MessageSquare,
    },
    {
      target: "activities",
      label: "أنشطة",
      value: String(openActivityCount),
      icon: AlarmClock,
      tone: openActivityCount > 0 ? "amber" : "default",
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((b) => {
        const Icon = b.icon;
        const isAmber = b.tone === "amber";
        return (
          <button
            key={b.target}
            type="button"
            onClick={() => focusTab(b.target)}
            className={cn(
              "group inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs transition-colors",
              "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isAmber
                ? "border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
                : "border-soft/60 text-foreground",
            )}
            aria-label={`${b.label}: ${b.value}`}
          >
            <Icon className="size-4 shrink-0 opacity-70 group-hover:opacity-100" />
            <span className="font-semibold tabular-nums">{b.value}</span>
            <span className="text-muted-foreground group-hover:text-foreground">
              {b.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function focusTab(target: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    `[data-smart-target="${target}"]`,
  );
  if (!trigger) return;
  trigger.click();
  trigger.scrollIntoView({ behavior: "smooth", block: "center" });
}

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0";
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(1);
}
