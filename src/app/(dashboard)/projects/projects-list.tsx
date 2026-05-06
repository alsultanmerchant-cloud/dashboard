"use client";

// Rwasem-style projects view: search bar (filter funnel + active chips +
// search input + filter-dropdown chevron) on the left of a toolbar; on
// the right a result counter and a view toggle (Kanban grid | List).
// Replaces page-based pagination with cursor-style "load more on scroll".

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Filter, Search, X, ChevronDown, Loader2,
  LayoutGrid, List as ListIcon, Check,
} from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { ProjectCard } from "./project-card";
import { ProjectsTable } from "./projects-table";
import { loadMoreProjectsAction, type ProjectFilters } from "./_load-more";
import { cn } from "@/lib/utils";

type Props = {
  initial: LiveProject[];
  initialTotal: number;
  pageSize: number;
};

type ViewMode = "kanban" | "list";

type FilterKey = "onlyWithCategories" | "onlyFavorites" | "onlyWithManager";

const FILTER_LABELS: Record<FilterKey, string> = {
  onlyWithCategories: "With Active Categories",
  onlyFavorites: "Pinned",
  onlyWithManager: "Has Project Manager",
};

const FILTER_KEYS: FilterKey[] = [
  "onlyWithCategories",
  "onlyFavorites",
  "onlyWithManager",
];

export function ProjectsList({ initial, initialTotal, pageSize }: Props) {
  const [items, setItems] = useState<LiveProject[]>(initial);
  const [total, setTotal] = useState<number>(initialTotal);
  const [page, setPage] = useState<number>(1);
  const [search, setSearch] = useState<string>("");
  const [filters, setFilters] = useState<ProjectFilters>({});
  const [view, setView] = useState<ViewMode>("kanban");
  const [filterMenuOpen, setFilterMenuOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  // Generation token: every search/filter change bumps it so stale fetches drop.
  const reqIdRef = useRef(0);
  const didMountRef = useRef(false);

  const hasMore = items.length < total;
  const activeFilterKeys = FILTER_KEYS.filter((k) => filters[k]);

  // Close the filter dropdown on outside click.
  useEffect(() => {
    if (!filterMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [filterMenuOpen]);

  // Debounced refetch when search OR filters change.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const term = search.trim();
    const id = ++reqIdRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await loadMoreProjectsAction(1, term, pageSize, filters);
          if (reqIdRef.current !== id) return;
          setItems(res.rows);
          setTotal(res.total);
          setPage(1);
        } finally {
          if (reqIdRef.current === id) setLoading(false);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, pageSize, filters]);

  // Infinite scroll: observe the sentinel and pull the next page.
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const id = ++reqIdRef.current;
    const nextPage = page + 1;
    setLoading(true);
    startTransition(async () => {
      try {
        const res = await loadMoreProjectsAction(nextPage, search.trim(), pageSize, filters);
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

  function toggleFilter(key: FilterKey) {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search bar (left) · counter + view toggle (right) */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
        {/* Filter (funnel) button — opens the same menu as the chevron */}
        <button
          type="button"
          aria-label="فلاتر"
          onClick={() => setFilterMenuOpen((v) => !v)}
          className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 text-primary transition-colors hover:bg-primary/25"
        >
          <Filter className="size-4" />
        </button>

        {/* Active filter chips */}
        {activeFilterKeys.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[12px] font-medium text-primary"
          >
            {FILTER_LABELS[k]}
            <button
              type="button"
              aria-label={`إزالة ${FILTER_LABELS[k]}`}
              onClick={() => toggleFilter(k)}
              className="grid size-4 place-items-center rounded-sm hover:bg-primary/20"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        {/* Search input */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {/* Filter dropdown trigger */}
        <div className="relative" ref={filterMenuRef}>
          <button
            type="button"
            aria-label="فلاتر متقدمة"
            onClick={() => setFilterMenuOpen((v) => !v)}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
              filterMenuOpen && "bg-muted text-foreground",
            )}
          >
            <ChevronDown className="size-4" />
          </button>
          {filterMenuOpen && (
            <div className="absolute end-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg">
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                فلاتر
              </p>
              {FILTER_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleFilter(k)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[13px] hover:bg-muted"
                >
                  <span>{FILTER_LABELS[k]}</span>
                  {filters[k] && <Check className="size-3.5 text-primary" />}
                </button>
              ))}
              {activeFilterKeys.length > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    onClick={() => setFilters({})}
                    className="flex w-full items-center px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    إزالة كل الفلاتر
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right group: counter + view toggle */}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <span className="text-[12px] tabular-nums text-muted-foreground" dir="ltr">
            {items.length} / {total}
          </span>
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              aria-label="عرض كانبان"
              onClick={() => setView("kanban")}
              className={cn(
                "grid size-7 place-items-center text-muted-foreground transition-colors hover:bg-muted",
                view === "kanban" && "bg-primary/15 text-primary hover:bg-primary/20",
              )}
              title="Kanban"
            >
              <LayoutGrid className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="عرض قائمة"
              onClick={() => setView("list")}
              className={cn(
                "grid size-7 place-items-center border-s border-border text-muted-foreground transition-colors hover:bg-muted",
                view === "list" && "bg-primary/15 text-primary hover:bg-primary/20",
              )}
              title="List"
            >
              <ListIcon className="size-3.5" />
            </button>
          </div>
          {(loading || isPending) && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          لا توجد نتائج
        </div>
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
