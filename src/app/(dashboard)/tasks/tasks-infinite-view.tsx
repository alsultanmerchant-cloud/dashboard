"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { TaskBoard, type BoardTask, type TaskGroupKey } from "../projects/[id]/task-board";
import { TasksListView } from "./tasks-list-view";
import { TasksCalendarView } from "./tasks-calendar-view";
import { TasksPivotView } from "./tasks-pivot-view";
import type { ListTaskRow } from "./_loaders";
import { cn } from "@/lib/utils";

type Props = {
  view: string;
  groupBy: TaskGroupKey[];
  queryString: string;
  initialBoardTasks: BoardTask[];
  initialListTasks: ListTaskRow[];
  totalCount: number;
  pageSize: number;
};

type TasksApiResponse<T> = {
  items: T[];
  totalCount: number;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
};

export function TasksInfiniteView({
  view,
  groupBy,
  queryString,
  initialBoardTasks,
  initialListTasks,
  totalCount: initialTotalCount,
  pageSize,
}: Props) {
  const [boardTasks, setBoardTasks] = useState(initialBoardTasks);
  const [listTasks, setListTasks] = useState(initialListTasks);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBoardTasks(initialBoardTasks);
    setListTasks(initialListTasks);
    setTotalCount(initialTotalCount);
    setLoading(false);
    setError(null);
  }, [initialBoardTasks, initialListTasks, initialTotalCount, queryString, view]);

  const loadedCount = view === "kanban" ? boardTasks.length : listTasks.length;
  const hasMore = loadedCount < totalCount;
  const mode = view === "kanban" ? "board" : "list";

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(queryString);
      params.set("mode", mode);
      params.set("offset", String(loadedCount));
      params.set("limit", String(pageSize));
      const res = await fetch(`/api/tasks?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("failed_to_load_more_tasks");
      }
      if (mode === "board") {
        const json = await res.json() as TasksApiResponse<BoardTask>;
        setBoardTasks((curr) => [...curr, ...json.items]);
        setTotalCount(json.totalCount);
      } else {
        const json = await res.json() as TasksApiResponse<ListTaskRow>;
        setListTasks((curr) => [...curr, ...json.items]);
        setTotalCount(json.totalCount);
      }
    } catch {
      setError("تعذر تحميل المزيد من المهام.");
    } finally {
      setLoading(false);
    }
  }, [hasMore, loadedCount, loading, mode, pageSize, queryString]);

  useEffect(() => {
    if (view === "kanban" || !hasMore || loading) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, hasMore, loading, loadedCount, loadMore, queryString]);

  return (
    <>
      {view === "list" && <TasksListView tasks={listTasks} />}
      {view === "kanban" && (
        <TaskBoard tasks={boardTasks} groupBy={groupBy} />
      )}
      {view === "calendar" && <TasksCalendarView tasks={listTasks} />}
      {view === "pivot" && <TasksPivotView tasks={listTasks} />}
      <div className={cn("mt-4 flex flex-col items-center gap-2", view === "kanban" && "sticky bottom-3 z-20")}>
        {(loading || hasMore || error) && (
          <div
            ref={sentinelRef}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-sm backdrop-blur",
              error
                ? "border-amber/30 bg-amber/10 text-amber"
                : "border-soft bg-card/90 text-muted-foreground",
            )}
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            <span>
              {error
                ? error
                : loading
                  ? `تحميل المزيد... ${loadedCount} / ${totalCount}`
                  : hasMore
                    ? `عرض ${loadedCount} من ${totalCount}`
                  : `تم تحميل ${totalCount} مهمة`}
            </span>
            {view === "kanban" && hasMore && !error && !loading && (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="rounded-full border border-soft px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-soft-1"
              >
                تحميل {Math.min(pageSize, totalCount - loadedCount)} أخرى
              </button>
            )}
            {error && (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="rounded-full border border-amber/40 px-2 py-0.5 text-[11px] text-amber transition-colors hover:bg-amber/10"
              >
                إعادة المحاولة
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
