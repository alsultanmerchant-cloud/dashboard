"use client";

// =========================================================================
// EmployeeCombobox — reusable typeahead employee picker (Sky Light issue #9).
//
// Client feedback: "محتاجين اوبشن كتابة هنا عشان نوصل للاسماء اسرع لان عدد
// الموظفين كبير" — long static <select> lists were unusable once the employee
// count grew. This component replaces them with a search-as-you-type widget
// (Odoo many2one "زي رواسم" reference).
//
// Two selection modes via the `multiple` discriminated prop:
//   - single  (default)  → value: string | null,  onChange: (string|null)
//   - multiple            → value: string[],       onChange: (string[])
//
// Single mode renders the picked employee inside the trigger; multiple mode
// renders removable chips below the trigger (relational-picker style).
//
// An optional `name` renders hidden <input>(s) so the picker works inside a
// native <form> with no extra formData wiring (one input in single mode, one
// per selected id in multiple mode).
//
// States: skeleton (loading), empty (no employees), error (load failure),
// no-results (search miss). RTL-correct, Tajawal inherited from <body>.
// =========================================================================

import * as React from "react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Search,
  UserMinus,
  Users,
  X,
  AlertCircle,
} from "lucide-react";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type EmployeeComboboxOption = {
  /** Stable id submitted as the value (employee_id or user_id — caller's choice). */
  id: string;
  full_name: string;
  job_title?: string | null;
  department_name?: string | null;
  avatar_url?: string | null;
  /** When true, the row is shown but cannot be picked (e.g. employee w/o user). */
  disabled?: boolean;
};

type CommonProps = {
  options: EmployeeComboboxOption[];
  /** Hidden <input name> for native <form> integration. Omit for state-only use. */
  name?: string;
  /** Marks the hidden input as required (only meaningful with `name`). */
  required?: boolean;
  disabled?: boolean;
  /** When true, render a skeleton instead of the trigger (async option loads). */
  loading?: boolean;
  /** When set, render an error row in place of the list. */
  error?: string | null;
  className?: string;
  /** i18n strings — every label is caller-supplied so the component carries no
   *  hardcoded copy. All have Arabic-first defaults. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  ariaLabel?: string;
};

type SingleProps = CommonProps & {
  multiple?: false;
  /** Selected option id, or "" / null when nothing is picked. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Allow clearing the selection back to null. Defaults to true. */
  clearable?: boolean;
  clearLabel?: string;
};

type MultiProps = CommonProps & {
  multiple: true;
  /** Selected option ids. */
  value: string[];
  onChange: (next: string[]) => void;
};

export type EmployeeComboboxProps = SingleProps | MultiProps;

export function EmployeeCombobox(props: EmployeeComboboxProps) {
  const {
    options,
    name,
    required,
    disabled,
    loading = false,
    error = null,
    className,
    placeholder = "اختر موظفًا",
    searchPlaceholder = "ابحث بالاسم أو الوظيفة…",
    emptyMessage = "لا يوجد موظفون",
    noResultsMessage = "لا توجد نتائج",
    ariaLabel = "اختيار موظف",
  } = props;
  const multiple = props.multiple === true;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Normalised selection set — works for both modes.
  const selectedIds = React.useMemo<string[]>(
    () =>
      multiple
        ? (props.value as string[])
        : props.value
          ? [props.value as string]
          : [],
    [multiple, props.value],
  );

  const selectedOptions = React.useMemo(
    () =>
      selectedIds
        .map((id) => options.find((o) => o.id === id))
        .filter(Boolean) as EmployeeComboboxOption[],
    [selectedIds, options],
  );
  const singleSelected = !multiple ? (selectedOptions[0] ?? null) : null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.full_name.toLowerCase().includes(q) ||
        (o.job_title ?? "").toLowerCase().includes(q) ||
        (o.department_name ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  // Keep the keyboard cursor inside the filtered range.
  React.useEffect(() => {
    setActiveIndex((i) =>
      Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)),
    );
  }, [filtered.length]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  function emitSingle(next: string | null) {
    (props as SingleProps).onChange(next);
    setOpen(false);
    setQuery("");
  }

  function emitMulti(next: string[]) {
    (props as MultiProps).onChange(next);
    // Keep the popover open in multi-select so several picks are quick.
    setQuery("");
    inputRef.current?.focus({ preventScroll: true });
  }

  function pick(option: EmployeeComboboxOption) {
    if (option.disabled) return;
    if (multiple) {
      const has = selectedIds.includes(option.id);
      emitMulti(
        has
          ? selectedIds.filter((v) => v !== option.id)
          : [...selectedIds, option.id],
      );
    } else {
      emitSingle(option.id);
    }
  }

  function remove(id: string) {
    if (multiple) {
      emitMulti(selectedIds.filter((v) => v !== id));
    } else {
      emitSingle(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery("");
      return;
    }
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      // Critical: this input can live inside a parent <form>. Stop the
      // browser's "single text input → Enter submits" rule from firing the
      // form action; pick the highlighted candidate instead.
      e.preventDefault();
      e.stopPropagation();
      const target = filtered[activeIndex];
      if (target) pick(target);
    }
  }

  // -- Skeleton state ------------------------------------------------------
  if (loading) {
    return (
      <div className={cn("relative", className)}>
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  const clearable = multiple
    ? false
    : (props as SingleProps).clearable !== false;
  const clearLabel = !multiple
    ? ((props as SingleProps).clearLabel ?? "بدون تعيين")
    : "";

  const triggerLabel = multiple
    ? selectedOptions.length === 0
      ? placeholder
      : `${selectedOptions.length} مختار`
    : (singleSelected?.full_name ?? placeholder);

  return (
    <div className={cn("relative", className)}>
      {/* Hidden inputs for native <form> integration. */}
      {name && !multiple && (
        <input
          type="hidden"
          name={name}
          value={(props.value as string | null) ?? ""}
          required={required}
        />
      )}
      {name &&
        multiple &&
        selectedIds.map((id) => (
          <input key={id} type="hidden" name={name} value={id} />
        ))}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
          selectedOptions.length === 0 && "text-muted-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {!multiple && singleSelected ? (
            <Avatar size="sm" className="shrink-0">
              {singleSelected.avatar_url ? (
                <AvatarImage src={singleSelected.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="text-[10px]">
                {singleSelected.full_name[0]}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Users className="size-4 shrink-0 opacity-60" />
          )}
          <span className="truncate text-start">{triggerLabel}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
      </button>

      {/* Multi-select chips. */}
      {multiple && selectedOptions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selectedOptions.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-full bg-cyan-dim px-2 py-0.5 text-[11px] font-medium text-cyan"
            >
              {o.full_name}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(o.id)}
                className="opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
                aria-label={`إزالة ${o.full_name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
        align="start"
        className="z-50 w-80 max-w-[92vw] overflow-hidden rounded-xl border border-soft bg-card shadow-2xl shadow-black/30"
      >
        <div role="dialog" aria-label={ariaLabel}>
          {/* Search row */}
          <div className="flex items-center gap-2 border-b border-soft px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label={searchPlaceholder}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="مسح البحث"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Clear-selection row (single mode only) */}
          {clearable && !multiple && (
            <div className="border-b border-soft px-2.5 py-1">
              <button
                type="button"
                onClick={() => emitSingle(null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs transition-colors hover:bg-soft-2",
                  selectedIds.length === 0 && "bg-cyan-dim/60 text-foreground",
                )}
              >
                <UserMinus className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{clearLabel}</span>
                {selectedIds.length === 0 && (
                  <Check className="ms-auto size-3.5 shrink-0" />
                )}
              </button>
            </div>
          )}

          {/* List / error / empty / no-results */}
          {error ? (
            <div className="flex items-start gap-2 px-3 py-4 text-xs text-cc-red">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : options.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
              <Users className="size-5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{emptyMessage}</p>
            </div>
          ) : (
            <ul
              role="listbox"
              aria-label={ariaLabel}
              aria-multiselectable={multiple || undefined}
              className="max-h-64 overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {noResultsMessage}
                </li>
              ) : (
                filtered.map((o, idx) => {
                  const isActive = idx === activeIndex;
                  const isSelected = selectedIds.includes(o.id);
                  return (
                    <li key={o.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        disabled={o.disabled}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => pick(o)}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                          isActive
                            ? "bg-cyan-dim/60 text-foreground"
                            : "hover:bg-soft-2",
                        )}
                      >
                        <Avatar size="sm" className="shrink-0">
                          {o.avatar_url ? (
                            <AvatarImage src={o.avatar_url} alt="" />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {o.full_name[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {o.full_name}
                          </span>
                          {(o.job_title || o.department_name) && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {o.job_title}
                              {o.job_title && o.department_name ? " · " : ""}
                              {o.department_name}
                            </span>
                          )}
                        </span>
                        {isSelected && (
                          <Check className="size-4 shrink-0 text-cyan" />
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}

          <div className="border-t border-soft px-2.5 py-1.5 text-[10px] text-muted-foreground">
            {filtered.length}
          </div>
        </div>
      </AnchoredPopover>
    </div>
  );
}

/** Convenience skeleton export for callers fetching options async. */
export function EmployeeComboboxSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Loader2 className="sr-only" aria-hidden />
    </div>
  );
}
