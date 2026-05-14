"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Chip multi-select with async autocomplete — used as the value widget for
// relational filters (Project Manager, Client, …). Behaviour mirrors the
// Odoo many2one widget:
//   - Single text input. Click to open dropdown.
//   - Typing debounces a fetch and updates the dropdown.
//   - Selecting an option adds a chip and clears the input.
//   - Each chip has × to remove.
//   - `multiple={false}` collapses to single-select (used for `=` / `!=`).

type OptionRow = { id: string; label: string; sublabel?: string | null };

export function RelationalPicker({
  model,
  values,
  onChange,
  multiple = true,
  placeholder = "Search…",
}: {
  model: string;
  values: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [resolvedById, setResolvedById] = useState<Record<string, OptionRow>>({});
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Resolve labels for the currently-selected IDs so chips can render their
  // names on first paint without a user gesture.
  useEffect(() => {
    const missing = values.filter((id) => !resolvedById[id]);
    if (missing.length === 0) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/custom-filter/options?model=${encodeURIComponent(model)}&ids=${missing.join(",")}`,
          { signal: ctrl.signal, credentials: "include" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { items: OptionRow[] };
        setResolvedById((prev) => {
          const next = { ...prev };
          for (const item of json.items) next[item.id] = item;
          return next;
        });
      } catch {
        /* aborted or network — silent */
      }
    })();
    return () => ctrl.abort();
  }, [values, model, resolvedById]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/custom-filter/options?model=${encodeURIComponent(model)}&q=${encodeURIComponent(input)}`,
          { signal: ctrl.signal, credentials: "include" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { items: OptionRow[] };
        setOptions(json.items);
        // Backfill resolved labels for any results we see.
        setResolvedById((prev) => {
          const next = { ...prev };
          for (const item of json.items) next[item.id] = item;
          return next;
        });
      } catch {
        /* silent */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [input, model, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const visibleOptions = useMemo(
    () => options.filter((opt) => !values.includes(opt.id)),
    [options, values],
  );

  const addId = (id: string) => {
    if (values.includes(id)) return;
    onChange(multiple ? [...values, id] : [id]);
    setInput("");
    if (!multiple) setOpen(false);
    inputRef.current?.focus();
  };

  const removeId = (id: string) => {
    onChange(values.filter((v) => v !== id));
  };

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-soft bg-card/50 px-2 py-1 text-xs transition-colors",
        open && "border-cyan",
      )}
      onClick={() => {
        setOpen(true);
        inputRef.current?.focus();
      }}
    >
      {values.map((id) => {
        const label = resolvedById[id]?.label ?? id.slice(0, 8);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-cyan-dim px-2 py-0.5 text-[11px] font-medium text-cyan"
          >
            {label}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removeId(id);
              }}
              className="opacity-70 hover:opacity-100"
              aria-label={`Remove ${label}`}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}

      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={values.length === 0 ? placeholder : ""}
        className="min-w-[80px] flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
      />

      <ChevronDown className="size-3.5 text-muted-foreground" />

      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-soft bg-popover shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </div>
          )}
          {!loading && visibleOptions.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              {input ? "No results." : "Start typing to search…"}
            </div>
          )}
          {!loading &&
            visibleOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  addId(opt.id);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-soft-1"
              >
                <span>{opt.label}</span>
                {opt.sublabel && (
                  <span className="text-[10px] text-muted-foreground">{opt.sublabel}</span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
