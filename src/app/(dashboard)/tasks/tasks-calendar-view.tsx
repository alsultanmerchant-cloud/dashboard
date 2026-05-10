"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListTaskRow } from "./_loaders";

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

// Saudi week — Saturday first.
const ARABIC_DAYS = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

// Days from Saturday (0) to the given JS day (Sun=0..Sat=6).
function daysFromSaturday(jsDay: number): number {
  return (jsDay + 1) % 7;
}

export function TasksCalendarView({ tasks }: { tasks: ListTaskRow[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  const tasksByDay = useMemo(() => {
    const map = new Map<string, ListTaskRow[]>();
    for (const t of tasks) {
      const key = t.planned_date;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor.year, cursor.month);
    const leadingBlanks = daysFromSaturday(first.getDay());
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const out: Array<{ date: Date | null; key: string }> = [];
    for (let i = 0; i < leadingBlanks; i++) {
      out.push({ date: null, key: `b-${i}` });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.year, cursor.month, d);
      out.push({ date, key: ymd(date) });
    }
    while (out.length % 7 !== 0) {
      out.push({ date: null, key: `t-${out.length}` });
    }
    return out;
  }, [cursor]);

  const undatedCount = tasks.filter((t) => !t.planned_date).length;
  const todayKey = ymd(today);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      const year = c.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  }

  return (
    <div className="rounded-2xl border border-soft bg-card/30 p-4">
      {/* #15/#17: link to the repurposed personal-activities calendar. Sky
          Light's Odoo disables the project-deadline calendar entirely; this
          callout points them at our analog without removing the legacy view
          for users who still find it useful. */}
      <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-cyan/30 bg-cyan-dim/40 px-3 py-2 text-xs">
        <span className="text-foreground">
          هل تبحث عن تذكيراتك الشخصية بدلًا من مواعيد المشاريع؟
        </span>
        <Link
          href="/my-activities"
          className="shrink-0 rounded-md border border-cyan/40 bg-card/60 px-2 py-1 font-medium text-cyan hover:bg-card"
        >
          افتح «أنشطتي»
        </Link>
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {ARABIC_MONTHS[cursor.month]} {cursor.year}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-soft hover:bg-muted/60"
            aria-label="الشهر السابق"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCursor({ year: today.getFullYear(), month: today.getMonth() })
            }
            className="rounded-md border border-soft px-2 py-1 text-xs hover:bg-muted/60"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-soft hover:bg-muted/60"
            aria-label="الشهر التالي"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-soft bg-soft/40 text-xs">
        {ARABIC_DAYS.map((d) => (
          <div
            key={d}
            className="bg-card/80 px-2 py-1.5 text-center font-semibold text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((c) => {
          if (!c.date) {
            return <div key={c.key} className="min-h-[6.5rem] bg-card/30" />;
          }
          const items = tasksByDay.get(c.key) ?? [];
          const isToday = c.key === todayKey;
          const visible = items.slice(0, 3);
          const more = items.length - visible.length;
          return (
            <div
              key={c.key}
              className={cn(
                "flex min-h-[6.5rem] flex-col gap-1 bg-card/80 p-1.5",
                isToday && "ring-1 ring-cyan/60",
              )}
            >
              <div
                className={cn(
                  "text-[11px] font-semibold tabular-nums",
                  isToday ? "text-cyan" : "text-muted-foreground",
                )}
              >
                {c.date.getDate()}
              </div>
              {visible.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  className={cn(
                    "truncate rounded border border-soft/60 px-1.5 py-0.5 text-[10px] hover:bg-muted/60",
                    t.stage === "done"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-soft/30 text-foreground",
                  )}
                  title={t.title}
                >
                  {t.title}
                </Link>
              ))}
              {more > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  +{more}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {undatedCount > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {undatedCount} مهمة بدون تاريخ مخطط (لا تظهر في التقويم).
        </p>
      )}
    </div>
  );
}
