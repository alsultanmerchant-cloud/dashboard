"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FieldDef } from "@/lib/custom-filter/types";

// Searchable field picker — the leftmost combobox on every rule row. Renders
// as a button that, when clicked, drops down a search input + alphabetised
// field list. Matches Odoo's behaviour: focus opens the menu, ESC closes, and
// arrow/Enter pick (Enter is wired via onKeyDown).

export function FieldCombobox({
  fields,
  value,
  onChange,
}: {
  fields: FieldDef[];
  value: string;
  onChange: (next: FieldDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = fields.find((f) => f.name === value);

  const sorted = useMemo(() => [...fields].sort((a, b) => a.label.localeCompare(b.label)), [fields]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (f) => f.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-soft bg-card/50 px-2.5 py-1.5 text-xs text-foreground transition-colors",
          open && "border-cyan",
        )}
      >
        <span className="truncate">{current?.label ?? "Select field…"}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 w-[300px] overflow-hidden rounded-md border border-soft bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b border-soft px-2 py-1.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered[0]) {
                  onChange(filtered[0]);
                  setOpen(false);
                  setQuery("");
                }
              }}
              placeholder="Search…"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">No fields match.</div>
            ) : (
              filtered.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => {
                    onChange(f);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-soft-1",
                    f.name === value && "bg-cyan-dim text-cyan",
                  )}
                >
                  <span>{f.label}</span>
                  <span className="text-[10px] text-muted-foreground">{f.kind}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
