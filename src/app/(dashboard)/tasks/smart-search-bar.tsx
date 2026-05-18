"use client";

// Tasks smart search bar — an exact replica of Odoo (Rwasem)'s search panel.
// Clicking the input (or the chevron) reveals a 3-column dropdown:
//   • Filters   — plain rows, grouped by thin separators, Odoo ordering
//   • Group By  — plain rows; click order forms the outer→inner group chain
//   • Favorites — "Save current search" + the user's saved filters
//
// The active filter shows as a removable chip inside the input, mirroring
// Odoo's "Open Tasks ✕" pattern. All selections write to URL params so the
// state survives reload and is shareable.
//
// Odoo options with no data backing in this schema (Private Tasks, Favorite
// Projects, Properties, Assignment Date, Category, Add Custom Group) are
// intentionally omitted — every rendered row maps to a real filter.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
  ListChecks,
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
  | "has_end_date"
  | "no_deadline"
  | "unassigned"
  | "over_timesheets"
  | "near_timesheets"
  | "archived";
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
  | "start_date"
  | "tags"
  | "created_at";
type SearchSuggestion = {
  id: string;
  projectName: string;
  storeName: string | null;
  clientName: string | null;
};
// Sky Light feedback #5 — task-name autocomplete entries. Clicking one jumps
// straight to /tasks/[id] instead of running a query.
type TaskSuggestion = {
  id: string;
  title: string;
  taskCode: string | null;
  stage: string;
  projectName: string | null;
  clientName: string | null;
};

type DateField = "due_date" | "actual_done_date" | "stage_entered_at" | "created_at";

const DATE_FIELD_DEFS: { key: DateField; labelKey: string }[] = [
  { key: "due_date", labelKey: "dateFields.dueDate" },
  { key: "actual_done_date", labelKey: "dateFields.actualDoneDate" },
  { key: "stage_entered_at", labelKey: "dateFields.stageEnteredAt" },
  { key: "created_at", labelKey: "dateFields.createdAt" },
];

// ── Odoo "Filters" column ────────────────────────────────────────────────
// Ordered exactly as Odoo renders it; `sep` rows draw a thin divider.
type FilterRow =
  | { kind: "filter"; key: FilterKey; labelKey: string }
  | { kind: "date"; field: DateField; labelKey: string }
  | { kind: "sep" };
type LocalizedFilterRow =
  | { kind: "filter"; key: FilterKey; label: string }
  | { kind: "date"; field: DateField; label: string }
  | { kind: "sep" };

const ODOO_FILTER_ROWS: FilterRow[] = [
  { kind: "filter", key: "mine", labelKey: "filters.mine" },
  { kind: "filter", key: "followed", labelKey: "filters.followed" },
  { kind: "filter", key: "unassigned", labelKey: "filters.unassigned" },
  { kind: "sep" },
  { kind: "filter", key: "starred", labelKey: "filters.starred" },
  { kind: "sep" },
  { kind: "filter", key: "near_timesheets", labelKey: "filters.nearTimesheets" },
  { kind: "filter", key: "over_timesheets", labelKey: "filters.overTimesheets" },
  { kind: "sep" },
  { kind: "date", field: "stage_entered_at", labelKey: "dateFields.stageEnteredAt" },
  { kind: "date", field: "due_date", labelKey: "dateFields.dueDate" },
  { kind: "sep" },
  { kind: "filter", key: "open", labelKey: "filters.open" },
  { kind: "filter", key: "done", labelKey: "filters.done" },
  { kind: "date", field: "actual_done_date", labelKey: "dateFields.actualDoneDate" },
  { kind: "sep" },
  { kind: "filter", key: "archived", labelKey: "filters.archived" },
  { kind: "sep" },
  { kind: "filter", key: "in_progress_pct", labelKey: "filters.inProgressPct" },
  { kind: "filter", key: "completed_pct", labelKey: "filters.completedPct" },
];
const FILTER_KEYS = new Set<FilterKey>(
  ODOO_FILTER_ROWS.flatMap((r) => (r.kind === "filter" ? [r.key] : [])),
);

// ── Odoo "Group By" column ───────────────────────────────────────────────
type GroupRow = { key: GroupBy; labelKey: string } | { sep: true };
type LocalizedGroupRow = { key: GroupBy; label: string } | { sep: true };

const ODOO_GROUP_ROWS: GroupRow[] = [
  { key: "assignee", labelKey: "groups.assignee" },
  { key: "stage", labelKey: "groups.stage" },
  { key: "project", labelKey: "groups.project" },
  { key: "tags", labelKey: "groups.tags" },
  { key: "customer", labelKey: "groups.customer" },
  { key: "created_at", labelKey: "groups.createdAt" },
  { key: "last_stage_update", labelKey: "groups.lastStageUpdate" },
  { key: "deadline", labelKey: "groups.deadline" },
  { sep: true },
  { key: "progress", labelKey: "groups.progress" },
];
const GROUP_KEYS = new Set<GroupBy>(
  ODOO_GROUP_ROWS.flatMap((r) => ("sep" in r ? [] : [r.key])),
);

function tokenLabel(
  token: string,
  dateFieldLabels: Map<DateField, string>,
  monthFormatter: Intl.DateTimeFormat,
): string {
  // `due_date:2026q3` → `الموعد النهائي: Q3 2026` style label for chips
  const m = token.match(/^([a-z_]+):(\d{4})(?:(q)(\d)|(m)(\d{1,2}))?$/);
  if (!m) return token;
  const fieldLabel = dateFieldLabels.get(m[1] as DateField) ?? m[1];
  const year = m[2];
  if (m[3] === "q") return `${fieldLabel}: Q${m[4]} ${year}`;
  if (m[5] === "m" && m[6]) {
    const month = new Date(Number(year), Number(m[6]) - 1, 1);
    return `${fieldLabel}: ${monthFormatter.format(month)}`;
  }
  return `${fieldLabel}: ${year}`;
}

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
  const t = useTranslations("TasksSearch");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const dateFields = useMemo(
    () => DATE_FIELD_DEFS.map((field) => ({ key: field.key, label: t(field.labelKey) })),
    [t],
  );
  const dateFieldLabels = useMemo(
    () => new Map(dateFields.map((field) => [field.key, field.label])),
    [dateFields],
  );
  const filterRows = useMemo<LocalizedFilterRow[]>(
    () => ODOO_FILTER_ROWS.map((row) => {
      if (row.kind === "sep") return row;
      if (row.kind === "filter") return { kind: "filter", key: row.key, label: t(row.labelKey) };
      return { kind: "date", field: row.field, label: t(row.labelKey) };
    }),
    [t],
  );
  const filterLabels = useMemo(
    () =>
      new Map<FilterKey, string>(
        filterRows.flatMap((row) =>
          row.kind === "filter" ? [[row.key, row.label] as const] : [],
        ),
      ),
    [filterRows],
  );
  const groupRows = useMemo<LocalizedGroupRow[]>(
    () => ODOO_GROUP_ROWS.map((row) => ("sep" in row ? row : { key: row.key, label: t(row.labelKey) })),
    [t],
  );
  const groupLabels = useMemo(
    () =>
      new Map<GroupBy, string>(
        groupRows.flatMap((row) =>
          "sep" in row ? [] : [[row.key, row.label] as const],
        ),
      ),
    [groupRows],
  );
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  // Multi-select: read `?f=open,starred`. Falls back to legacy `filter`
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
        .filter((s): s is FilterKey => FILTER_KEYS.has(s as FilterKey)),
    );
  }, [filterKey, params]);
  const currentDates = useMemo<string[]>(() => {
    const raw = params.get("d");
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }, [params]);
  const currentView = view ?? params.get("view") ?? "kanban";
  // Group-by is a stack — comma-separated keys form an outer→inner chain.
  // The `groupBy` prop (single legacy value) seeds the array if URL is empty.
  const currentGroupKeys = useMemo<GroupBy[]>(() => {
    const raw = params.get("groupBy");
    const parts = (raw ?? groupBy ?? "stage")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is GroupBy => GROUP_KEYS.has(s as GroupBy));
    return parts.length ? parts : ["stage"];
  }, [params, groupBy]);
  const currentQuery = initialQuery ?? params.get("q") ?? "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(currentQuery);
  const [pending, start] = useTransition();
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [taskSuggestions, setTaskSuggestions] = useState<TaskSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);
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

  // Debounced autocomplete. Fires from 1 character — the trigram fallback in
  // `search_tasks_typeahead` (migration 0117) matches short / partial Arabic
  // input that the FTS tsvector alone would miss.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setTaskSuggestions([]);
      setLoadingSuggestions(false);
      setSuggestionError(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      setSuggestionError(false);
      try {
        const res = await fetch(
          `/api/tasks/search-suggestions?q=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          tasks?: TaskSuggestion[];
          items?: SearchSuggestion[];
        };
        if (!cancelled) {
          setTaskSuggestions(data.tasks ?? []);
          setSuggestions(data.items ?? []);
        }
      } catch {
        if (!cancelled) {
          setTaskSuggestions([]);
          setSuggestions([]);
          setSuggestionError(true);
        }
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

  const activeChips = [...currentActive]
    .filter((k) => filterLabels.has(k))
    .map((k) => ({ key: k, label: filterLabels.get(k)! }));

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

  // Task autocomplete row — jump straight to the task detail page.
  const chooseTask = (task: TaskSuggestion) => {
    setQuery(task.title);
    navigate(`/tasks/${task.id}`);
    setOpen(false);
  };

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

  const shellClassName =
    variant === "topbar"
      ? "border-white/40 bg-white/8 text-white shadow-[0_14px_34px_rgba(20,16,60,0.18)] backdrop-blur-xl"
      : "border-soft/90 bg-card/95 shadow-[0_12px_28px_rgba(82,65,195,0.08)]";
  const shellOpenClassName =
    variant === "topbar"
      ? "border-white/65 ring-2 ring-white/20"
      : "border-cyan/40 ring-2 ring-cyan/15";
  const iconClassName =
    variant === "topbar" ? "text-white/80" : "text-muted-foreground";
  const inputClassName =
    variant === "topbar"
      ? "text-white placeholder:text-white/60"
      : "text-xs placeholder:text-muted-foreground/60";
  const countClassName =
    variant === "topbar" ? "text-white/75" : "text-muted-foreground";
  const chevronClassName =
    variant === "topbar" ? "hover:text-white" : "hover:text-foreground";
  const dropdownClassName =
    variant === "topbar"
      ? "border-white/15 bg-popover/98 backdrop-blur-xl"
      : "border-soft/80 bg-popover/98 backdrop-blur-xl";

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      {/* Input shell — search icon, active-filter chip, query input, chevron */}
      <div
        className={cn(
          "flex min-h-12 items-center gap-2 rounded-[1.6rem] border px-3 py-2 text-xs transition-colors rtl:flex-row-reverse",
          shellClassName,
          open && shellOpenClassName,
        )}
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            variant === "topbar" ? "bg-white/10" : "bg-soft-1",
          )}
        >
          <Search className={cn("size-3.5 shrink-0", iconClassName)} />
        </div>
        {activeChips.map((f) => (
          <span
            key={f.key}
            className="inline-flex items-center gap-1 rounded-full border border-cyan/20 bg-cyan/12 px-2.5 py-1 text-[11px] font-medium text-cyan rtl:flex-row-reverse"
          >
            <Filter className="size-2.5" />
            {f.label}
            <button
              type="button"
              onClick={() => toggleFilter(f.key)}
              aria-label={t("aria.removeChip", { label: f.label })}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {currentDates.map((token) => (
          <span
            key={token}
            className="inline-flex items-center gap-1 rounded-full border border-cyan/20 bg-cyan/12 px-2.5 py-1 text-[11px] font-medium text-cyan rtl:flex-row-reverse"
          >
            <Filter className="size-2.5" />
            {tokenLabel(token, dateFieldLabels, monthFormatter)}
            <button
              type="button"
              onClick={() => toggleDateToken(token)}
              aria-label={t("aria.removeChip", {
                label: tokenLabel(token, dateFieldLabels, monthFormatter),
              })}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {/* Group-by chain chip — only when something other than the implicit
            default ("stage" alone) is active. Chain joined with "‹". */}
        {(currentGroupKeys.length > 1 || currentGroupKeys[0] !== "stage") && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-[11px] font-medium text-primary rtl:flex-row-reverse">
            <Layers className="size-2.5" />
            {currentGroupKeys
              .map((k) => groupLabels.get(k))
              .filter(Boolean)
              .join(" ‹ ")}
            <button
              type="button"
              onClick={() =>
                navigate(buildHref({ groupBy: ["stage"] as GroupBy[], view: "kanban" }))
              }
              aria-label={t("aria.clearGrouping")}
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
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            {t("clearAll")}
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
          placeholder={t("searchPlaceholder")}
          className={cn("min-w-0 flex-1 bg-transparent text-right focus:outline-none", inputClassName)}
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label={t("aria.clearSearch")}
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
          aria-label={t("aria.openSearchOptions")}
          className={cn(
            "rounded-full p-1 transition-colors",
            iconClassName,
            chevronClassName,
            open && (variant === "topbar" ? "bg-white/10 text-white" : "bg-soft-1 text-cyan"),
          )}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {/* Odoo-style 3-column dropdown: Filters / Group By / Favorites. */}
      {open && (
        <div
          className={cn(
            "absolute end-0 start-0 top-[calc(100%+10px)] z-30 max-h-[calc(100vh-180px)] overflow-y-auto overscroll-contain rounded-2xl border p-0 text-right shadow-[0_28px_80px_rgba(23,18,70,0.18)]",
            dropdownClassName,
          )}
        >
          {query.trim().length >= 1 && (
            <div className="border-b border-soft/70 p-3">
              {/* Loading skeleton */}
              {loadingSuggestions && (
                <div className="flex flex-col gap-1.5" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-9 animate-pulse rounded-lg bg-soft-1"
                    />
                  ))}
                  <span className="sr-only">{t("suggestions.loading")}</span>
                </div>
              )}

              {/* Error state */}
              {!loadingSuggestions && suggestionError && (
                <div className="px-2 py-2 text-[11px] text-cc-red">
                  {t("suggestions.error")}
                </div>
              )}

              {/* Empty state */}
              {!loadingSuggestions &&
                !suggestionError &&
                taskSuggestions.length === 0 &&
                suggestions.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground">
                    {t("suggestions.empty")}
                  </div>
                )}

              {/* Task results — primary section (feedback #5). */}
              {!loadingSuggestions &&
                !suggestionError &&
                taskSuggestions.length > 0 && (
                  <div className="mb-2">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                      <ListChecks className="size-3.5" />
                      {t("suggestions.tasksTitle")}
                    </div>
                    <div className="flex flex-col gap-1">
                      {taskSuggestions.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => chooseTask(task)}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-right text-xs transition-colors hover:bg-soft-1 rtl:flex-row-reverse"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 font-medium text-foreground rtl:flex-row-reverse">
                              <ListChecks className="size-3.5 shrink-0 text-cyan" />
                              <span className="truncate">{task.title}</span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground rtl:flex-row-reverse">
                              {task.taskCode ? (
                                <span className="shrink-0 tabular-nums">
                                  {task.taskCode}
                                </span>
                              ) : null}
                              {task.projectName ? (
                                <span className="truncate">
                                  · {task.projectName}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <Check className="size-3.5 shrink-0 text-cyan/70" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Project / store results — secondary section. */}
              {!loadingSuggestions &&
                !suggestionError &&
                suggestions.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                      <Search className="size-3.5" />
                      {t("suggestions.title")}
                    </div>
                    <div className="flex flex-col gap-1">
                      {suggestions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => chooseSuggestion(item)}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-right text-xs transition-colors hover:bg-soft-1 rtl:flex-row-reverse"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 font-medium text-foreground rtl:flex-row-reverse">
                              <Briefcase className="size-3.5 shrink-0 text-cyan" />
                              <span className="truncate">{item.projectName}</span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground rtl:flex-row-reverse">
                              <Store className="size-3 shrink-0" />
                              <span className="truncate">
                                {item.storeName || t("suggestions.noStoreName")}
                              </span>
                              {item.clientName ? (
                                <span className="truncate">· {item.clientName}</span>
                              ) : null}
                            </span>
                          </span>
                          <Check className="size-3.5 shrink-0 text-cyan/70" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}
          <div className="grid grid-cols-1 divide-y divide-soft/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
            {/* ── Filters column ────────────────────────────────────────── */}
            <section className="min-w-0 p-2">
              <ColumnHeader icon={<Filter className="size-3.5" />} label={t("columns.filters")} />
              <div className="flex flex-col">
                {filterRows.map((row, i) => {
                  if (row.kind === "sep") {
                    return <div key={`sep-${i}`} className="my-1 border-t border-soft/60" />;
                  }
                  if (row.kind === "date") {
                    return (
                      <DateFilterRow
                        key={row.field}
                        field={{
                          key: row.field,
                          label: row.label,
                        }}
                        activeTokens={currentDates}
                        onToggle={toggleDateToken}
                      />
                    );
                  }
                  const active = currentActive.has(row.key);
                  return (
                    <MenuRow
                      key={row.key}
                      label={row.label}
                      active={active}
                      onClick={() => toggleFilter(row.key)}
                    />
                  );
                })}
              </div>
            </section>

            {/* ── Group By column ──────────────────────────────────────── */}
            <section className="min-w-0 p-2">
              <ColumnHeader icon={<Layers className="size-3.5" />} label={t("columns.groupBy")} />
              <div className="flex flex-col">
                {groupRows.map((row, i) => {
                  if ("sep" in row) {
                    return <div key={`gsep-${i}`} className="my-1 border-t border-soft/60" />;
                  }
                  const idx = currentGroupKeys.indexOf(row.key);
                  const active = idx >= 0;
                  return (
                    <MenuRow
                      key={row.key}
                      label={row.label}
                      active={active}
                      order={active ? idx + 1 : undefined}
                      onClick={() => toggleGroup(row.key)}
                    />
                  );
                })}
              </div>
            </section>

            {/* ── Favorites column ─────────────────────────────────────── */}
            <section className="min-w-0 p-2">
              <ColumnHeader icon={<Star className="size-3.5" />} label={t("columns.favorites")} />
              <SavedFiltersColumn
                items={filters}
                currentDefinition={{
                  filter: [...currentActive].join(",") || undefined,
                  q: currentQuery || undefined,
                  view: currentView as "kanban" | "list" | "calendar",
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
            </section>
          </div>
          {pending && (
            <div className="border-t border-soft/60 px-3 py-1.5 text-[10px] text-muted-foreground">
              {t("loading")}
            </div>
          )}
        </div>
      )}
      <input type="hidden" value={currentView} readOnly />
    </div>
  );
}

function ColumnHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
      {icon}
      {label}
    </div>
  );
}

// Plain Odoo-style menu row — text, optional check, optional order badge.
function MenuRow({
  label,
  active,
  order,
  onClick,
}: {
  label: string;
  active: boolean;
  order?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors rtl:flex-row-reverse",
        active
          ? "bg-cyan-dim font-medium text-cyan"
          : "text-foreground hover:bg-soft-1",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active && (
        <span className="flex shrink-0 items-center gap-1">
          {order !== undefined && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cyan/30 px-1 text-[9px] font-semibold leading-none tabular-nums text-cyan">
              {order}
            </span>
          )}
          <Check className="size-3.5" />
        </span>
      )}
    </button>
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
  const t = useTranslations("TasksSearch.saved");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [pending, start] = useTransition();

  const handleSave = () =>
    start(async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error(t("nameRequired"));
        return;
      }
      const res = await saveTaskFilterAction({
        name: trimmed,
        definition: {
          ...currentDefinition,
          view: currentDefinition.view as "kanban" | "list" | "calendar" | undefined,
        },
        isShared,
        isDefault,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("saved"));
      setName("");
      setIsShared(false);
      setIsDefault(false);
      setSaving(false);
      router.refresh();
    });

  const handleDelete = (id: string) =>
    start(async () => {
      const res = await deleteTaskFilterAction({ id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });

  const toggleDefault = (item: SavedTaskFilter) =>
    start(async () => {
      const res = await updateTaskFilterAction({
        id: item.id,
        isDefault: !item.is_default,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(item.is_default ? t("defaultUnset") : t("defaultSet"));
      router.refresh();
    });

  return (
    <div className="flex flex-col">
      {items.map((it) => (
        <div
          key={it.id}
          className="group flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-soft-1 rtl:flex-row-reverse"
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
              title={it.owned_by_me === false ? t("sharedByColleague") : t("shared")}
            >
              {t("shared")}
            </span>
          )}
          <button
            type="button"
            onClick={() => toggleDefault(it)}
            disabled={pending || it.owned_by_me === false}
            title={
              it.owned_by_me === false
                ? t("cannotEditColleagueFilter")
                : it.is_default ? t("default") : t("makeDefault")
            }
            className={cn(
              "shrink-0 rounded-full p-1 hover:bg-background disabled:cursor-not-allowed disabled:opacity-40",
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
              title={t("delete")}
              className="shrink-0 rounded-full p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-cc-red group-hover:opacity-100"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      ))}
      {items.length > 0 && <div className="my-1 border-t border-soft/60" />}

      {/* "Save current search" — collapsed Odoo row that expands into a form. */}
      <button
        type="button"
        onClick={() => setSaving((v) => !v)}
        className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-soft-1 rtl:flex-row-reverse"
      >
        <span className="flex items-center gap-1.5 rtl:flex-row-reverse">
          <Save className="size-3.5 text-muted-foreground" />
          {t("saveCurrentSearch")}
        </span>
        <ChevronDown className={cn("size-3 transition-transform", saving && "rotate-180")} />
      </button>
      {saving && (
        <div className="mt-1 space-y-2 px-2.5 pb-1">
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
            placeholder={t("filterNamePlaceholder")}
            maxLength={80}
            disabled={pending}
            autoFocus
            className="h-9 w-full rounded-lg border border-soft bg-background px-3 text-xs placeholder:text-muted-foreground/60"
          />
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground rtl:flex-row-reverse">
            <label className="inline-flex cursor-pointer items-center gap-1 rtl:flex-row-reverse">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                disabled={pending}
                className="size-3 accent-cyan"
              />
              {t("default")}
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rtl:flex-row-reverse">
              <input
                type="checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                disabled={pending}
                className="size-3 accent-cyan"
              />
              {t("shared")}
            </label>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !name.trim()}
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-[11px] font-medium text-cyan hover:bg-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            {t("save")}
          </button>
        </div>
      )}
      {items.length === 0 && !saving && (
        <div className="px-2.5 py-2 text-[10.5px] text-muted-foreground/60">
          {t("empty")}
        </div>
      )}
    </div>
  );
}

// Odoo date filter — a row that expands into month / quarter / year buckets.
function DateFilterRow({
  field,
  activeTokens,
  onToggle,
}: {
  field: { key: DateField; label: string };
  activeTokens: string[];
  onToggle: (token: string) => void;
}) {
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const fieldActive = activeTokens.some((t) => t.startsWith(`${field.key}:`));
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const has = (token: string) => activeTokens.includes(token);
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long" }),
    [locale],
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors rtl:flex-row-reverse",
          fieldActive ? "bg-cyan-dim font-medium text-cyan" : "text-foreground hover:bg-soft-1",
        )}
      >
        <span className="flex items-center gap-1.5 rtl:flex-row-reverse">
          {fieldActive && <Check className="size-3.5" />}
          {field.label}
        </span>
        <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="me-2 ms-2 mt-1 flex flex-col gap-0.5 border-e border-soft pe-2">
          {[currentMonth, currentMonth - 1, currentMonth - 2]
            .filter((m) => m >= 1)
            .map((m) => {
              const token = `${field.key}:${currentYear}m${m}`;
              return (
                <DateBucketBtn
                  key={token}
                  label={monthFormatter.format(new Date(currentYear, m - 1, 1))}
                  active={has(token)}
                  onClick={() => onToggle(token)}
                />
              );
            })}
          <div className="my-0.5 border-t border-soft/50" />
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
        "flex items-center justify-between gap-2 rounded-md px-2.5 py-1 text-[11px] transition-colors rtl:flex-row-reverse",
        active ? "bg-cyan-dim font-medium text-cyan" : "text-foreground hover:bg-soft-1",
      )}
    >
      <span>{label}</span>
      {active && <Check className="size-3" />}
    </button>
  );
}
