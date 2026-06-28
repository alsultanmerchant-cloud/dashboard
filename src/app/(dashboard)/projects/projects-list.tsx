"use client";

// Rwasem-style projects view: search bar (filter funnel + active chips +
// search input + filter-dropdown chevron) on the left of a toolbar; on
// the right a result counter and a view toggle (Kanban grid | List).
// Replaces page-based pagination with cursor-style "load more on scroll".

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { ProjectCard } from "./project-card";
import { loadMoreProjectsAction, type ProjectFilters } from "./_load-more";
import { decodeProjectFacets } from "./_facets";
import { useTopbarControls } from "@/components/layout/topbar-context";
import { RecordPaginationListTap } from "@/components/layout/record-pagination";

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

const ProjectsCalendar = dynamic(
  () =>
    import("./projects-calendar").then((mod) => ({
      default: mod.ProjectsCalendar,
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
  // Synchronous guards. `loading` (React state) lags behind by a render, which
  // lets a sentinel that's still in view trigger loadMore twice before the
  // first call has flipped state — causing the same page to be fetched and
  // appended twice (duplicate cards, React duplicate-key errors). The refs
  // are read-write in the same tick so the guard fires reliably.
  const loadingRef = useRef(false);
  const lastLoadedPageRef = useRef(1);
  const search = (params.get("q") ?? "").trim();
  const groupBy = params.get("groupBy") || undefined;
  const view = (() => {
    const v = params.get("view");
    if (v === "list") return "list" as const;
    if (v === "calendar") return "calendar" as const;
    return "kanban" as const;
  })();
  const filters = useMemo<ProjectFilters>(() => {
    const flag = (k: string) => params.get(k) === "1" || params.get(k) === "true";
    const str = (k: string) => params.get(k) || undefined;
    // Odoo applies "With Active Categories" by default — on unless `=0`.
    const flagDefaultOn = (k: string) =>
      params.get(k) !== "0" && params.get(k) !== "false";
    return {
      onlyWithCategories: flagDefaultOn("onlyWithCategories"),
      onlyFavorites: flag("onlyFavorites"),
      onlyWithManager: flag("onlyWithManager"),
      onlyMine: flag("onlyMine"),
      onlyUnassigned: flag("onlyUnassigned"),
      archived: flag("archived"),
      allCategoriesArchived: flag("allCategoriesArchived"),
      overTimesheets: flag("overTimesheets"),
      onlyWithOverdue: flag("atRisk"),
      startDateFrom: str("startDateFrom"),
      startDateTo: str("startDateTo"),
      endDateFrom: str("endDateFrom"),
      endDateTo: str("endDateTo"),
      // Pass through the raw URL `cf=` so the server action can decode it
      // (avoids shipping the custom-filter helpers to the client bundle).
      customFilterEncoded: params.get("cf") || undefined,
      // Rwasem faceted search — typed text becomes one chip per pick.
      searchFacets: decodeProjectFacets(params.get("sf")),
    };
  }, [params]);

  const hasMore = items.length < total;

  // Infinite scroll: observe the sentinel and pull the next page.
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    const nextPage = lastLoadedPageRef.current + 1;
    loadingRef.current = true;
    lastLoadedPageRef.current = nextPage;
    const id = ++reqIdRef.current;
    setLoading(true);
    startTransition(async () => {
      try {
        const res = await loadMoreProjectsAction(nextPage, search, pageSize, filters);
        if (reqIdRef.current !== id) return;
        // Dedupe by id (Supabase UUID, falls back to odooId) so a late or
        // retried fetch can't introduce duplicates.
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id ?? `odoo-${p.odooId}`));
          const fresh = res.rows.filter(
            (p) => !seen.has(p.id ?? `odoo-${p.odooId}`),
          );
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        setTotal(res.total);
        setPage(nextPage);
      } finally {
        loadingRef.current = false;
        if (reqIdRef.current === id) setLoading(false);
      }
    });
  }, [hasMore, search, pageSize, filters]);

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
      {/* Feeds the detail page's `n / N < >` pagination via sessionStorage
          Only project UUIDs are captured —
          Odoo-source rows whose Supabase id is null fall back to no
          pagination once the user clicks in. */}
      <RecordPaginationListTap
        kind="projects"
        ids={items.map((p) => p.id).filter((id): id is string => Boolean(id))}
        hrefPattern="/projects/{id}"
      />
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          لا توجد نتائج
        </div>
      ) : view === "calendar" ? (
        <ProjectsCalendar items={items} />
      ) : view === "kanban" && groupBy ? (
        <ProjectsBoard items={items} groupBy={groupBy} />
      ) : view === "kanban" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((p) => (
            <ProjectCard key={p.id ?? `odoo-${p.odooId}`} project={p} />
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
