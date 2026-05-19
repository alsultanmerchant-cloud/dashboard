"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

// Shared loaded-count state for the /tasks toolbar. The count badge sits in
// the server-rendered toolbar while the rows are paged client-side inside
// TasksInfiniteView — this context lets the badge reflect how many rows are
// actually on screen ("80 of 903") instead of the total twice over.

type LoadedCountCtx = { loaded: number; setLoaded: (n: number) => void };

const TasksLoadedCountContext = createContext<LoadedCountCtx | null>(null);

export function TasksCountProvider({
  initialLoaded,
  children,
}: {
  initialLoaded: number;
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState(initialLoaded);
  return (
    <TasksLoadedCountContext.Provider value={{ loaded, setLoaded }}>
      {children}
    </TasksLoadedCountContext.Provider>
  );
}

export function useTasksLoadedCount() {
  const ctx = useContext(TasksLoadedCountContext);
  if (!ctx) {
    throw new Error("useTasksLoadedCount must be used within TasksCountProvider");
  }
  return ctx;
}

export function TaskCountBadge({
  filterLabel,
  total,
}: {
  filterLabel: string;
  total: number;
}) {
  const t = useTranslations("TasksPage");
  const { loaded } = useTasksLoadedCount();
  const shown = Math.min(loaded, total);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-soft bg-soft-1/50 px-2.5 py-1 text-[11px] font-medium"
      aria-label={t("toolbar.countAria", { shown, total })}
    >
      <span className="text-foreground">{filterLabel}</span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums text-foreground/70">
        {t("toolbar.countLabel", { shown, total })}
      </span>
    </span>
  );
}
