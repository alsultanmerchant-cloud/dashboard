"use client";

// Rwasem-style smart search bar for the tasks list.
// Click the search input (or the chevron) to reveal a 3-column panel:
//   • Filters    — predefined filters (Open / Mine / Overdue / Done / All)
//   • Group By   — current grouping for the kanban view
//   • Favorites  — placeholder for saved searches (future migration)
//
// The active filter is shown as a removable chip inside the input, mirroring
// Odoo's "Open Tasks ✕" pattern. All selections write to URL params so the
// state survives reload and is shareable.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  ChevronDown,
  Filter,
  Layers,
  Star,
  Search,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FilterKey = "open" | "all" | "overdue" | "done" | "mine";
type GroupBy = "stage" | "project" | "priority" | "deadline";

const FILTER_DEFS: { key: FilterKey; label: string }[] = [
  { key: "open", label: "مفتوحة" },
  { key: "mine", label: "مهامي" },
  { key: "overdue", label: "متأخرة" },
  { key: "done", label: "مكتملة" },
  { key: "all", label: "كل المهام" },
];

const GROUPBY_DEFS: { key: GroupBy; label: string; available?: boolean }[] = [
  { key: "stage", label: "حسب المرحلة" },
  { key: "project", label: "حسب المشروع" },
  // Marked unavailable until the kanban supports them — they appear in the
  // panel as disabled rows so users see the roadmap without surprise.
  { key: "priority", label: "حسب الأولوية", available: false },
  { key: "deadline", label: "حسب الموعد النهائي", available: false },
];

export function SmartSearchBar({
  initialQuery,
  filterKey,
  view,
  groupBy,
  totalCount,
}: {
  initialQuery: string;
  filterKey: FilterKey;
  view: string;
  groupBy: GroupBy;
  totalCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [pending, start] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const activeFilter = FILTER_DEFS.find((f) => f.key === filterKey);

  function buildHref(next: Partial<{
    filter: FilterKey;
    groupBy: GroupBy;
    q: string | null;
    view: string;
  }>) {
    const sp = new URLSearchParams(params);
    if (next.filter !== undefined) sp.set("filter", next.filter);
    if (next.groupBy !== undefined) sp.set("groupBy", next.groupBy);
    if (next.view !== undefined) sp.set("view", next.view);
    if (next.q === null) sp.delete("q");
    else if (next.q !== undefined) sp.set("q", next.q);
    return `${pathname}?${sp.toString()}`;
  }

  const navigate = (href: string) => {
    start(() => router.push(href));
  };

  const submitQuery = () => {
    const trimmed = query.trim();
    navigate(buildHref({ q: trimmed || null }));
    setOpen(false);
  };

  const clearFilter = () => {
    navigate(buildHref({ filter: "all" }));
  };

  const clearQuery = () => {
    setQuery("");
    navigate(buildHref({ q: null }));
  };

  const itemBase =
    "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors";

  // Memoize column pills so re-renders don't churn on every keystroke.
  const filterColumn = useMemo(
    () =>
      FILTER_DEFS.map((f) => {
        const active = f.key === filterKey;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              navigate(buildHref({ filter: f.key }));
              setOpen(false);
            }}
            className={cn(
              itemBase,
              active
                ? "bg-cyan-dim text-cyan"
                : "text-foreground hover:bg-soft-1",
            )}
          >
            <span>{f.label}</span>
            {active && <Check className="size-3.5" />}
          </button>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey, params.toString()],
  );

  const groupColumn = useMemo(
    () =>
      GROUPBY_DEFS.map((g) => {
        const active = g.key === groupBy;
        const disabled = g.available === false;
        return (
          <button
            key={g.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              navigate(buildHref({ groupBy: g.key, view: "kanban" }));
              setOpen(false);
            }}
            className={cn(
              itemBase,
              disabled && "cursor-not-allowed opacity-40",
              !disabled && active
                ? "bg-cyan-dim text-cyan"
                : !disabled && "text-foreground hover:bg-soft-1",
            )}
          >
            <span>{g.label}</span>
            {active && !disabled && <Check className="size-3.5" />}
            {disabled && (
              <span className="rounded-full border border-soft px-1.5 text-[9px] text-muted-foreground">
                قريباً
              </span>
            )}
          </button>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupBy, params.toString()],
  );

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0">
      {/* Input shell — search icon, active-filter chip, query input, chevron */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-soft bg-card px-3 py-1.5 text-xs transition-colors",
          open && "border-cyan/40 ring-2 ring-cyan/20",
        )}
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        {activeFilter && activeFilter.key !== "all" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-medium text-cyan">
            {activeFilter.label}
            <button
              type="button"
              onClick={clearFilter}
              aria-label="إزالة الفلتر"
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitQuery();
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="ابحث في المهام…"
          className="min-w-0 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="مسح البحث"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {totalCount}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="فتح خيارات البحث"
          className={cn(
            "rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground",
            open && "text-cyan",
          )}
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      {/* Smart-search dropdown — 3 columns: Filters / Group By / Favorites */}
      {open && (
        <div className="absolute end-0 start-0 top-[calc(100%+6px)] z-30 rounded-2xl border border-soft bg-popover p-3 shadow-2xl">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Filter className="size-3.5" />
                الفلاتر
              </div>
              <div className="flex flex-col gap-0.5">{filterColumn}</div>
            </div>
            <div className="md:border-s md:border-soft md:ps-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Layers className="size-3.5" />
                التجميع
              </div>
              <div className="flex flex-col gap-0.5">{groupColumn}</div>
            </div>
            <div className="md:border-s md:border-soft md:ps-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Star className="size-3.5" />
                المفضلة
              </div>
              <div className="rounded-md border border-dashed border-soft px-2 py-3 text-center text-[11px] text-muted-foreground/80">
                حفظ البحث الحالي قريباً
              </div>
            </div>
          </div>
          {pending && (
            <div className="mt-2 text-[10px] text-muted-foreground">جاري…</div>
          )}
        </div>
      )}
      <input type="hidden" value={view} readOnly />
    </div>
  );
}
