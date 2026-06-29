"use client";

// Global CEO-dashboard date-range control (Phase 2). URL-driven so the chosen
// window is shareable and survives reload. Drives every windowed task-metric
// card; snapshot cards use the range end as their "as of" date.

import * as React from "react";
import { CalendarRange } from "lucide-react";
import { useUrlFilters } from "@/lib/use-url-filters";
import {
  RANGE_PRESETS,
  daySpan,
  type DashboardRange,
  type RangePreset,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

export function DateRangePicker({ range }: { range: DashboardRange }) {
  const { set } = useUrlFilters();

  const selectPreset = (preset: Exclude<RangePreset, "custom">) => {
    // Clear explicit dates so the preset's rolling bounds take effect.
    set({ preset, from: null, to: null });
  };

  const setCustom = (key: "from" | "to", value: string) => {
    if (!value) return;
    const from = key === "from" ? value : range.from;
    const to = key === "to" ? value : range.to;
    if (from > to) return; // ignore inverted ranges
    set({ preset: "custom", from, to });
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-soft bg-card px-3 py-2.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarRange className="size-3.5" />
        Period
      </span>

      <div className="flex flex-wrap items-center gap-1">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => selectPreset(p.value)}
            aria-pressed={range.preset === p.value}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs transition-colors",
              range.preset === p.value
                ? "border-cyan/40 bg-cyan/10 text-cyan"
                : "border-soft bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 ms-auto">
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) => setCustom("from", e.target.value)}
          className="rounded-lg border border-soft bg-card px-2 py-1 text-xs text-foreground [color-scheme:dark]"
          aria-label="Start date"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(e) => setCustom("to", e.target.value)}
          className="rounded-lg border border-soft bg-card px-2 py-1 text-xs text-foreground [color-scheme:dark]"
          aria-label="End date"
        />
        <span
          className={cn(
            "ms-1 rounded-md px-2 py-1 text-[11px] tabular-nums",
            range.preset === "custom"
              ? "bg-cyan/10 text-cyan"
              : "bg-soft-1 text-muted-foreground",
          )}
        >
          {daySpan(range.from, range.to)}d
        </span>
      </div>
    </div>
  );
}
