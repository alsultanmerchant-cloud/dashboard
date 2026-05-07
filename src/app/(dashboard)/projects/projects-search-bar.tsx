"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Check,
  Filter,
  Search,
  X,
  Star,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

// All filter keys are URL-driven so the dropdown is fully bookmark/share-able.
type BoolFilterKey =
  | "onlyMine"
  | "onlyFavorites"
  | "onlyUnassigned"
  | "onlyWithCategories"
  | "onlyWithManager"
  | "archived";

const BOOL_FILTERS: { key: BoolFilterKey; label: string }[] = [
  { key: "onlyMine", label: "My Projects" },
  { key: "onlyFavorites", label: "My Favorites" },
  { key: "onlyUnassigned", label: "Unassigned" },
  { key: "onlyWithManager", label: "Has Project Manager" },
  { key: "onlyWithCategories", label: "With Active Categories" },
  { key: "archived", label: "Archived (On Hold)" },
];

type GroupKey = "" | "project_manager" | "status" | "tags";
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "project_manager", label: "Project Manager" },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags" },
];

function isEnabled(value: string | null) {
  return value === "1" || value === "true";
}

export function ProjectsSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const currentQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(currentQuery);
  const [open, setOpen] = useState(false);

  const filters = useMemo(() => {
    const out = {} as Record<BoolFilterKey, boolean>;
    for (const f of BOOL_FILTERS) out[f.key] = isEnabled(params.get(f.key));
    return out;
  }, [params]);
  const activeFilterKeys = BOOL_FILTERS.filter(({ key }) => filters[key]).map(
    ({ key }) => key,
  );

  const startDateFrom = params.get("startDateFrom") ?? "";
  const startDateTo = params.get("startDateTo") ?? "";
  const endDateFrom = params.get("endDateFrom") ?? "";
  const endDateTo = params.get("endDateTo") ?? "";
  const groupBy = (params.get("groupBy") ?? "") as GroupKey;

  const hasDateFilter = Boolean(startDateFrom || startDateTo || endDateFrom || endDateTo);

  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === currentQuery) return;
    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      if (trimmed) sp.set("q", trimmed);
      else sp.delete("q");
      router.replace(sp.toString() ? `${pathname}?${sp.toString()}` : pathname);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, currentQuery, params, pathname, router]);

  const updateParams = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(params.toString());
    mutate(sp);
    router.replace(sp.toString() ? `${pathname}?${sp.toString()}` : pathname);
  };

  const toggleFilter = (key: BoolFilterKey) => {
    updateParams((sp) => {
      if (isEnabled(sp.get(key))) sp.delete(key);
      else sp.set(key, "1");
    });
  };

  const setDate = (key: string, value: string) => {
    updateParams((sp) => {
      if (value) sp.set(key, value);
      else sp.delete(key);
    });
  };

  const setGroup = (key: GroupKey) => {
    updateParams((sp) => {
      if (key) sp.set("groupBy", key);
      else sp.delete("groupBy");
    });
  };

  const clearFilter = (key: BoolFilterKey) => {
    updateParams((sp) => sp.delete(key));
  };

  const clearAllFilters = () => {
    updateParams((sp) => {
      for (const { key } of BOOL_FILTERS) sp.delete(key);
      sp.delete("startDateFrom");
      sp.delete("startDateTo");
      sp.delete("endDateFrom");
      sp.delete("endDateTo");
      sp.delete("groupBy");
    });
  };

  const clearQuery = () => {
    setQuery("");
    updateParams((sp) => sp.delete("q"));
  };

  const labelOf = (key: BoolFilterKey) =>
    BOOL_FILTERS.find((f) => f.key === key)?.label ?? key;

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-white/45 bg-white/8 px-3 py-1.5 text-xs text-white backdrop-blur-md transition-colors",
          open && "border-white/60 ring-2 ring-white/20",
        )}
      >
        <button
          type="button"
          aria-label="فلاتر المشاريع"
          onClick={() => setOpen((v) => !v)}
          className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/16 hover:text-white"
        >
          <Filter className="size-3.5" />
        </button>

        {activeFilterKeys.map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-medium text-cyan"
          >
            {labelOf(key)}
            <button
              type="button"
              aria-label={`إزالة ${labelOf(key)}`}
              onClick={() => clearFilter(key)}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {hasDateFilter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-medium text-cyan">
            Date filter
            <button
              type="button"
              aria-label="إزالة فلتر التاريخ"
              onClick={() =>
                updateParams((sp) => {
                  sp.delete("startDateFrom");
                  sp.delete("startDateTo");
                  sp.delete("endDateFrom");
                  sp.delete("endDateTo");
                })
              }
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        {groupBy && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
            Grouped by {GROUP_OPTIONS.find((g) => g.key === groupBy)?.label}
            <button
              type="button"
              onClick={() => setGroup("")}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        )}

        <Search className="size-3.5 shrink-0 text-white/80" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="ابحث باسم المشروع أو اسم المتجر…"
          className="min-w-0 flex-1 bg-transparent text-white placeholder:text-white/60 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="مسح البحث"
            className="text-white/80 transition-colors hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="فتح خيارات المشاريع"
          className={cn(
            "rounded p-0.5 text-white/80 transition-colors hover:text-white",
            open && "text-cyan",
          )}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && (
        <div className="absolute end-0 start-0 top-[calc(100%+6px)] z-30 rounded-2xl border border-white/20 bg-card/98 p-4 shadow-2xl backdrop-blur-xl">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Filters column */}
            <div className="min-w-[180px]">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Filter className="size-3.5" /> Filters
              </div>
              <div className="flex flex-col gap-0.5">
                {BOOL_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleFilter(f.key)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                      filters[f.key]
                        ? "bg-cyan-dim text-cyan"
                        : "text-foreground hover:bg-soft-1",
                    )}
                  >
                    <span>{f.label}</span>
                    {filters[f.key] && <Check className="size-3.5" />}
                  </button>
                ))}
                <div className="my-2 border-t border-soft" />
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Start Date
                </div>
                <div className="flex items-center gap-1 px-2 pb-1">
                  <input
                    type="date"
                    value={startDateFrom}
                    onChange={(e) => setDate("startDateFrom", e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
                  />
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <input
                    type="date"
                    value={startDateTo}
                    onChange={(e) => setDate("startDateTo", e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
                  />
                </div>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  End Date
                </div>
                <div className="flex items-center gap-1 px-2 pb-1">
                  <input
                    type="date"
                    value={endDateFrom}
                    onChange={(e) => setDate("endDateFrom", e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
                  />
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <input
                    type="date"
                    value={endDateTo}
                    onChange={(e) => setDate("endDateTo", e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-soft bg-card/50 px-1.5 py-1 text-[11px] text-foreground"
                  />
                </div>
              </div>
            </div>

            {/* Group By column */}
            <div className="min-w-[160px]">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Layers className="size-3.5" /> Group By
              </div>
              <div className="flex flex-col gap-0.5">
                {GROUP_OPTIONS.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGroup(groupBy === g.key ? "" : g.key)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                      groupBy === g.key
                        ? "bg-amber-400/20 text-amber-200"
                        : "text-foreground hover:bg-soft-1",
                    )}
                  >
                    <span>{g.label}</span>
                    {groupBy === g.key && <Check className="size-3.5" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Favorites / quick saves column */}
            <div className="min-w-[160px]">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Star className="size-3.5" /> Favorites
              </div>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    void navigator.clipboard
                      .writeText(window.location.href)
                      .catch(() => undefined);
                  }
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-soft-1"
              >
                <span>Copy current search URL</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
              <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted-foreground">
                Bookmark the page after applying filters — the URL captures every
                filter, group-by, and search term.
              </p>
            </div>
          </div>

          {(activeFilterKeys.length > 0 || hasDateFilter || groupBy) && (
            <>
              <div className="my-3 border-t border-soft" />
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex w-full items-center justify-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground"
              >
                إزالة كل الفلاتر
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
