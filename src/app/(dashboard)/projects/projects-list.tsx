"use client";

// Rwasem-style projects view: sticky search bar + infinite-scroll grid.
// Mirrors the Odoo Project search header — funnel button, active filter
// chip, free-text input, dropdown chevron — and replaces page-based
// pagination with cursor-style "load more on scroll".

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Filter, Search, X, ChevronDown, Loader2 } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { ProjectCard } from "./project-card";
import { loadMoreProjectsAction } from "./_load-more";
import { cn } from "@/lib/utils";

type Props = {
  initial: LiveProject[];
  initialTotal: number;
  pageSize: number;
};

export function ProjectsList({ initial, initialTotal, pageSize }: Props) {
  const [items, setItems] = useState<LiveProject[]>(initial);
  const [total, setTotal] = useState<number>(initialTotal);
  const [page, setPage] = useState<number>(1);
  const [search, setSearch] = useState<string>("");
  const [hasActiveFilter, setHasActiveFilter] = useState<boolean>(true); // mirrors "With Active Categories" pill
  const [loading, setLoading] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Generation token: every search change bumps it so stale fetches are dropped.
  const reqIdRef = useRef(0);
  // Skip the very first run — initial server-rendered data is already correct.
  const didMountRef = useRef(false);

  const hasMore = items.length < total;

  // Debounced search: refetch from page 1 whenever the query changes.
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
          const res = await loadMoreProjectsAction(1, term, pageSize);
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
  }, [search, pageSize]);

  // Infinite scroll: observe the sentinel and pull the next page.
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const id = ++reqIdRef.current;
    const nextPage = page + 1;
    setLoading(true);
    startTransition(async () => {
      try {
        const res = await loadMoreProjectsAction(nextPage, search.trim(), pageSize);
        if (reqIdRef.current !== id) return;
        setItems((prev) => [...prev, ...res.rows]);
        setTotal(res.total);
        setPage(nextPage);
      } finally {
        if (reqIdRef.current === id) setLoading(false);
      }
    });
  }, [loading, hasMore, page, search, pageSize]);

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

  return (
    <div className="space-y-4">
      {/* Rwasem-style search bar */}
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-border",
          "bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80",
        )}
      >
        {/* Filter (funnel) button */}
        <button
          type="button"
          aria-label="فلاتر"
          className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 text-primary transition-colors hover:bg-primary/25"
        >
          <Filter className="size-4" />
        </button>

        {/* Active filter chip */}
        {hasActiveFilter && (
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[12px] font-medium text-primary">
            With Active Categories
            <button
              type="button"
              aria-label="إزالة الفلتر"
              onClick={() => setHasActiveFilter(false)}
              className="grid size-4 place-items-center rounded-sm hover:bg-primary/20"
            >
              <X className="size-3" />
            </button>
          </span>
        )}

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

        {/* Dropdown chevron (matches Rwasem; opens advanced filters in a future iter) */}
        <button
          type="button"
          aria-label="فلاتر متقدمة"
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between px-1 text-[12px] text-muted-foreground">
        <span>
          {items.length} / {total}
        </span>
        {(loading || isPending) && (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            جاري التحميل…
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          لا توجد نتائج
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((p) => (
            <ProjectCard key={p.odooId} project={p} />
          ))}
        </div>
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
