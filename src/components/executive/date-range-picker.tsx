"use client";

// Global CEO-dashboard date-range control (Phase 2). URL-driven so the chosen
// window is shareable and survives reload. Drives every windowed task-metric
// card; snapshot cards use the range end as their "as of" date.

import * as React from "react";
import { CalendarDays, CalendarRange, Loader2 } from "lucide-react";
import { useUrlFilters } from "@/lib/use-url-filters";
import {
  RANGE_PRESETS,
  daySpan,
  type DashboardRange,
  type RangePreset,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

function formatDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const [, year, month, day] = m;
  return `${day}/${month}/${year}`;
}

function DatePickerButton({
  value,
  min,
  max,
  label,
  pending,
  disabled,
  onChange,
}: {
  value: string;
  min?: string;
  max?: string;
  label: string;
  pending?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else {
      input.click();
      input.focus();
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-busy={pending || undefined}
        className="inline-flex h-8 min-w-[8.25rem] items-center justify-center gap-1.5 rounded-lg border border-soft bg-card px-2.5 text-xs tabular-nums text-foreground transition-colors hover:border-cyan/50 hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/45 disabled:cursor-wait disabled:opacity-70"
        aria-label={label}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-cyan" />
        ) : (
          <CalendarDays className="size-3.5 text-muted-foreground" />
        )}
        <span>{formatDateLabel(value)}</span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  );
}

export function DateRangePicker({ range }: { range: DashboardRange }) {
  const { set } = useUrlFilters();
  const [isPending, startTransition] = React.useTransition();
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);

  const updateRange = (
    key: string,
    entries: Record<string, string | number | null | undefined>,
  ) => {
    if (isPending) return;
    setPendingKey(key);
    startTransition(() => {
      set(entries);
    });
  };

  const selectPreset = (preset: Exclude<RangePreset, "custom">) => {
    if (range.preset === preset) return;
    // Clear explicit dates so the preset's rolling bounds take effect.
    updateRange(`preset:${preset}`, { preset, from: null, to: null });
  };

  const setCustom = (key: "from" | "to", value: string) => {
    if (!value) return;
    const from = key === "from" ? value : range.from;
    const to = key === "to" ? value : range.to;
    if (from > to) return; // ignore inverted ranges
    updateRange(key, { preset: "custom", from, to });
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
            disabled={isPending}
            aria-busy={
              isPending && pendingKey === `preset:${p.value}` ? true : undefined
            }
            aria-pressed={range.preset === p.value}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:cursor-wait disabled:opacity-70",
              range.preset === p.value
                ? "border-cyan/40 bg-cyan/10 text-cyan"
                : "border-soft bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {isPending && pendingKey === `preset:${p.value}` && (
              <Loader2 className="size-3 animate-spin" />
            )}
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 ms-auto">
        <DatePickerButton
          value={range.from}
          max={range.to}
          onChange={(value) => setCustom("from", value)}
          label="Select start date"
          pending={isPending && pendingKey === "from"}
          disabled={isPending}
        />
        <span className="text-xs text-muted-foreground">→</span>
        <DatePickerButton
          value={range.to}
          min={range.from}
          onChange={(value) => setCustom("to", value)}
          label="Select end date"
          pending={isPending && pendingKey === "to"}
          disabled={isPending}
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
