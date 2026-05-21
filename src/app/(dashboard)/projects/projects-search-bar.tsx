"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Check,
  Filter,
  Search,
  X,
  Star,
  Layers,
  Plus,
  Sliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { decodeProjectFacets, PROJECT_FACET_FIELDS } from "./_facets";
import type { ProjectSearchFacet, ProjectSearchFacetField } from "@/lib/data/projects";
import { CustomFilterDialog } from "@/components/custom-filter/dialog";
import { buildProjectFields } from "@/lib/custom-filter/projects-fields";
import {
  URL_PARAM as CF_URL_PARAM,
  encodeFilterToUrl,
  decodeFilterFromUrl,
} from "@/lib/custom-filter/url-state";
import { formatFilterTree } from "@/lib/custom-filter/format-pill";
import type { FilterTree } from "@/lib/custom-filter/types";

// All filter keys are URL-driven so the dropdown is fully bookmark/share-able.
type BoolFilterKey =
  | "onlyMine"
  | "onlyFavorites"
  | "onlyUnassigned"
  | "onlyWithCategories"
  | "onlyWithManager"
  | "archived"
  // Sky Light feedback follow-up: parity with Odoo's projects search-view.
  // These map to: tasks have >100% timesheet vs allocated; all linked
  // categories are archived (no active package); project has any task
  // sub-resource (Rwasem extension showing only "active" projects).
  | "overTimesheets"
  | "allCategoriesArchived";

type GroupKey =
  | ""
  | "project_manager"
  | "status"
  | "tags"
  // Add-Custom-Group options. Each one is wired in projects-board.tsx so the
  // kanban view actually clusters by the chosen dimension.
  | "account_manager"
  | "client"
  | "target"
  | "start_month"
  | "end_month";

const BOOL_FILTERS: { key: BoolFilterKey; labelKey: string; section: "primary" | "custom" }[] = [
  { key: "onlyMine", labelKey: "boolFilters.onlyMine", section: "primary" },
  { key: "onlyFavorites", labelKey: "boolFilters.onlyFavorites", section: "primary" },
  { key: "onlyUnassigned", labelKey: "boolFilters.onlyUnassigned", section: "primary" },
  { key: "onlyWithCategories", labelKey: "boolFilters.onlyWithCategories", section: "primary" },
  { key: "archived", labelKey: "boolFilters.archived", section: "primary" },
  { key: "onlyWithManager", labelKey: "boolFilters.onlyWithManager", section: "custom" },
  { key: "overTimesheets", labelKey: "boolFilters.overTimesheets", section: "custom" },
  { key: "allCategoriesArchived", labelKey: "boolFilters.allCategoriesArchived", section: "custom" },
];

const GROUP_OPTIONS: { key: GroupKey; labelKey: string; section: "primary" | "custom" }[] = [
  { key: "project_manager", labelKey: "groupOptions.projectManager", section: "primary" },
  { key: "status", labelKey: "groupOptions.status", section: "primary" },
  { key: "tags", labelKey: "groupOptions.tags", section: "primary" },
  { key: "account_manager", labelKey: "groupOptions.accountManager", section: "custom" },
  { key: "client", labelKey: "groupOptions.client", section: "custom" },
  { key: "target", labelKey: "groupOptions.target", section: "custom" },
  { key: "start_month", labelKey: "groupOptions.startMonth", section: "custom" },
  { key: "end_month", labelKey: "groupOptions.endMonth", section: "custom" },
];

// Filters that are ON by default (parity with Odoo's default search facets).
// They stay on unless the URL explicitly carries `?<key>=0`.
const DEFAULT_ON_FILTERS: Partial<Record<BoolFilterKey, boolean>> = {
  onlyWithCategories: true,
};

function isEnabled(value: string | null, key?: BoolFilterKey) {
  if (value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  return key ? Boolean(DEFAULT_ON_FILTERS[key]) : false;
}

export function ProjectsSearchBar() {
  const t = useTranslations("ProjectsSearch");
  const customFilterT = useTranslations("CustomFilter");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const currentQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(currentQuery);
  const [open, setOpen] = useState(false);

  const projectFields = useMemo(() => buildProjectFields(t), [t]);
  const projectFieldMap = useMemo(
    () => Object.fromEntries(projectFields.map((field) => [field.name, field])),
    [projectFields],
  );
  const getProjectField = useCallback(
    (name: string) => projectFieldMap[name],
    [projectFieldMap],
  );
  const boolFilters = useMemo(
    () => BOOL_FILTERS.map((f) => ({ key: f.key, label: t(f.labelKey), section: f.section })),
    [t],
  );
  const boolFiltersPrimary = boolFilters.filter((f) => f.section === "primary");
  const boolFiltersCustom = boolFilters.filter((f) => f.section === "custom");
  const groupOptions = useMemo(
    () => GROUP_OPTIONS.map((g) => ({ key: g.key, label: t(g.labelKey), section: g.section })),
    [t],
  );
  const groupOptionsPrimary = groupOptions.filter((g) => g.section === "primary");
  const groupOptionsCustom = groupOptions.filter((g) => g.section === "custom");

  const filters = useMemo(() => {
    const out = {} as Record<BoolFilterKey, boolean>;
    for (const f of boolFilters) out[f.key] = isEnabled(params.get(f.key), f.key);
    return out;
  }, [boolFilters, params]);
  const activeFilterKeys = boolFilters.filter(({ key }) => filters[key]).map(
    ({ key }) => key,
  );
  // Custom-section expanders. Auto-open when a "custom" item is active so
  // the user can see what they've toggled on a fresh popup open.
  const customFilterActive = boolFiltersCustom.some(({ key }) => filters[key]);
  const customGroupActive = groupOptionsCustom.some(
    ({ key }) => (params.get("groupBy") ?? "") === key,
  );
  const [customFilterOpen, setCustomFilterOpen] = useState(customFilterActive);
  const [customGroupOpen, setCustomGroupOpen] = useState(customGroupActive);

  // ── Custom Filter (Odoo-style rule builder) ───────────────────────────
  // The whole tree lives in `?cf=<base64-json>` so reloads + share-links
  // preserve it. `customTree` is the decoded form for rendering.
  const customTreeRaw = params.get(CF_URL_PARAM);
  const customTree: FilterTree | null = useMemo(
    () => decodeFilterFromUrl(customTreeRaw),
    [customTreeRaw],
  );
  // Relational pill labels — resolve UUIDs to names so the pill reads
  // "Project Manager is in ( احمد حبيب )" instead of "( 2f5441e2-… )".
  // Walks the tree once on each change, collects (model, id) pairs, fetches
  // them in batched requests per model, caches in a Map for repeat renders.
  const [relationLabels, setRelationLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!customTree) return;
    type Pair = { model: string; id: string };
    const pairs: Pair[] = [];
    const walk = (nodes: typeof customTree.children) => {
      for (const n of nodes) {
        if (n.type === "group") walk(n.children);
        else {
          const f = getProjectField(n.field);
          if (!f || f.kind !== "relational" || !f.relation) continue;
          const ids = Array.isArray(n.value) ? (n.value as string[]) : n.value ? [n.value as string] : [];
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
  }, [customTree, getProjectField, relationLabels]);

  const customFilterLabel = useMemo(() => {
    if (!customTree) return "";
    return formatFilterTree(
      customTree,
      getProjectField,
      (_model, id) => relationLabels[id],
      {
        operatorLabel: (op) => customFilterT(`operators.${{
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
        }[op]}`),
        booleanTrue: customFilterT("boolean.true"),
        booleanFalse: customFilterT("boolean.false"),
        and: customFilterT("connectors.and"),
        or: customFilterT("connectors.or"),
      },
    );
  }, [customFilterT, customTree, getProjectField, relationLabels]);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const startDateFrom = params.get("startDateFrom") ?? "";
  const startDateTo = params.get("startDateTo") ?? "";
  const endDateFrom = params.get("endDateFrom") ?? "";
  const endDateTo = params.get("endDateTo") ?? "";
  const groupBy = (params.get("groupBy") ?? "") as GroupKey;

  // Rwasem-style facets, decoded from `?sf=` JSON. Invalid entries are dropped
  // so a hand-edited URL doesn't crash the bar.
  const currentFacets = useMemo<ProjectSearchFacet[]>(
    () => decodeProjectFacets(params.get("sf")),
    [params],
  );
  const facetFieldLabel = useCallback(
    (field: ProjectSearchFacetField) => t(`facets.fields.${field}`),
    [t],
  );

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

  // Note: typed text is no longer auto-committed to `?q=`. The Rwasem flow is
  // that text becomes a facet chip (Enter, or click a "Search X for: …" row).
  // Saved searches with `?q=` still apply on initial load because page.tsx
  // reads sp.q directly; we just don't write to it during a typing session.

  const updateParams = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(params.toString());
    mutate(sp);
    router.replace(sp.toString() ? `${pathname}?${sp.toString()}` : pathname);
  };

  const toggleFilter = (key: BoolFilterKey) => {
    updateParams((sp) => {
      const enabled = isEnabled(sp.get(key), key);
      if (DEFAULT_ON_FILTERS[key]) {
        // Default-on filter: explicit `=0` disables it; removing the param
        // reverts to the on-by-default state.
        if (enabled) sp.set(key, "0");
        else sp.delete(key);
      } else if (enabled) {
        sp.delete(key);
      } else {
        sp.set(key, "1");
      }
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
    updateParams((sp) => {
      // Removing a default-on filter's chip means "turn it off", which needs
      // an explicit `=0` (a bare delete would just revert it back to on).
      if (DEFAULT_ON_FILTERS[key]) sp.set(key, "0");
      else sp.delete(key);
    });
  };

  const clearAllFilters = () => {
    updateParams((sp) => {
      for (const { key } of boolFilters) sp.delete(key);
      sp.delete("startDateFrom");
      sp.delete("startDateTo");
      sp.delete("endDateFrom");
      sp.delete("endDateTo");
      sp.delete("groupBy");
      sp.delete(CF_URL_PARAM);
    });
  };

  const applyCustomFilter = (tree: FilterTree | null) => {
    updateParams((sp) => {
      if (tree && tree.children.length > 0) {
        sp.set(CF_URL_PARAM, encodeFilterToUrl(tree));
      } else {
        sp.delete(CF_URL_PARAM);
      }
    });
  };

  const clearCustomFilter = () => {
    updateParams((sp) => sp.delete(CF_URL_PARAM));
  };

  const clearQuery = () => {
    setQuery("");
    updateParams((sp) => sp.delete("q"));
  };

  // Append a facet for the typed text. Dedup matches Rwasem (same field+value
  // is a no-op). Stale free-text `q` is dropped so both search models don't
  // apply at once.
  const addFacet = (field: ProjectSearchFacetField) => {
    const value = query.trim();
    if (!value) return;
    const exists = currentFacets.some((f) => f.field === field && f.value === value);
    const next = exists ? currentFacets : [...currentFacets, { field, value }];
    setQuery("");
    setOpen(false);
    updateParams((sp) => {
      sp.delete("q");
      if (next.length === 0) sp.delete("sf");
      else sp.set("sf", JSON.stringify(next));
    });
  };

  const removeFacet = (index: number) => {
    const next = currentFacets.filter((_, i) => i !== index);
    updateParams((sp) => {
      if (next.length === 0) sp.delete("sf");
      else sp.set("sf", JSON.stringify(next));
    });
  };

  const labelOf = (key: BoolFilterKey) =>
    boolFilters.find((f) => f.key === key)?.label ?? key;

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
          aria-label={t("aria.projectFilters")}
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
            {t("chips.dateFilter")}
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
            {t("chips.groupedBy", {
              label: groupOptions.find((g) => g.key === groupBy)?.label ?? groupBy,
            })}
            <button
              type="button"
              onClick={() => setGroup("")}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        {/* Custom-filter pill — clicking the body re-opens the rule dialog. */}
        {customTree && customFilterLabel && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/15 px-2 py-0.5 text-[11px] font-medium text-violet-100">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCustomDialogOpen(true);
                setOpen(false);
              }}
              className="hover:underline"
              title={t("actions.editCustomFilter")}
            >
              {customFilterLabel}
            </button>
            <button
              type="button"
              aria-label="إزالة الفلتر المخصص"
              onClick={(event) => {
                event.stopPropagation();
                clearCustomFilter();
              }}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        )}

        {/* Search facet chips — Rwasem two-segment pill: solid-purple field
            label on the left, white value box on the right, × outside the
            white box (sits on the bar background). */}
        {currentFacets.map((facet, i) => (
          <span
            key={`${facet.field}-${facet.value}-${i}`}
            className="inline-flex h-7 items-center overflow-hidden rounded-full bg-white text-[11px] font-medium shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          >
            <span className="flex h-full items-center bg-primary px-2.5 font-semibold text-white">
              {facetFieldLabel(facet.field)}
            </span>
            <span className="flex h-full items-center gap-1.5 bg-white px-2.5 text-primary">
              <span className="max-w-[10rem] truncate">{facet.value}</span>
              <button
                type="button"
                onClick={() => removeFacet(i)}
                aria-label={`${facetFieldLabel(facet.field)}: ${facet.value}`}
                className="text-primary/60 hover:text-primary"
              >
                <X className="size-3.5" />
              </button>
            </span>
          </span>
        ))}
        <Search className="size-3.5 shrink-0 text-white/80" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && query.trim()) {
              // Enter applies the highlighted (first) row — Search by name.
              event.preventDefault();
              addFacet("name");
            }
          }}
          placeholder={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-white placeholder:text-white/60 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label={t("aria.clearSearch")}
            className="text-white/80 transition-colors hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("aria.openProjectOptions")}
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
        <div className="absolute end-0 top-[calc(100%+6px)] z-30 w-[min(96vw,720px)] rounded-2xl border border-soft bg-popover p-4 shadow-2xl">
          {/* Rwasem faceted search — typed text becomes a list of
              field-scoped options. First row is highlighted; Enter applies
              that one (Search by name), click picks any. */}
          {query.trim().length >= 1 && (
            <div className="mb-3 border-b border-soft pb-2">
              <div className="mb-1 flex items-center gap-1.5 px-1 pb-1 text-[11px] font-semibold text-muted-foreground">
                <Search className="size-3.5" />
                {t("facets.heading")}
              </div>
              <div className="flex flex-col">
                {PROJECT_FACET_FIELDS.map((field, i) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => addFacet(field)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-soft-1",
                      i === 0 && "bg-soft-1",
                    )}
                  >
                    <Search className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 shrink-0 text-muted-foreground">
                      {t("facets.searchFor", { field: facetFieldLabel(field) })}
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            {/* Filters column */}
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Filter className="size-3.5" /> {t("columns.filters")}
              </div>
              <div className="flex flex-col gap-0.5">
                {boolFiltersPrimary.map((f) => (
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
                {/* Real "Add Custom Filter" (Odoo parity): opens the rule
                    builder dialog. Independent of the boolean-shortcuts
                    expander below. */}
                <button
                  type="button"
                  onClick={() => {
                    setCustomDialogOpen(true);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-cyan transition-colors hover:bg-cyan-dim"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Sliders className="size-3" /> {t("actions.addCustomFilter")}
                  </span>
                </button>
                <div className="my-1 border-t border-soft" />
                {/* Boolean-shortcuts expander — pre-built filters that used to
                    be hidden under "Add Custom Filter". Kept for muscle
                    memory but renamed to disambiguate from the real custom
                    filter above. */}
                <button
                  type="button"
                  onClick={() => setCustomFilterOpen((v) => !v)}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground"
                  aria-expanded={customFilterOpen}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Plus className="size-3" /> {t("actions.moreFilters")}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      customFilterOpen && "rotate-180",
                    )}
                  />
                </button>
                {customFilterOpen && (
                  <div className="ms-2 me-0 flex flex-col gap-0.5 border-s border-soft ps-2">
                    {boolFiltersCustom.map((f) => (
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
                  </div>
                )}
                <div className="my-2 border-t border-soft" />
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("dateSections.startDate")}
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
                  {t("dateSections.endDate")}
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
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Layers className="size-3.5" /> {t("columns.groupBy")}
              </div>
              <div className="flex flex-col gap-0.5">
                {groupOptionsPrimary.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGroup(groupBy === g.key ? "" : g.key)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                      groupBy === g.key
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-200"
                        : "text-foreground hover:bg-soft-1",
                    )}
                  >
                    <span>{g.label}</span>
                    {groupBy === g.key && <Check className="size-3.5" />}
                  </button>
                ))}
                {/* Add Custom Group — direct parity with Odoo's
                    `rwasem_*` project search-view. Expander reveals extra
                    group-by dimensions (Account Manager, Client, Target,
                    Start/End Month). Each one is wired through to
                    projects-board.tsx's bucket() switch. */}
                <button
                  type="button"
                  onClick={() => setCustomGroupOpen((v) => !v)}
                  className="mt-1 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground"
                  aria-expanded={customGroupOpen}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Plus className="size-3" /> {t("actions.addCustomGroup")}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      customGroupOpen && "rotate-180",
                    )}
                  />
                </button>
                {customGroupOpen && (
                  <div className="ms-2 me-0 flex flex-col gap-0.5 border-s border-soft ps-2">
                    {groupOptionsCustom.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setGroup(groupBy === g.key ? "" : g.key)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                          groupBy === g.key
                            ? "bg-amber-500/20 text-amber-700 dark:text-amber-200"
                            : "text-foreground hover:bg-soft-1",
                        )}
                      >
                        <span>{g.label}</span>
                        {groupBy === g.key && <Check className="size-3.5" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Favorites / quick saves column */}
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Star className="size-3.5" /> {t("columns.favorites")}
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
                <span>{t("favorites.copyCurrentSearchUrl")}</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
              <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted-foreground">
                {t("favorites.help")}
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
                {t("actions.clearAllFilters")}
              </button>
            </>
          )}
        </div>
      )}

      {/* Custom-filter dialog — mounted at the search bar level so its DOM
          isn't inside the popover (which gets dismissed on outside-click). */}
      <CustomFilterDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        fields={projectFields}
        initialTree={customTree}
        includeArchived={filters.archived}
        onIncludeArchivedChange={(next) => {
          updateParams((sp) => {
            if (next) sp.set("archived", "1");
            else sp.delete("archived");
          });
        }}
        onApply={applyCustomFilter}
      />
    </div>
  );
}
