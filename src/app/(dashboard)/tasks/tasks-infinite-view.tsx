"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { BoardTask, TaskGroupKey } from "../projects/[id]/task-board";
import type { ListTaskRow } from "./_loaders";
import { useTasksLoadedCount } from "./tasks-count-badge";
import { cn } from "@/lib/utils";
import { RecordPaginationListTap } from "@/components/layout/record-pagination";

const TaskBoard = dynamic(
  () => import("../projects/[id]/task-board").then((mod) => mod.TaskBoard),
);
const TasksListView = dynamic(
  () => import("./tasks-list-view").then((mod) => mod.TasksListView),
);
const TasksCalendarView = dynamic(
  () => import("./tasks-calendar-view").then((mod) => mod.TasksCalendarView),
);
const TasksPivotView = dynamic(
  () => import("./tasks-pivot-view").then((mod) => mod.TasksPivotView),
);

type Props = {
  view: string;
  groupBy: TaskGroupKey[];
  queryString: string;
  initialBoardTasks: BoardTask[];
  initialListTasks: ListTaskRow[];
  totalCount: number;
  /**
   * Lightweight grouping rows for the FULL filtered set — the board buckets
   * these to show true per-column totals (kanban column headers) for any
   * group-by, independent of how many cards are currently loaded.
   */
  groupingRows?: BoardTask[];
  /**
   * When the global kanban groups by a server-partitionable dimension, the
   * initial load is balanced (newest `perBucket` per column). "Load more" then
   * grows the per-bucket cap and replaces the board, instead of flat offset
   * paging (which would skip/duplicate in balanced mode). Null = flat paging.
   */
  boardPartition?: { key: string; perBucket: number } | null;
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
  groupingRows,
  boardPartition,
  pageSize,
}: Props) {
  const [boardTasks, setBoardTasks] = useState(initialBoardTasks);
  const [listTasks, setListTasks] = useState(initialListTasks);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Current per-bucket cap for a balanced board load; grown by "load more".
  const [partitionLimit, setPartitionLimit] = useState(
    boardPartition?.perBucket ?? 0,
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBoardTasks(initialBoardTasks);
    setListTasks(initialListTasks);
    setTotalCount(initialTotalCount);
    setPartitionLimit(boardPartition?.perBucket ?? 0);
    setLoading(false);
    setError(null);
  }, [initialBoardTasks, initialListTasks, initialTotalCount, queryString, view, boardPartition?.perBucket]);

  const loadedCount = view === "kanban" ? boardTasks.length : listTasks.length;
  const hasMore = loadedCount < totalCount;
  const mode = view === "kanban" ? "board" : "list";

  // Mirror the on-screen row count into the toolbar badge.
  const { setLoaded } = useTasksLoadedCount();
  useEffect(() => {
    setLoaded(loadedCount);
  }, [loadedCount, setLoaded]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    // Balanced board "load more": grow the per-bucket cap and REPLACE the board
    // (flat offset paging would skip/duplicate, since the loaded set isn't a
    // flat newest-prefix). Every column gains its next slice of newest cards.
    const balanced = mode === "board" && boardPartition;
    const nextPartitionLimit = balanced
      ? partitionLimit + boardPartition.perBucket
      : partitionLimit;
    try {
      const params = new URLSearchParams(queryString);
      params.set("mode", mode);
      if (balanced) {
        params.set("offset", "0");
        params.set("limit", "2000");
        params.set("partitionBy", boardPartition.key);
        params.set("partitionLimit", String(nextPartitionLimit));
      } else {
        params.set("offset", String(loadedCount));
        params.set("limit", String(pageSize));
      }
      const res = await fetch(`/api/tasks?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("failed_to_load_more_tasks");
      }
      if (mode === "board") {
        const json = await res.json() as TasksApiResponse<BoardTask>;
        if (balanced) {
          setBoardTasks(json.items);
          setPartitionLimit(nextPartitionLimit);
        } else {
          // Flat (non-partitionable group-by) load-more appends; dedupe by id
          // as a safety net against any overlap.
          setBoardTasks((curr) => {
            const seen = new Set(curr.map((t) => t.id));
            return [...curr, ...json.items.filter((t) => !seen.has(t.id))];
          });
        }
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
  }, [hasMore, loadedCount, loading, mode, pageSize, queryString, boardPartition, partitionLimit]);

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

  // Feed the task detail page's `n / N < >` pagination from whichever view
  // the user is in. Board and list views share
  // the same underlying task IDs.
  const paginationIds = view === "kanban"
    ? boardTasks.map((t) => t.id)
    : listTasks.map((t) => t.id);

  return (
    <>
      <RecordPaginationListTap kind="tasks" ids={paginationIds} hrefPattern="/tasks/{id}" />
      {view === "list" && <TasksListView tasks={listTasks} />}
      {view === "kanban" && (
        <TaskBoard tasks={boardTasks} groupBy={groupBy} groupingRows={groupingRows} />
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
