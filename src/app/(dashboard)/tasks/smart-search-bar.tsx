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
  | "critical";
type GroupBy = "stage" | "project" | "priority" | "deadline";
type SearchSuggestion = {
  id: string;
  projectName: string;
  storeName: string | null;
  clientName: string | null;
};

const FILTER_DEFS: { key: FilterKey; label: string }[] = [
  { key: "open", label: "مفتوحة" },
  { key: "mine", label: "مهامي" },
  { key: "due_today", label: "تستحق اليوم" },
  { key: "overdue", label: "متأخرة" },
  { key: "behind", label: "خلف الجدول" },
  { key: "critical", label: "تأخير حرج" },
  { key: "done", label: "مكتملة" },
  { key: "all", label: "كل المهام" },
];

const GROUPBY_DEFS: { key: GroupBy; label: string; available?: boolean }[] = [
  { key: "stage", label: "حسب المرحلة" },
  { key: "project", label: "حسب المشروع" },
  { key: "priority", label: "حسب الأولوية" },
  { key: "deadline", label: "حسب الموعد النهائي" },
];

export type SavedTaskFilter = {
  id: string;
  name: string;
  is_default: boolean;
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
  const currentFilter = (filterKey ?? (params.get("filter") as FilterKey | null) ?? "open");
  const currentView = view ?? params.get("view") ?? "kanban";
  const currentGroupBy = (
    groupBy ??
    ((params.get("groupBy") as GroupBy | null) ?? "stage")
  );
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

  const activeFilter = FILTER_DEFS.find((f) => f.key === currentFilter);

  function buildHref(next: Partial<{
    filter: FilterKey;
    groupBy: GroupBy;
    q: string | null;
    view: string;
    projectId: string | null;
  }>) {
    const sp = new URLSearchParams(params);
    if (next.filter !== undefined) sp.set("filter", next.filter);
    if (next.groupBy !== undefined) sp.set("groupBy", next.groupBy);
    if (next.view !== undefined) sp.set("view", next.view);
    if (next.projectId === null) sp.delete("projectId");
    else if (next.projectId !== undefined) sp.set("projectId", next.projectId);
    if (next.q === null) sp.delete("q");
    else if (next.q !== undefined) sp.set("q", next.q);
    return `${pathname}?${sp.toString()}`;
  }

  const navigate = (href: string) => {
    start(() => router.push(href));
  };

  const submitQuery = () => {
    const trimmed = query.trim();
    navigate(buildHref({ q: trimmed || null, projectId: null }));
    setOpen(false);
  };

  const clearFilter = () => {
    navigate(buildHref({ filter: "all" }));
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
    "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors";

  // Memoize column pills so re-renders don't churn on every keystroke.
  const filterColumn = useMemo(
    () =>
      FILTER_DEFS.map((f) => {
        const active = f.key === currentFilter;
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
    [currentFilter, params.toString()],
  );

  const groupColumn = useMemo(
    () =>
      GROUPBY_DEFS.map((g) => {
        const active = g.key === currentGroupBy;
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
    [currentGroupBy, params.toString()],
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
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
          shellClassName,
          open && shellOpenClassName,
        )}
      >
        <Search className={cn("size-3.5 shrink-0", iconClassName)} />
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
          className={cn("min-w-0 flex-1 bg-transparent focus:outline-none", inputClassName)}
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
        <div className={cn("absolute end-0 start-0 top-[calc(100%+6px)] z-30 rounded-2xl border p-3 shadow-2xl", dropdownClassName)}>
          {(loadingSuggestions || suggestions.length > 0) && (
            <div className="mb-3 rounded-xl border border-soft bg-soft-1/40 p-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Search className="size-3.5" />
                اقتراحات المشروع والمتجر
              </div>
              <div className="flex flex-col gap-1">
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseSuggestion(item)}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-start text-xs transition-colors hover:bg-soft-1"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <Briefcase className="size-3.5 shrink-0 text-cyan" />
                        <span className="truncate">{item.projectName}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
              <SavedFiltersColumn
                items={filters}
                currentDefinition={{
                  filter: currentFilter,
                  q: currentQuery || undefined,
                  view: currentView,
                  groupBy: currentGroupBy,
                  projectId: params.get("projectId") || undefined,
                }}
                onApply={(def) => {
                  const url = new URLSearchParams();
                  if (def.filter) url.set("filter", def.filter);
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
  const [pending, start] = useTransition();

  const handleSave = () =>
    start(async () => {
      const trimmed = name.trim();
      if (!trimmed) return toast.error("اكتب اسمًا للفلتر");
      const res = await saveTaskFilterAction({
        name: trimmed,
        definition: currentDefinition,
      });
      if ("error" in res) return toast.error(res.error);
      toast.success("تم حفظ الفلتر");
      setName("");
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
      <div className="flex items-center gap-1">
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
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-soft px-2 py-3 text-center text-[11px] text-muted-foreground/80">
          لا توجد فلاتر محفوظة
        </div>
      ) : (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {items.map((it) => (
            <li
              key={it.id}
              className="group flex items-center gap-1 rounded-md px-1 py-1 text-xs hover:bg-soft-1"
            >
              <button
                type="button"
                onClick={() => onApply(it.definition)}
                className="min-w-0 flex-1 truncate text-start"
                title={JSON.stringify(it.definition)}
              >
                {it.name}
              </button>
              <button
                type="button"
                onClick={() => toggleDefault(it)}
                disabled={pending}
                title={it.is_default ? "افتراضي" : "اجعله افتراضيًا"}
                className={cn(
                  "shrink-0 rounded p-1 hover:bg-background",
                  it.is_default ? "text-amber" : "text-muted-foreground/60",
                )}
              >
                <Star className={cn("size-3", it.is_default && "fill-current")} />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(it.id)}
                disabled={pending}
                title="حذف"
                className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-cc-red group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
