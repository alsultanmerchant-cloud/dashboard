"use client";

// Calendar popover in the topbar. Click → opens a mini month grid that
// highlights every day where the current user has a scheduled task_activity
// (due_date), with red/amber/cyan dots for overdue / due-today / upcoming.
// Clicking a highlighted day navigates to /my-activities to drill in.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Eye,
  Upload,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
// Saudi week — Saturday first.
const DAYS_AR = ["س", "ح", "ن", "ث", "ر", "خ", "ج"];

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  review: Eye,
  upload: Upload,
  other: ListTodo,
};

const TYPE_LABEL: Record<string, string> = {
  call: "مكالمة",
  email: "بريد",
  review: "مراجعة",
  upload: "رفع",
  other: "أخرى",
};

type Activity = {
  id: string;
  task_id: string;
  task_code: string | null;
  task_title: string;
  project_name: string | null;
  activity_type: string;
  summary: string;
  due_date: string | null;
  completed_at: string | null;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysFromSaturday(jsDay: number): number {
  return (jsDay + 1) % 7;
}

export function TopbarCalendarPopover({
  className,
}: {
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Lazy-fetch on first open. Re-fetch each subsequent open so the dots
  // reflect any activities the user just scheduled on a task.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/my-activities")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Activity[] }) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Index activities by day (YYYY-MM-DD).
  const byDay = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const r of items) {
      if (!r.due_date) continue;
      if (!map.has(r.due_date)) map.set(r.due_date, []);
      map.get(r.due_date)!.push(r);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const lead = daysFromSaturday(first.getDay());
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const out: Array<{ date: Date | null; key: string }> = [];
    for (let i = 0; i < lead; i++) out.push({ date: null, key: `b-${i}` });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.year, cursor.month, d);
      out.push({ date, key: ymd(date) });
    }
    while (out.length % 7 !== 0) {
      out.push({ date: null, key: `t-${out.length}` });
    }
    return out;
  }, [cursor]);

  const todayKey = ymd(today);

  // Tone for a given day's activities: red if any overdue + open, amber if
  // due today + open, cyan if upcoming + open, emerald if all completed.
  function toneFor(dayKey: string, list: Activity[]): "red" | "amber" | "cyan" | "emerald" {
    let anyOpenOverdue = false;
    let anyOpenToday = false;
    let anyOpenFuture = false;
    let anyOpen = false;
    for (const a of list) {
      if (a.completed_at) continue;
      anyOpen = true;
      if (dayKey < todayKey) anyOpenOverdue = true;
      else if (dayKey === todayKey) anyOpenToday = true;
      else anyOpenFuture = true;
    }
    if (!anyOpen) return "emerald";
    if (anyOpenOverdue) return "red";
    if (anyOpenToday) return "amber";
    if (anyOpenFuture) return "cyan";
    return "emerald";
  }

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      const year = c.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
    setSelectedDate(null);
  }

  const selectedActivities = selectedDate ? byDay.get(selectedDate) ?? [] : [];

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label="أنشطتي — تقويم"
        onClick={() => setOpen((v) => !v)}
        className={cn("inline-flex h-9 w-9 items-center justify-center", className)}
      >
        <CalendarDays className="w-4 h-4 text-white/88 dark:text-muted-foreground" />
      </button>

      {open && (
        <div
          className="absolute end-0 top-full mt-2 z-50 w-[20rem] rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl"
          role="dialog"
          aria-label="أنشطتي"
        >
          <div className="flex items-center justify-between gap-2 border-b border-soft/40 p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarDays className="size-4 text-cyan" />
              أنشطتي
            </div>
            <Link
              href="/my-activities"
              onClick={() => setOpen(false)}
              className="text-[11px] text-cyan hover:underline"
            >
              فتح الصفحة الكاملة
            </Link>
          </div>

          <div className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted/60"
                aria-label="الشهر السابق"
              >
                <ChevronRight className="size-4" />
              </button>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tabular-nums">
                  {MONTHS_AR[cursor.month]} {cursor.year}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setCursor({ year: today.getFullYear(), month: today.getMonth() });
                    setSelectedDate(todayKey);
                  }}
                  className="rounded-md border border-soft px-2 py-0.5 text-[10px] hover:bg-muted/60"
                >
                  اليوم
                </button>
              </div>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted/60"
                aria-label="الشهر التالي"
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground">
              {DAYS_AR.map((d) => (
                <div key={d} className="py-0.5 text-center">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((c) => {
                if (!c.date) return <div key={c.key} className="h-8" />;
                const dayKey = ymd(c.date);
                const list = byDay.get(dayKey) ?? [];
                const isToday = dayKey === todayKey;
                const isSelected = dayKey === selectedDate;
                const tone = list.length > 0 ? toneFor(dayKey, list) : null;
                const toneRing = {
                  red: "ring-cc-red/60 bg-cc-red/10",
                  amber: "ring-amber/60 bg-amber/15",
                  cyan: "ring-cyan/60 bg-cyan-dim",
                  emerald: "ring-emerald-500/60 bg-emerald-500/10",
                };
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => list.length > 0 && setSelectedDate(dayKey)}
                    disabled={list.length === 0}
                    className={cn(
                      "relative h-8 rounded-md text-xs font-medium tabular-nums transition-colors",
                      list.length === 0 && "text-muted-foreground/60",
                      list.length > 0 && "ring-1 hover:bg-muted/40",
                      list.length > 0 && tone && toneRing[tone],
                      isSelected && "ring-2 ring-foreground",
                      isToday && !isSelected && "ring-2 ring-cyan",
                    )}
                  >
                    {c.date.getDate()}
                    {list.length > 0 && (
                      <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] tabular-nums">
                        ·{list.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-center gap-3 text-[9px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-cc-red" />متأخر
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-amber" />اليوم
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-cyan" />قادم
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-emerald-500" />مكتمل
              </span>
            </div>
          </div>

          {/* Activity list for the selected day. */}
          {selectedDate && (
            <div className="border-t border-soft/40 max-h-56 overflow-y-auto p-3 space-y-2">
              <p className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                {selectedDate}
              </p>
              {selectedActivities.length === 0 ? (
                <p className="text-xs text-muted-foreground">لا أنشطة.</p>
              ) : (
                selectedActivities.map((a) => {
                  const Icon = TYPE_ICON[a.activity_type] ?? ListTodo;
                  return (
                    <Link
                      key={a.id}
                      href={`/tasks/${a.task_id}?tab=activities`}
                      onClick={() => setOpen(false)}
                      className="block rounded-lg border border-soft/60 bg-card/60 p-2 hover:border-cyan/40 transition-colors"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Icon className="size-3" />
                        {TYPE_LABEL[a.activity_type] ?? a.activity_type}
                        {a.project_name && <span>· {a.project_name}</span>}
                      </div>
                      <p className="text-xs font-medium leading-snug">{a.summary}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {a.task_code ? `${a.task_code} · ` : ""}{a.task_title}
                      </p>
                    </Link>
                  );
                })
              )}
            </div>
          )}

          {loading && items.length === 0 && (
            <div className="border-t border-soft/40 p-3 text-center text-xs text-muted-foreground">
              جاري التحميل...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="border-t border-soft/40 p-3 text-center text-xs text-muted-foreground">
              لا توجد أنشطة مجدولة لك.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
