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
  type ReactNode,
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
  Briefcase,
  Store,
  Save,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  saveTaskFilterAction,
  deleteTaskFilterAction,
  updateTaskFilterAction,
} from "./_filter_actions";

type FilterKey =
  | "open"
  | "all"
  | "overdue"
  | "done"
  | "mine"
  | "due_today"
  | "behind"
  | "ahead"
  | "critical"
  | "not_started"
  | "in_progress_pct"
  | "completed_pct"
  | "starred"
  | "followed"
  | "has_start_date"
  | "has_end_date";
type GroupBy =
  | "stage"
  | "project"
  | "priority"
  | "deadline"
  | "assignee"
  | "customer"
  | "service"
  | "last_stage_update"
  | "progress"
  | "status"
  | "start_date";
type SearchSuggestion = {
  id: string;
  projectName: string;
  storeName: string | null;
  clientName: string | null;
};

const FILTER_DEFS: { key: FilterKey; label: string; group?: string }[] = [
  { key: "open", label: "مفتوحة", group: "الحالة" },
  { key: "done", label: "مكتملة", group: "الحالة" },
  { key: "all", label: "كل المهام", group: "الحالة" },
  { key: "mine", label: "مهامي", group: "ملكية" },
  { key: "followed", label: "متابَعة", group: "ملكية" },
  { key: "starred", label: "مميَّزة", group: "ملكية" },
  { key: "not_started", label: "لم تبدأ (0%)", group: "تقدّم" },
  { key: "in_progress_pct", label: "قيد التنفيذ", group: "تقدّم" },
  { key: "completed_pct", label: "منجزة (100%)", group: "تقدّم" },
  { key: "due_today", label: "تستحق اليوم", group: "جدولة" },
  { key: "overdue", label: "متأخرة", group: "جدولة" },
  { key: "behind", label: "خلف الجدول", group: "جدولة" },
  { key: "ahead", label: "متقدّمة", group: "جدولة" },
  { key: "critical", label: "تأخير حرج", group: "جدولة" },
  // #18 — Odoo "Has Start Date" / "Has End Date" presets. start = planned_date,
  // end = due_date in our schema.
  { key: "has_start_date", label: "لها تاريخ بدء", group: "جدولة" },
  { key: "has_end_date", label: "لها تاريخ انتهاء", group: "جدولة" },
];

type DateField = "due_date" | "actual_done_date" | "stage_entered_at" | "created_at";

const DATE_FIELD_DEFS: { key: DateField; label: string }[] = [
  { key: "due_date", label: "الموعد النهائي" },
  { key: "actual_done_date", label: "تاريخ الإقفال" },
  { key: "stage_entered_at", label: "آخر تحديث للمرحلة" },
  { key: "created_at", label: "تاريخ الإنشاء" },
];

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function tokenLabel(token: string): string {
  // `due_date:2026q3` → `Q3 2026` style label for chips
  const m = token.match(/^([a-z_]+):(\d{4})(?:(q)(\d)|(m)(\d{1,2}))?$/);
  if (!m) return token;
  const fieldDef = DATE_FIELD_DEFS.find((d) => d.key === m[1]);
  const fieldLabel = fieldDef?.label ?? m[1];
  const year = m[2];
  if (m[3] === "q") return `${fieldLabel}: Q${m[4]} ${year}`;
  if (m[5] === "m" && m[6]) return `${fieldLabel}: ${MONTHS_AR[Number(m[6]) - 1]} ${year}`;
  return `${fieldLabel}: ${year}`;
}

const GROUPBY_DEFS: { key: GroupBy; label: string; available?: boolean }[] = [
  { key: "stage", label: "حسب المرحلة" },
  { key: "status", label: "حسب الحالة" },
  { key: "project", label: "حسب المشروع" },
  { key: "priority", label: "حسب الأولوية" },
  { key: "progress", label: "حسب نسبة التقدّم" },
  { key: "deadline", label: "حسب الموعد النهائي" },
  { key: "start_date", label: "حسب تاريخ البدء" },
  { key: "assignee", label: "حسب المسؤول" },
  { key: "customer", label: "حسب العميل" },
  { key: "service", label: "حسب الخدمة" },
  { key: "last_stage_update", label: "حسب آخر تحديث للمرحلة" },
];

export type SavedTaskFilter = {
  id: string;
  name: string;
  is_default: boolean;
  is_shared?: boolean;
  owned_by_me?: boolean;
  definition: {
    filter?: string;
    q?: string;
    view?: string;
    groupBy?: string;
    projectId?: string;
  };
};

export function SmartSearchBar({
  initialQuery,
  filterKey,
  view,
  groupBy,
  totalCount,
  variant = "page",
  savedFilters = [],
}: {
  initialQuery?: string;
  filterKey?: FilterKey;
  view?: string;
  groupBy?: GroupBy;
  totalCount?: number;
  variant?: "page" | "topbar";
  savedFilters?: SavedTaskFilter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Multi-select: read `?f=open,starred,behind`. Falls back to legacy `filter`
  // (single key) for shareable links saved before the rollout, and finally to
  // the default `{open}`. Empty `f=` (explicit) means no filters active.
  const currentActive = useMemo<Set<FilterKey>>(() => {
    const raw = params.get("f");
    const legacy = params.get("filter");
    const fallback = filterKey ?? legacy;
    if (raw === null) return fallback ? new Set([fallback as FilterKey]) : new Set(["open"]);
    if (raw === "") return new Set();
    return new Set(
      raw.split(",")
        .map((s) => s.trim())
        .filter((s): s is FilterKey => FILTER_DEFS.some((f) => f.key === s)),
    );
  }, [filterKey, params]);
  const currentDates = useMemo<string[]>(() => {
    const raw = params.get("d");
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }, [params]);
  const currentView = view ?? params.get("view") ?? "kanban";
  // Group-by is now a stack — comma-separated keys form an outer→inner chain.
  // The `groupBy` prop (single legacy value) seeds the array if URL is empty.
  const currentGroupKeys = useMemo<GroupBy[]>(() => {
    const raw = params.get("groupBy");
    const parts = (raw ?? groupBy ?? "stage")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is GroupBy => GROUPBY_DEFS.some((g) => g.key === s));
    return parts.length ? parts : ["stage"];
  }, [params, groupBy]);
  const currentGroupBy = currentGroupKeys[0];
  const currentQuery = initialQuery ?? params.get("q") ?? "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(currentQuery);
  const [pending, start] = useTransition();
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // Saved filters: prop wins (server-rendered), otherwise lazy-fetch on first
  // open. Refetch every time the dropdown reopens so newly-added entries
  // surface without a router.refresh().
  const [filters, setFilters] = useState<SavedTaskFilter[]>(savedFilters);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/tasks/saved-filters")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: SavedTaskFilter[] }) => {
        if (!cancelled && Array.isArray(data.items)) setFilters(data.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(`/api/tasks/search-suggestions?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { items?: SearchSuggestion[] };
        if (!cancelled) setSuggestions(data.items ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const activeChips = FILTER_DEFS.filter((f) => currentActive.has(f.key));

  function buildHref(next: Partial<{
    filters: Set<FilterKey>;
    dates: string[];
    groupBy: GroupBy | GroupBy[];
    q: string | null;
    view: string;
    projectId: string | null;
  }>) {
    const sp = new URLSearchParams(params);
    if (next.filters !== undefined) {
      sp.delete("filter"); // drop legacy single-key param if present
      if (next.filters.size === 0) sp.set("f", "");
      else sp.set("f", [...next.filters].join(","));
    }
    if (next.dates !== undefined) {
      if (next.dates.length === 0) sp.delete("d");
      else sp.set("d", next.dates.join(","));
    }
    if (next.groupBy !== undefined) {
      const arr = Array.isArray(next.groupBy) ? next.groupBy : [next.groupBy];
      if (arr.length === 0) sp.delete("groupBy");
      else sp.set("groupBy", arr.join(","));
    }
    if (next.view !== undefined) sp.set("view", next.view);
    if (next.projectId === null) sp.delete("projectId");
    else if (next.projectId !== undefined) sp.set("projectId", next.projectId);
    if (next.q === null) sp.delete("q");
    else if (next.q !== undefined) sp.set("q", next.q);
    return `${pathname}?${sp.toString()}`;
  }

  const toggleFilter = (key: FilterKey) => {
    const next = new Set(currentActive);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    navigate(buildHref({ filters: next }));
  };

  const toggleDateToken = (token: string) => {
    const set = new Set(currentDates);
    if (set.has(token)) set.delete(token);
    else set.add(token);
    navigate(buildHref({ dates: [...set] }));
  };

  const navigate = (href: string) => {
    start(() => router.push(href));
  };

  const submitQuery = () => {
    const trimmed = query.trim();
    navigate(buildHref({ q: trimmed || null, projectId: null }));
    setOpen(false);
  };

  const clearAllFilters = () => {
    navigate(buildHref({ filters: new Set() }));
  };

  const clearQuery = () => {
    setQuery("");
    navigate(buildHref({ q: null, projectId: null }));
  };

  const chooseSuggestion = (item: SearchSuggestion) => {
    setQuery(item.storeName || item.projectName);
    navigate(
      buildHref({
        q: item.storeName || item.projectName,
        projectId: item.id,
      }),
    );
    setOpen(false);
  };

  const itemBase =
    "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-right text-xs transition-colors rtl:flex-row-reverse";

  // Memoize column pills so re-renders don't churn on every keystroke.
  const filterColumn = useMemo(() => {
    const out: ReactNode[] = [];
    let lastGroup: string | undefined;
    for (const f of FILTER_DEFS) {
      if (f.group && f.group !== lastGroup) {
        out.push(
          <div
            key={`grp-${f.group}`}
            className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-0"
          >
            {f.group}
          </div>,
        );
        lastGroup = f.group;
      }
      const active = currentActive.has(f.key);
      out.push(
        <button
          key={f.key}
          type="button"
          onClick={() => {
            toggleFilter(f.key);
            // Keep popover open so users can stack filters Odoo-style.
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
        </button>,
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentActive, params.toString()]);

  const toggleGroup = (key: GroupBy) => {
    // Click to add to the chain; click again to remove. Order is the click
    // order — first click = outer, second = inner — exactly how Rwasem
    // composes "Stage > Assignee".
    const idx = currentGroupKeys.indexOf(key);
    const next = idx >= 0
      ? currentGroupKeys.filter((k) => k !== key)
      : [...currentGroupKeys, key];
    navigate(buildHref({ groupBy: next.length ? next : (["stage"] as GroupBy[]), view: "kanban" }));
  };

  const groupColumn = useMemo(
    () =>
      GROUPBY_DEFS.map((g) => {
        const idx = currentGroupKeys.indexOf(g.key);
        const active = idx >= 0;
        const disabled = g.available === false;
        return (
          <button
            key={g.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              toggleGroup(g.key);
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
            {active && !disabled && (
              <span className="flex items-center gap-1">
                <span className="rounded-full bg-cyan/30 px-1.5 text-[9px] tabular-nums text-cyan">
                  {idx + 1}
                </span>
                <Check className="size-3.5" />
              </span>
            )}
            {disabled && (
              <span className="rounded-full border border-soft px-1.5 text-[9px] text-muted-foreground">
                قريباً
              </span>
            )}
          </button>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentGroupKeys, params.toString()],
  );

  const shellClassName =
    variant === "topbar"
      ? "border-white/45 bg-white/8 text-white backdrop-blur-md"
      : "border-soft bg-card";
  const shellOpenClassName =
    variant === "topbar"
      ? "border-white/60 ring-2 ring-white/20"
      : "border-cyan/40 ring-2 ring-cyan/20";
  const iconClassName =
    variant === "topbar" ? "text-white/80" : "text-muted-foreground";
  const inputClassName =
    variant === "topbar"
      ? "text-white placeholder:text-white/60"
      : "text-xs placeholder:text-muted-foreground/60";
  const countClassName =
    variant === "topbar" ? "text-white/75" : "text-muted-foreground";
  const chevronClassName =
    variant === "topbar"
      ? "hover:text-white"
      : "hover:text-foreground";
  const dropdownClassName =
    variant === "topbar"
      ? "border-white/20 bg-card/98 backdrop-blur-xl"
      : "border-soft bg-popover";

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      {/* Input shell — search icon, active-filter chip, query input, chevron */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors rtl:flex-row-reverse",
          shellClassName,
          open && shellOpenClassName,
        )}
      >
        <Search className={cn("size-3.5 shrink-0", iconClassName)} />
        {activeChips.map((f) => (
          <span
            key={f.key}
            className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-medium text-cyan rtl:flex-row-reverse"
          >
            <Filter className="size-2.5" />
            {f.label}
            <button
              type="button"
              onClick={() => toggleFilter(f.key)}
              aria-label={`إزالة ${f.label}`}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {currentDates.map((token) => (
          <span
            key={token}
            className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-medium text-cyan rtl:flex-row-reverse"
          >
            <Filter className="size-2.5" />
            {tokenLabel(token)}
            <button
              type="button"
              onClick={() => toggleDateToken(token)}
              aria-label={`إزالة ${tokenLabel(token)}`}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {/* Group-by chain chip — only render when something other than the
            implicit default ("stage" alone) is active. Chain joined with "›". */}
        {(currentGroupKeys.length > 1 || currentGroupKeys[0] !== "stage") && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet/15 px-2 py-0.5 text-[11px] font-medium text-violet rtl:flex-row-reverse">
            <Layers className="size-2.5" />
            {currentGroupKeys
              .map((k) => GROUPBY_DEFS.find((g) => g.key === k)?.label.replace(/^حسب\s+/, ""))
              .filter(Boolean)
              .join(" ‹ ")}
            <button
              type="button"
              onClick={() =>
                navigate(buildHref({ groupBy: ["stage"] as GroupBy[], view: "kanban" }))
              }
              aria-label="إلغاء التجميع"
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        {activeChips.length + currentDates.length > 1 && (
          <button
            type="button"
            onClick={() => {
              navigate(buildHref({ filters: new Set(), dates: [] }));
            }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            مسح الكل
          </button>
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
          className={cn("min-w-0 flex-1 bg-transparent text-right focus:outline-none", inputClassName)}
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="مسح البحث"
            className={cn(iconClassName, chevronClassName)}
          >
            <X className="size-3.5" />
          </button>
        )}
        {typeof totalCount === "number" && (
          <span className={cn("text-[10px] tabular-nums", countClassName)}>
            {totalCount}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="فتح خيارات البحث"
          className={cn(
            "rounded p-0.5 transition-colors",
            iconClassName,
            chevronClassName,
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
        <div className={cn("absolute end-0 start-0 top-[calc(100%+6px)] z-30 rounded-2xl border p-3 text-right shadow-2xl", dropdownClassName)}>
          {(loadingSuggestions || suggestions.length > 0) && (
            <div className="mb-3 rounded-xl border border-soft bg-soft-1/40 p-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                <Search className="size-3.5" />
                اقتراحات المشروع والمتجر
              </div>
              <div className="flex flex-col gap-1">
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseSuggestion(item)}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-right text-xs transition-colors hover:bg-soft-1 rtl:flex-row-reverse"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium text-foreground rtl:flex-row-reverse">
                        <Briefcase className="size-3.5 shrink-0 text-cyan" />
                        <span className="truncate">{item.projectName}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground rtl:flex-row-reverse">
                        <Store className="size-3 shrink-0" />
                        <span className="truncate">{item.storeName || "بدون اسم متجر"}</span>
                        {item.clientName ? <span className="truncate">· {item.clientName}</span> : null}
                      </span>
                    </span>
                    <Check className="size-3.5 shrink-0 text-cyan/70" />
                  </button>
                ))}
                {loadingSuggestions && (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground">جاري جلب الاقتراحات…</div>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                <Filter className="size-3.5" />
                الفلاتر
              </div>
              <div className="flex flex-col gap-0.5">{filterColumn}</div>
              <div className="mt-2 border-t border-soft pt-1.5">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  التواريخ
                </div>
                {/* #18 — Odoo "This Month" preset on due_date. One-click
                    deadline-of-current-month filter. The existing per-field
                    expansion below still works for other periods/fields. */}
                {(() => {
                  const now = new Date();
                  const token = `due_date:${now.getFullYear()}m${now.getMonth() + 1}`;
                  const active = currentDates.includes(token);
                  return (
                    <button
                      type="button"
                      onClick={() => toggleDateToken(token)}
                      className={cn(
                        itemBase,
                        active ? "bg-cyan-dim text-cyan" : "text-foreground hover:bg-soft-1",
                      )}
                    >
                      <span>هذا الشهر — الموعد النهائي</span>
                      {active && <Check className="size-3.5" />}
                    </button>
                  );
                })()}
                {DATE_FIELD_DEFS.map((d) => (
                  <DateFieldRow
                    key={d.key}
                    field={d}
                    activeTokens={currentDates}
                    onToggle={toggleDateToken}
                  />
                ))}
              </div>
            </div>
            <div className="md:border-s md:border-soft md:ps-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                <Layers className="size-3.5" />
                التجميع
              </div>
              <div className="flex flex-col gap-0.5">{groupColumn}</div>
            </div>
            <div className="md:border-s md:border-soft md:ps-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                <Star className="size-3.5" />
                المفضلة
              </div>
              <SavedFiltersColumn
                items={filters}
                currentDefinition={{
                  // Comma-joined active filter set. Legacy single-key entries
                  // (saved before multi-select) still parse correctly because
                  // a single key is a valid degenerate case of the join.
                  filter: [...currentActive].join(",") || undefined,
                  q: currentQuery || undefined,
                  view: currentView,
                  // Comma-joined group-by chain. A single key is the
                  // degenerate case so legacy single-key entries still apply.
                  groupBy: currentGroupKeys.join(","),
                  projectId: params.get("projectId") || undefined,
                }}
                onApply={(def) => {
                  const url = new URLSearchParams();
                  if (def.filter) url.set("f", def.filter);
                  if (def.q) url.set("q", def.q);
                  if (def.view) url.set("view", def.view);
                  if (def.groupBy) url.set("groupBy", def.groupBy);
                  if (def.projectId) url.set("projectId", def.projectId);
                  start(() => router.push(`${pathname}?${url.toString()}`));
                  setOpen(false);
                }}
              />
            </div>
          </div>
          {pending && (
            <div className="mt-2 text-[10px] text-muted-foreground">جاري…</div>
          )}
        </div>
      )}
      <input type="hidden" value={currentView} readOnly />
    </div>
  );
}

function SavedFiltersColumn({
  items,
  currentDefinition,
  onApply,
}: {
  items: SavedTaskFilter[];
  currentDefinition: SavedTaskFilter["definition"];
  onApply: (def: SavedTaskFilter["definition"]) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [pending, start] = useTransition();

  const handleSave = () =>
    start(async () => {
      const trimmed = name.trim();
      if (!trimmed) return toast.error("اكتب اسمًا للفلتر");
      const res = await saveTaskFilterAction({
        name: trimmed,
        definition: currentDefinition,
        isShared,
        isDefault,
      });
      if ("error" in res) return toast.error(res.error);
      toast.success("تم حفظ الفلتر");
      setName("");
      setIsShared(false);
      setIsDefault(false);
      router.refresh();
    });

  const handleDelete = (id: string) =>
    start(async () => {
      const res = await deleteTaskFilterAction({ id });
      if ("error" in res) return toast.error(res.error);
      toast.success("حُذف الفلتر");
      router.refresh();
    });

  const toggleDefault = (item: SavedTaskFilter) =>
    start(async () => {
      const res = await updateTaskFilterAction({
        id: item.id,
        isDefault: !item.is_default,
      });
      if ("error" in res) return toast.error(res.error);
      toast.success(item.is_default ? "ألغي التعيين كافتراضي" : "صار افتراضيًا");
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 rtl:flex-row-reverse">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="اسم الفلتر…"
          maxLength={80}
          disabled={pending}
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !name.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan/30 bg-cyan/10 px-2 py-1.5 text-[11px] font-medium text-cyan hover:bg-cyan/20 disabled:opacity-40"
          title="حفظ الفلتر الحالي"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          حفظ
        </button>
      </div>
      <div className="flex items-center gap-3 px-1 text-[10px] text-muted-foreground rtl:flex-row-reverse">
        <label className="flex items-center gap-1 rtl:flex-row-reverse">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={pending}
            className="size-3 accent-cyan"
          />
          افتراضي
        </label>
        <label className="flex items-center gap-1 rtl:flex-row-reverse">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(e) => setIsShared(e.target.checked)}
            disabled={pending}
            className="size-3 accent-cyan"
          />
          مُشارَك
        </label>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-soft px-2 py-3 text-center text-[11px] text-muted-foreground/80">
          لا توجد فلاتر محفوظة
        </div>
      ) : (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {items.map((it) => (
            <li
              key={it.id}
            className="group flex items-center gap-1 rounded-md px-1 py-1 text-xs hover:bg-soft-1 rtl:flex-row-reverse"
          >
              <button
                type="button"
                onClick={() => onApply(it.definition)}
                className="min-w-0 flex-1 truncate text-right"
                title={JSON.stringify(it.definition)}
              >
                {it.name}
              </button>
              {it.is_shared && (
                <span
                  className="shrink-0 rounded-full bg-cyan/15 px-1.5 text-[9px] font-medium text-cyan"
                  title={it.owned_by_me === false ? "مُشارَك من زميل" : "مُشارَك"}
                >
                  مُشارَك
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleDefault(it)}
                disabled={pending || it.owned_by_me === false}
                title={
                  it.owned_by_me === false
                    ? "لا يمكن تعديل فلتر زميل"
                    : it.is_default ? "افتراضي" : "اجعله افتراضيًا"
                }
                className={cn(
                  "shrink-0 rounded p-1 hover:bg-background disabled:cursor-not-allowed disabled:opacity-40",
                  it.is_default ? "text-amber" : "text-muted-foreground/60",
                )}
              >
                <Star className={cn("size-3", it.is_default && "fill-current")} />
              </button>
              {it.owned_by_me !== false && (
                <button
                  type="button"
                  onClick={() => handleDelete(it.id)}
                  disabled={pending}
                  title="حذف"
                  className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-cc-red group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DateFieldRow({
  field,
  activeTokens,
  onToggle,
}: {
  field: { key: DateField; label: string };
  activeTokens: string[];
  onToggle: (token: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fieldActive = activeTokens.some((t) => t.startsWith(`${field.key}:`));
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const has = (token: string) => activeTokens.includes(token);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-soft-1 rtl:flex-row-reverse",
          fieldActive && "text-cyan",
        )}
      >
        <span className="flex items-center gap-1.5 rtl:flex-row-reverse">
          {fieldActive && <Check className="size-3" />}
          {field.label}
        </span>
        <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="me-4 ms-2 mt-0.5 flex flex-col gap-0.5 border-e border-soft pe-2">
          {/* Months of current year (most recent 3) */}
          {[currentMonth, currentMonth - 1, currentMonth - 2]
            .filter((m) => m >= 1)
            .map((m) => {
              const token = `${field.key}:${currentYear}m${m}`;
              return (
                <DateBucketBtn
                  key={token}
                  label={MONTHS_AR[m - 1]}
                  active={has(token)}
                  onClick={() => onToggle(token)}
                />
              );
            })}
          <div className="my-0.5 border-t border-soft/50" />
          {/* Quarters of current year */}
          {[4, 3, 2, 1].map((q) => {
            const token = `${field.key}:${currentYear}q${q}`;
            return (
              <DateBucketBtn
                key={token}
                label={`Q${q}`}
                active={has(token)}
                onClick={() => onToggle(token)}
              />
            );
          })}
          <div className="my-0.5 border-t border-soft/50" />
          {/* Years */}
          {years.map((y) => {
            const token = `${field.key}:${y}`;
            return (
              <DateBucketBtn
                key={token}
                label={String(y)}
                active={has(token)}
                onClick={() => onToggle(token)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateBucketBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] transition-colors",
        active ? "bg-cyan-dim text-cyan" : "text-foreground hover:bg-soft-1",
      )}
    >
      <span>{label}</span>
      {active && <Check className="size-3" />}
    </button>
  );
}
