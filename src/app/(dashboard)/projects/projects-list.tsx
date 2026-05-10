"use client";

// Rwasem-style projects view: search bar (filter funnel + active chips +
// search input + filter-dropdown chevron) on the left of a toolbar; on
// the right a result counter and a view toggle (Kanban grid | List).
// Replaces page-based pagination with cursor-style "load more on scroll".

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import type { LiveProject } from "@/lib/odoo/live";
import { ProjectCard } from "./project-card";
import { loadMoreProjectsAction, type ProjectFilters } from "./_load-more";
import { useTopbarControls } from "@/components/layout/topbar-context";

const ProjectsTable = dynamic(
  () =>
    import("./projects-table").then((mod) => ({
      default: mod.ProjectsTable,
    })),
);

const ProjectsBoard = dynamic(
  () =>
    import("./projects-board").then((mod) => ({
      default: mod.ProjectsBoard,
    })),
);

type Props = {
  initial: LiveProject[];
  initialTotal: number;
  pageSize: number;
};

export function ProjectsList({ initial, initialTotal, pageSize }: Props) {
  const params = useSearchParams();
  const { setModuleTabsMeta } = useTopbarControls();
  const [items, setItems] = useState<LiveProject[]>(initial);
  const [total, setTotal] = useState<number>(initialTotal);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);
  const search = (params.get("q") ?? "").trim();
  const groupBy = params.get("groupBy") || undefined;
  const view = params.get("view") === "list" ? "list" : "kanban";
  const filters = useMemo<ProjectFilters>(() => {
    const flag = (k: string) => params.get(k) === "1" || params.get(k) === "true";
    const str = (k: string) => params.get(k) || undefined;
    return {
      onlyWithCategories: flag("onlyWithCategories"),
      onlyFavorites: flag("onlyFavorites"),
      onlyWithManager: flag("onlyWithManager"),
      onlyMine: flag("onlyMine"),
      onlyUnassigned: flag("onlyUnassigned"),
      archived: flag("archived"),
      allCategoriesArchived: flag("allCategoriesArchived"),
      overTimesheets: flag("overTimesheets"),
      startDateFrom: str("startDateFrom"),
      startDateTo: str("startDateTo"),
      endDateFrom: str("endDateFrom"),
      endDateTo: str("endDateTo"),
    };
  }, [params]);

  const hasMore = items.length < total;

  // Infinite scroll: observe the sentinel and pull the next page.
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const id = ++reqIdRef.current;
    const nextPage = page + 1;
    setLoading(true);
    startTransition(async () => {
      try {
        const res = await loadMoreProjectsAction(nextPage, search, pageSize, filters);
        if (reqIdRef.current !== id) return;
        setItems((prev) => [...prev, ...res.rows]);
        setTotal(res.total);
        setPage(nextPage);
      } finally {
        if (reqIdRef.current === id) setLoading(false);
      }
    });
  }, [loading, hasMore, page, search, pageSize, filters]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "400px 0px 400px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [loadMore]);

  useEffect(() => {
    setModuleTabsMeta({
      trailingText: `${items.length} / ${total}`,
      isBusy: loading || isPending,
    });
    return () => setModuleTabsMeta(null);
  }, [items.length, total, loading, isPending, setModuleTabsMeta]);

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          لا توجد نتائج
        </div>
      ) : view === "kanban" && groupBy ? (
        <ProjectsBoard items={items} groupBy={groupBy} />
      ) : view === "kanban" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((p) => (
            <ProjectCard key={p.odooId || p.ref} project={p} />
          ))}
        </div>
      ) : (
        <ProjectsTable items={items} />
      )}

      {/* Sentinel for IntersectionObserver */}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading || isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {(loading || isPending) && <Loader2 className="size-3 animate-spin" />}
            تحميل المزيد
          </button>
        </div>
      )}
    </div>
  );
}
