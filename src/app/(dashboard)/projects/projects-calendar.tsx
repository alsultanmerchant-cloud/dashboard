"use client";

// Rwasem-style calendar view for the projects list.
// Mirrors Odoo's calendar.view@project.project: a month grid where each
// project is rendered as a colored chip that spans its start_date..end_date.
// Single-day projects render as a dot. Projects with no dates fall into a
// secondary "بدون تواريخ" list under the grid so they don't disappear.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import type { LiveProject } from "@/lib/odoo/live";
import { cn } from "@/lib/utils";

// Odoo color index → CSS hex (matches project-card stripe palette).
const ODOO_COLORS = [
  "#9c9c9c", "#d44d4d", "#dfb700", "#3597d3", "#5b8a72",
  "#9b59b6", "#e63946", "#2a9d8f", "#264653", "#f4a261",
  "#28a745", "#5241c3",
];
function odooColor(i: number): string {
  return ODOO_COLORS[i % ODOO_COLORS.length] ?? ODOO_COLORS[11];
}

// Parse ISO date (YYYY-MM-DD or full ISO) into a Date at local-midnight.
function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// True iff a date falls within [start, end] inclusive (either bound may be null
// in which case the chip renders only on the populated bound).
function inRange(date: Date, start: Date | null, end: Date | null): boolean {
  if (start && end) return date >= start && date <= end;
  if (start && !end) return date.getTime() === start.getTime();
  if (!start && end) return date.getTime() === end.getTime();
  return false;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type DayCell = {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
};

// Build the 6×7 grid for a month, starting from Sunday (Odoo default).
function buildMonthGrid(anchor: Date): DayCell[] {
  const first = startOfMonth(anchor);
  // 0 = Sun … 6 = Sat. Odoo's default project calendar week starts Sunday.
  const startDow = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startDow);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      date: d,
      inMonth: d.getMonth() === anchor.getMonth(),
      isToday: isSameDay(d, today),
    });
  }
  return cells;
}

type Slot = {
  project: LiveProject;
  start: Date | null;
  end: Date | null;
};

export function ProjectsCalendar({ items }: { items: LiveProject[] }) {
  const locale = useLocale();
  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));

  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);

  // Pre-normalise every project's dates once.
  const slots = useMemo<Slot[]>(
    () =>
      items.map((p) => ({
        project: p,
        start: parseDate(p.startDate),
        end: parseDate(p.endDate),
      })),
    [items],
  );

  // Bucket: which projects intersect each day in the visible grid?
  const projectsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const cell of grid) {
      const key = cell.date.toDateString();
      const hits = slots.filter((s) => inRange(cell.date, s.start, s.end));
      if (hits.length > 0) map.set(key, hits);
    }
    return map;
  }, [grid, slots]);

  // Projects with no dates at all — listed below the grid.
  const undated = useMemo(
    () => slots.filter((s) => !s.start && !s.end).map((s) => s.project),
    [slots],
  );

  const monthLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(anchor);

  const weekdayLabels = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
      weekday: "short",
    });
    // Sun..Sat using a known Sunday baseline.
    const baseline = new Date(2024, 0, 7); // 2024-01-07 is Sunday.
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseline);
      d.setDate(baseline.getDate() + i);
      return f.format(d);
    });
  }, [locale]);

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-bold">{monthLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchor(startOfMonth(new Date()))}
            className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium hover:bg-muted"
          >
            {locale === "ar" ? "اليوم" : "Today"}
          </button>
          <button
            type="button"
            aria-label="السابق"
            onClick={() => setAnchor(addMonths(anchor, -1))}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4 icon-flip-rtl" />
          </button>
          <button
            type="button"
            aria-label="التالي"
            onClick={() => setAnchor(addMonths(anchor, 1))}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4 icon-flip-rtl" />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {/* Header row */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {weekdayLabels.map((w, i) => (
            <div
              key={`${i}-${w}`}
              className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Cells (6 weeks × 7 days) */}
        <div className="grid grid-cols-7">
          {grid.map((cell) => {
            const dayProjects = projectsByDay.get(cell.date.toDateString()) ?? [];
            return (
              <div
                key={cell.date.toISOString()}
                className={cn(
                  "relative min-h-[96px] border-b border-s border-border p-1 first:border-s-0",
                  !cell.inMonth && "bg-muted/20 text-muted-foreground/50",
                )}
              >
                <div
                  className={cn(
                    "mb-1 inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                    cell.isToday
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                  dir="ltr"
                >
                  {cell.date.getDate()}
                </div>
                {dayProjects.length > 0 && (
                  <ul className="space-y-0.5">
                    {dayProjects.slice(0, 3).map((s) => {
                      const tone = odooColor(s.project.color || 11);
                      return (
                        <li key={s.project.id ?? `odoo-${s.project.odooId}`}>
                          <Link
                            href={`/tasks?odooProjectId=${s.project.odooId}`}
                            title={s.project.name}
                            className="block truncate rounded-sm px-1 py-px text-[10px] font-medium text-white"
                            style={{ backgroundColor: tone }}
                          >
                            {s.project.name}
                          </Link>
                        </li>
                      );
                    })}
                    {dayProjects.length > 3 && (
                      <li className="px-1 text-[10px] text-muted-foreground">
                        +{dayProjects.length - 3}{" "}
                        {locale === "ar" ? "أخرى" : "more"}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Undated projects bucket */}
      {undated.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-3">
          <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
            {locale === "ar"
              ? `بدون تواريخ (${undated.length})`
              : `Without dates (${undated.length})`}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {undated.map((p) => (
              <li key={p.id ?? `odoo-${p.odooId}`}>
                <Link
                  href={`/tasks?odooProjectId=${p.odooId}`}
                  className="inline-block rounded-md px-2 py-1 text-[11px] font-medium text-white"
                  style={{ backgroundColor: odooColor(p.color || 11) }}
                  title={p.name}
                >
                  <span className="block max-w-[24ch] truncate">{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
