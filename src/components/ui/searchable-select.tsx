"use client";

// Lightweight searchable select / multi-select.
// No cmdk dep — uses Popover + plain filter. Renders a hidden <input> per
// selected value so the parent <form> picks them up natively (no need to
// wire formData manually).

import * as React from "react";
import { Check, ChevronDown, Search, X, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label: string;
  hint?: string | null;
};

type SingleProps = {
  multi?: false;
  name?: string;
  value: string;
  onValueChange: (next: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Called when user clicks "+ Add new" (e.g. open inline create dialog). */
  onCreateNew?: (query: string) => void;
  createLabel?: string;
  ariaLabel?: string;
  /** Show an explicit "clear selection" row (e.g. "بدون مشروع") when a value
   *  is set — single-select has no other way back to the empty state. */
  clearable?: boolean;
  clearLabel?: string;
};

type MultiProps = {
  multi: true;
  name?: string;
  value: string[];
  onValueChange: (next: string[]) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  onCreateNew?: (query: string) => void;
  createLabel?: string;
  ariaLabel?: string;
};

type Props = SingleProps | MultiProps;

export function SearchableSelect(props: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [props.options, query]);

  const selectedSingle = !props.multi
    ? props.options.find((o) => o.value === props.value)
    : null;
  const selectedMulti = props.multi
    ? props.options.filter((o) => props.value.includes(o.value))
    : [];

  const triggerLabel = !props.multi
    ? selectedSingle?.label ?? props.placeholder ?? "—"
    : selectedMulti.length === 0
      ? props.placeholder ?? "—"
      : `${selectedMulti.length} مختار`;

  const handlePick = (val: string) => {
    if (!props.multi) {
      props.onValueChange(val);
      setOpen(false);
      setQuery("");
    } else {
      const has = props.value.includes(val);
      props.onValueChange(
        has ? props.value.filter((v) => v !== val) : [...props.value, val],
      );
    }
  };

  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div className={cn("relative", props.className)}>
      {/* Hidden inputs for native form integration. */}
      {props.name && !props.multi && (
        <input
          type="hidden"
          name={props.name}
          value={props.value || ""}
          required={props.required}
        />
      )}
      {props.name && props.multi && (
        <>
          {props.value.map((v) => (
            <input key={v} type="hidden" name={props.name} value={v} />
          ))}
        </>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          // Critical: PopoverTrigger renders as <button> and inherits the
          // HTML default `type="submit"` when inside a <form>. That meant
          // clicking the trigger to OPEN a select was also submitting the
          // parent form. type="button" stops that.
          type="button"
          disabled={props.disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-input px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
            !props.multi && !selectedSingle && "text-muted-foreground",
            props.multi && selectedMulti.length === 0 && "text-muted-foreground",
          )}
          aria-label={props.ariaLabel}
        >
          <span className="truncate text-start">{triggerLabel}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[--radix-popover-trigger-width] min-w-[260px] p-0"
        >
          <div className="flex items-center gap-2 border-b border-soft px-2 py-1.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Critical: this input lives inside a parent <form>. The
                // browser's "single text input → Enter submits" rule would
                // accidentally fire the form action when the user just
                // wanted to confirm a search. Pick the top match (or close
                // the popup) instead of bubbling the Enter up.
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (filtered.length > 0) {
                    handlePick(filtered[0].value);
                  } else {
                    setOpen(false);
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={props.searchPlaceholder ?? "ابحث…"}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {!props.multi && props.clearable && props.value && (
              <button
                type="button"
                onClick={() => handlePick("")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm text-muted-foreground transition-colors hover:bg-soft-1"
              >
                <X className="size-4 shrink-0 opacity-70" />
                <span className="truncate">{props.clearLabel ?? "بدون تحديد"}</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {props.emptyMessage ?? "لا توجد نتائج"}
              </div>
            ) : (
              filtered.map((o) => {
                const selected = !props.multi
                  ? props.value === o.value
                  : props.value.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => handlePick(o.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-sm transition-colors hover:bg-soft-1",
                      selected && "bg-cyan-dim text-cyan",
                    )}
                  >
                    <span className="flex flex-col items-start truncate">
                      <span className="truncate">{o.label}</span>
                      {o.hint && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {o.hint}
                        </span>
                      )}
                    </span>
                    {selected && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          {props.onCreateNew && (
            <button
              type="button"
              onClick={() => {
                props.onCreateNew?.(query);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-soft px-3 py-2 text-start text-sm text-cyan transition-colors hover:bg-cyan-dim/40"
            >
              <Plus className="size-4" />
              {props.createLabel ?? "إضافة جديد"}
              {query && (
                <span className="ms-auto truncate text-xs text-muted-foreground">
                  «{query}»
                </span>
              )}
            </button>
          )}
        </PopoverContent>
      </Popover>

      {props.multi && selectedMulti.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selectedMulti.map((s) => (
            <span
              key={s.value}
              className="inline-flex items-center gap-1 rounded-full bg-cyan-dim px-2 py-0.5 text-[11px] text-cyan"
            >
              {s.label}
              <button
                type="button"
                onClick={() => handlePick(s.value)}
                className="opacity-70 hover:opacity-100"
                aria-label={`إزالة ${s.label}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
