"use client";

import { useTransition } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { useUrlFilters } from "@/lib/use-url-filters";
import { daySpan, type DashboardRange, type RangePreset } from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

const PRESETS: { value: Exclude<RangePreset, "this_month" | "custom">; label: string }[] = [
  { value: "last_7", label: "آخر ٧ أيام" },
  { value: "last_30", label: "آخر ٣٠ يومًا" },
  { value: "last_90", label: "آخر ٩٠ يومًا" },
];

export function AccountabilityRangePicker({ range }: { range: DashboardRange }) {
  const { set } = useUrlFilters();
  const [pending, startTransition] = useTransition();

  const update = (entries: Record<string, string | null>) => {
    if (pending) return;
    startTransition(() => set(entries));
  };

  const setPreset = (preset: (typeof PRESETS)[number]["value"]) => {
    if (range.preset === preset) return;
    update({ preset, from: null, to: null });
  };

  const setCustom = (key: "from" | "to", value: string) => {
    if (!value) return;
    const from = key === "from" ? value : range.from;
    const to = key === "to" ? value : range.to;
    if (from > to) return;
    update({ preset: "custom", from, to });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-soft-1/50 p-2"
      aria-label="فترة قياس مؤشرات المساءلة"
    >
      <span className="inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
        {pending ? <Loader2 className="size-3.5 animate-spin text-cyan" /> : <CalendarRange className="size-3.5" />}
        فترة القياس
      </span>

      <div className="inline-flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setPreset(preset.value)}
            disabled={pending}
            aria-pressed={range.preset === preset.value}
            className={cn(
              "rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-70",
              range.preset === preset.value
                ? "border-cyan/40 bg-cyan-dim text-cyan"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="ms-auto flex flex-wrap items-center gap-1.5">
        <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          من
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => setCustom("from", event.target.value)}
            disabled={pending}
            dir="ltr"
            className="h-7 rounded-[var(--radius-sm)] border border-border bg-card px-2 text-[11px] tabular-nums text-foreground outline-none focus:border-cyan/50 disabled:opacity-70"
          />
        </label>
        <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          إلى
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => setCustom("to", event.target.value)}
            disabled={pending}
            dir="ltr"
            className="h-7 rounded-[var(--radius-sm)] border border-border bg-card px-2 text-[11px] tabular-nums text-foreground outline-none focus:border-cyan/50 disabled:opacity-70"
          />
        </label>
        <span
          className={cn(
            "rounded-[var(--radius-sm)] px-2 py-1 text-[10px] tabular-nums",
            range.preset === "custom" ? "bg-cyan-dim text-cyan" : "bg-card text-muted-foreground",
          )}
        >
          <span dir="ltr">{daySpan(range.from, range.to)}</span> يوم
        </span>
      </div>
    </div>
  );
}
