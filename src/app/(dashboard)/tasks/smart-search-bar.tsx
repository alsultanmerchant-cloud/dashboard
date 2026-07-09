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
  useCallback,
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
  Save,
  Trash2,
  Loader2,
  Sliders,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  saveTaskFilterAction,
  deleteTaskFilterAction,
  updateTaskFilterAction,
} from "./_filter_actions";
import { CustomFilterDialog } from "@/components/custom-filter/dialog";
import { buildTaskFields } from "@/lib/custom-filter/tasks-fields";
import {
  URL_PARAM as CF_URL_PARAM,
  encodeFilterToUrl,
  decodeFilterFromUrl,
} from "@/lib/custom-filter/url-state";
import { formatFilterTree } from "@/lib/custom-filter/format-pill";
import type { FilterTree } from "@/lib/custom-filter/types";
import { TASK_STAGES } from "@/lib/labels";

type FilterKey =
  | "open"
  | "all"
  | "overdue"
  | "done"
  | "mine"
  | "due_today"
  | "due_week"
  | "completed_week"
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
// ── Rwasem faceted search ────────────────────────────────────────────────
// Typed text becomes a field-scoped facet. Picking a menu row ("Search Tasks
// for X", "Search Assignees for X", …) appends one Facet. Facets persist in
// the `?sf=` param as a JSON array. Combination rules mirror Odoo: facets on
// different fields AND together, facets on the same field OR together — both
// enforced in the list_tasks_bundle RPC (migration 0127).
type FacetField = "title" | "tags" | "assignee" | "stage" | "project";
type Facet = { field: FacetField; value: string };

const FACET_FIELD_DEFS: { field: FacetField }[] = [
  { field: "title" },
  { field: "tags" },
  { field: "assignee" },
  { field: "stage" },
  { field: "project" },
];
const FACET_FIELD_SET = new Set<FacetField>(
  FACET_FIELD_DEFS.map((d) => d.field),
);

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
  { kind: "filter", key: "not_started", labelKey: "filters.notStarted" },
  { kind: "sep" },
  { kind: "filter", key: "behind", labelKey: "filters.behind" },
  { kind: "filter", key: "ahead", labelKey: "filters.ahead" },
  { kind: "filter", key: "critical", labelKey: "filters.critical" },
  { kind: "sep" },
  { kind: "filter", key: "due_today", labelKey: "filters.dueToday" },
  { kind: "sep" },
  { kind: "filter", key: "overdue", labelKey: "filters.overdue" },
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
  // Short field label for a facet ("Tasks", "Assignees", …) — used both for
  // the dropdown menu rows and the two-segment facet chips.
  const facetFieldLabel = useCallback(
    (field: FacetField) => t(`facets.fields.${field}`),
    [t],
  );
  // Stage facets arriving from the executive dashboard drill-downs carry the
  // raw stage enum (e.g. "client_changes") as their value. Render the
  // localized stage label in the chip instead of the bare enum; leave
  // free-text facet values (title/assignee/…) untouched.
  const tStages = useTranslations("TasksBoard");
  const facetValueLabel = useCallback(
    (field: FacetField, value: string) =>
      field === "stage" && (TASK_STAGES as readonly string[]).includes(value)
        ? tStages(`stages.${value}`)
        : value,
    [tStages],
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
  // Active search facets, decoded from the `?sf=` JSON array. Invalid entries
  // (unknown field, blank value) are dropped so a hand-edited URL is safe.
  const currentFacets = useMemo<Facet[]>(() => {
    const raw = params.get("sf");
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry): Facet[] => {
        if (!entry || typeof entry !== "object") return [];
        const field = (entry as { field?: unknown }).field;
        const value = (entry as { value?: unknown }).value;
        if (typeof field !== "string" || !FACET_FIELD_SET.has(field as FacetField)) return [];
        if (typeof value !== "string" || !value.trim()) return [];
        return [{ field: field as FacetField, value: value.trim() }];
      });
    } catch {
      return [];
    }
  }, [params]);
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

  // ── Custom Filter (Odoo-style rule builder) ────────────────────────────
  // The whole rule tree lives in `?cf=<base64-json>` so reloads + share
  // links preserve it — identical wiring to the /projects search bar.
  const customFilterT = useTranslations("CustomFilter");
  const taskFields = useMemo(() => buildTaskFields(t), [t]);
  const taskFieldMap = useMemo(
    () => Object.fromEntries(taskFields.map((f) => [f.name, f])),
    [taskFields],
  );
  const getField = useCallback(
    (name: string) => taskFieldMap[name],
    [taskFieldMap],
  );
  const customTreeRaw = params.get(CF_URL_PARAM);
  const customTree: FilterTree | null = useMemo(
    () => decodeFilterFromUrl(customTreeRaw),
    [customTreeRaw],
  );
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [relationLabels, setRelationLabels] = useState<Record<string, string>>({});
  // Resolve relational UUIDs → display names so the pill reads
  // "Project is in ( متجر رينا )" instead of a raw uuid.
  useEffect(() => {
    if (!customTree) return;
    const pairs: { model: string; id: string }[] = [];
    const walk = (nodes: FilterTree["children"]) => {
      for (const n of nodes) {
        if (n.type === "group") walk(n.children);
        else {
          const f = getField(n.field);
          if (!f || f.kind !== "relational" || !f.relation) continue;
          const ids = Array.isArray(n.value)
            ? (n.value as string[])
            : n.value
              ? [n.value as string]
              : [];
          for (const id of ids) pairs.push({ model: f.relation.model, id });
        }
      }
    };
    walk(customTree.children);
    const missing = pairs.filter((p) => !relationLabels[p.id]);
    if (missing.length === 0) return;
    const byModel = new Map<string, string[]>();
    for (const { model, id } of missing) {
      const arr = byModel.get(model) ?? [];
      arr.push(id);
      byModel.set(model, arr);
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const [model, ids] of byModel) {
        const res = await fetch(
          `/api/custom-filter/options?model=${encodeURIComponent(model)}&ids=${ids.join(",")}`,
          { credentials: "include" },
        );
        if (!res.ok) continue;
        const json = (await res.json()) as { items: { id: string; label: string }[] };
        for (const item of json.items) next[item.id] = item.label;
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setRelationLabels((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customTree, getField, relationLabels]);
  const customFilterLabel = useMemo(() => {
    if (!customTree) return "";
    return formatFilterTree(
      customTree,
      getField,
      (_model, id) => relationLabels[id],
      {
        operatorLabel: (op) =>
          customFilterT(
            `operators.${{
              "=": "eq",
              "!=": "neq",
              ">": "gt",
              ">=": "gte",
              "<": "lt",
              "<=": "lte",
              "ilike": "contains",
              "not ilike": "notContains",
              "in": "isIn",
              "not in": "isNotIn",
              "between": "between",
              "set": "isSet",
              "not_set": "isNotSet",
            }[op]}`,
          ),
        booleanTrue: customFilterT("boolean.true"),
        booleanFalse: customFilterT("boolean.false"),
        and: customFilterT("connectors.and"),
        or: customFilterT("connectors.or"),
      },
    );
  }, [customFilterT, customTree, getField, relationLabels]);

  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

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
    facets: Facet[];
    view: string;
    projectId: string | null;
    customFilter: string | null;
  }>) {
    const sp = new URLSearchParams(params);
    if (next.customFilter === null) sp.delete(CF_URL_PARAM);
    else if (next.customFilter !== undefined) sp.set(CF_URL_PARAM, next.customFilter);
    if (next.facets !== undefined) {
      if (next.facets.length === 0) sp.delete("sf");
      else sp.set("sf", JSON.stringify(next.facets));
    }
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

  const applyCustomFilter = (tree: FilterTree | null) => {
    if (tree && tree.children.length > 0) {
      navigate(buildHref({ customFilter: encodeFilterToUrl(tree) }));
    } else {
      navigate(buildHref({ customFilter: null }));
    }
  };

  const clearCustomFilter = () => {
    navigate(buildHref({ customFilter: null }));
  };

  // Append one facet for the typed text. Same field + same value is a no-op
  // (Odoo de-dups identical facets); a stale free-text `q` is dropped so the
  // two search models don't both apply at once.
  const addFacet = (field: FacetField) => {
    const value = query.trim();
    if (!value) return;
    const exists = currentFacets.some(
      (f) => f.field === field && f.value === value,
    );
    const nextFacets = exists
      ? currentFacets
      : [...currentFacets, { field, value }];
    setQuery("");
    navigate(buildHref({ facets: nextFacets, q: null }));
    setOpen(false);
  };

  const removeFacet = (index: number) => {
    navigate(
      buildHref({ facets: currentFacets.filter((_, i) => i !== index) }),
    );
  };

  // Enter applies the default field (Search Tasks → title), matching Odoo's
  // highlighted first row.
  const submitQuery = () => {
    if (query.trim()) addFacet("title");
    else setOpen(false);
  };

  const clearQuery = () => {
    setQuery("");
    navigate(buildHref({ q: null, projectId: null }));
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
      ? "border-white/75 bg-white/95 text-foreground shadow-[0_14px_34px_rgba(20,16,60,0.16)] backdrop-blur-xl dark:border-white/40 dark:bg-white/8 dark:text-white"
      : "border-soft/90 bg-card/95 shadow-[0_12px_28px_rgba(82,65,195,0.08)]";
  const shellOpenClassName =
    variant === "topbar"
      ? "border-white ring-2 ring-primary/20 dark:border-white/65 dark:ring-white/20"
      : "border-cyan/40 ring-2 ring-cyan/15";
  const iconClassName =
    variant === "topbar" ? "text-primary/75 dark:text-white/80" : "text-muted-foreground";
  const inputClassName =
    variant === "topbar"
      ? "text-foreground placeholder:text-muted-foreground/70 dark:text-white dark:placeholder:text-white/60"
      : "text-xs placeholder:text-muted-foreground/60";
  const countClassName =
    variant === "topbar" ? "text-primary/70 dark:text-white/75" : "text-muted-foreground";
  const chevronClassName =
    variant === "topbar" ? "hover:text-primary dark:hover:text-white" : "hover:text-foreground";
  const dropdownClassName =
    variant === "topbar"
      ? "border-soft/80 bg-popover/98 backdrop-blur-xl dark:border-white/15"
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
            variant === "topbar" ? "bg-primary/10 dark:bg-white/10" : "bg-soft-1",
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
        {/* Search facet chips — Rwasem two-segment pill: solid-primary field
            label on the left, white value box on the right. Same look as the
            /projects bar so both pages feel like one product. */}
        {currentFacets.map((facet, i) => (
          <span
            key={`${facet.field}-${facet.value}-${i}`}
            className="inline-flex h-7 items-center overflow-hidden rounded-full bg-white text-[11px] font-medium shadow-[0_1px_0_rgba(0,0,0,0.04)] rtl:flex-row-reverse"
          >
            <span className="flex h-full items-center bg-primary px-2.5 font-semibold text-white">
              {facetFieldLabel(facet.field)}
            </span>
            <span className="flex h-full items-center gap-1.5 bg-white px-2.5 text-primary rtl:flex-row-reverse">
              <span className="max-w-[10rem] truncate">{facetValueLabel(facet.field, facet.value)}</span>
              <button
                type="button"
                onClick={() => removeFacet(i)}
                aria-label={t("aria.removeChip", {
                  label: `${facetFieldLabel(facet.field)}: ${facetValueLabel(facet.field, facet.value)}`,
                })}
                className="text-primary/60 hover:text-primary"
              >
                <X className="size-3.5" />
              </button>
            </span>
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
        {/* Custom-filter pill — clicking the body re-opens the rule dialog. */}
        {customTree && customFilterLabel && (
          <span className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary rtl:flex-row-reverse">
            <Sliders className="size-2.5 shrink-0" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCustomDialogOpen(true);
                setOpen(false);
              }}
              className="truncate hover:underline"
              title={customFilterLabel}
            >
              {customFilterLabel}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearCustomFilter();
              }}
              aria-label={t("aria.removeChip", { label: customFilterLabel })}
              className="shrink-0 opacity-70 hover:opacity-100"
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
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
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
            open && (variant === "topbar" ? "bg-primary/10 text-primary dark:bg-white/10 dark:text-white" : "bg-soft-1 text-cyan"),
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
          {/* Rwasem faceted search — typed text becomes a list of
              field-scoped options. The first row (Search Tasks → title) is
              highlighted and is what Enter applies. */}
          {query.trim().length >= 1 && (
            <div className="border-b border-soft/70 p-2">
              <div className="mb-1 flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold text-muted-foreground rtl:flex-row-reverse">
                <Search className="size-3.5" />
                {t("facets.heading")}
              </div>
              <div className="flex flex-col">
                {FACET_FIELD_DEFS.map((def, i) => (
                  <button
                    key={def.field}
                    type="button"
                    onClick={() => addFacet(def.field)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-right text-xs transition-colors hover:bg-soft-1 rtl:flex-row-reverse",
                      i === 0 && "bg-soft-1",
                    )}
                  >
                    <Search className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 shrink-0 text-muted-foreground">
                      {t("facets.searchFor", {
                        field: facetFieldLabel(def.field),
                      })}
                      {":"}
                    </span>
                    <span className="min-w-0 truncate font-semibold text-primary">
                      {query.trim()}
                    </span>
                  </button>
                ))}
              </div>
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
                {/* Odoo "Add Custom Filter" — opens the rule-builder dialog. */}
                <div className="my-1 border-t border-soft/60" />
                <button
                  type="button"
                  onClick={() => {
                    setCustomDialogOpen(true);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors rtl:flex-row-reverse",
                    customTree
                      ? "bg-primary/10 text-primary"
                      : "text-cyan hover:bg-soft-1",
                  )}
                >
                  <Sliders className="size-3" />
                  {t("cf.addCustomFilter")}
                </button>
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

      {/* Custom-filter dialog — mounted at the search-bar level so its DOM
          isn't inside the popover (dismissed on outside-click). */}
      <CustomFilterDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        fields={taskFields}
        initialTree={customTree}
        includeArchived={currentActive.has("archived")}
        onIncludeArchivedChange={(next) => {
          const f = new Set(currentActive);
          if (next) f.add("archived");
          else f.delete("archived");
          navigate(buildHref({ filters: f }));
        }}
        onApply={applyCustomFilter}
      />
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
