"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Phone, Mail, Eye, Upload, ListTodo, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MyActivityRow } from "@/lib/data/my-activities";

const TYPE_ICON = {
  call: Phone,
  email: Mail,
  review: Eye,
  upload: Upload,
  other: ListTodo,
} as const;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysFromSaturday(jsDay: number): number {
  return (jsDay + 1) % 7;
}

export function MyActivitiesCalendar({ rows }: { rows: MyActivityRow[] }) {
  const t = useTranslations("MyActivitiesPage.calendar");
  const locale = useLocale();
  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "long" }),
    [locale],
  );
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }),
    [locale],
  );
  const dayNames = useMemo(() => {
    const base = new Date(Date.UTC(2026, 0, 3)); // Saturday
    return Array.from({ length: 7 }, (_, i) => dayFormatter.format(new Date(base.getTime() + i * 86400000)));
  }, [dayFormatter]);
  const activityTypeLabel = (type: string) => {
    if (type === "call") return t("types.call");
    if (type === "email") return t("types.email");
    if (type === "review") return t("types.review");
    if (type === "upload") return t("types.upload");
    return t("types.other");
  };

  const byDay = useMemo(() => {
    const map = new Map<string, MyActivityRow[]>();
    for (const r of rows) {
      if (!r.due_date) continue;
      if (!map.has(r.due_date)) map.set(r.due_date, []);
      map.get(r.due_date)!.push(r);
    }
    return map;
  }, [rows]);

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
  const undated = rows.filter((r) => !r.due_date);

  // Summary strip: overdue + today + this-week counts, computed off the open
  // activities. Mirrors Odoo's activity-bell colour cues.
  const summary = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const weekEnd = new Date(t);
    weekEnd.setDate(weekEnd.getDate() + 7);
    let overdue = 0;
    let dueToday = 0;
    let thisWeek = 0;
    let completed = 0;
    for (const r of rows) {
      if (r.completed_at) {
        completed++;
        continue;
      }
      if (!r.due_date) continue;
      const d = new Date(r.due_date);
      d.setHours(0, 0, 0, 0);
      if (d < t) overdue++;
      else if (d.getTime() === t.getTime()) dueToday++;
      else if (d <= weekEnd) thisWeek++;
    }
    return { overdue, dueToday, thisWeek, completed };
  }, [rows]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      const year = c.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryPill label={t("summary.overdue")} value={summary.overdue} tone="red" />
        <SummaryPill label={t("summary.today")} value={summary.dueToday} tone="amber" />
        <SummaryPill label={t("summary.thisWeek")} value={summary.thisWeek} tone="cyan" />
        <SummaryPill label={t("summary.completed")} value={summary.completed} tone="emerald" />
      </div>

      <div className="rounded-2xl border border-soft bg-card/30 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {monthFormatter.format(new Date(cursor.year, cursor.month, 1))}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-soft hover:bg-muted/60"
              aria-label={t("previousMonth")}
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
              {t("today")}
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-soft hover:bg-muted/60"
              aria-label={t("nextMonth")}
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-soft bg-soft/40 text-xs">
          {dayNames.map((d) => (
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
            const items = byDay.get(c.key) ?? [];
            const isToday = c.key === todayKey;
            const isPast =
              c.date.getTime() < new Date(todayKey + "T00:00:00").getTime();
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
                    isToday
                      ? "text-cyan"
                      : isPast
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground",
                  )}
                >
                  {c.date.getDate()}
                </div>
                {visible.map((a) => {
                  const Icon = TYPE_ICON[a.activity_type as keyof typeof TYPE_ICON] ?? ListTodo;
                  const done = !!a.completed_at;
                  return (
                    <Link
                      key={a.id}
                      href={`/tasks/${a.task_id}#activities`}
                      title={`${a.summary} — ${a.task_title}`}
                      className={cn(
                        "inline-flex items-center gap-1 truncate rounded border border-soft/60 px-1.5 py-0.5 text-[10px] hover:bg-muted/60",
                        done
                          ? "bg-emerald-500/10 text-emerald-700 line-through dark:text-emerald-300"
                          : isPast
                            ? "bg-red-500/10 text-red-700 dark:text-red-300"
                            : "bg-soft/30 text-foreground",
                      )}
                    >
                      {done ? (
                        <CheckCircle2 className="size-3 shrink-0" />
                      ) : (
                        <Icon className="size-3 shrink-0" />
                      )}
                      <span className="truncate">{a.summary}</span>
                    </Link>
                  );
                })}
                {more > 0 && (
                  <span className="text-[10px] text-muted-foreground">+{more}</span>
                )}
              </div>
            );
          })}
        </div>

        {undated.length > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("undated", { count: undated.length })}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-soft bg-card/30 p-4">
        <h3 className="mb-2 text-sm font-semibold">{t("listTitle")}</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noActivities")}</p>
        ) : (
          <ul className="divide-y divide-soft/40">
            {rows.map((a) => {
              const Icon = TYPE_ICON[a.activity_type as keyof typeof TYPE_ICON] ?? ListTodo;
              const done = !!a.completed_at;
              const overdue =
                !done && a.due_date && new Date(a.due_date) < new Date(todayKey + "T00:00:00");
              return (
                <li key={a.id} className="flex items-center gap-2 py-2 text-xs">
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      done ? "text-emerald-500" : overdue ? "text-red-500" : "text-cyan",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      done && "line-through text-muted-foreground",
                    )}
                  >
                    {a.summary}
                  </span>
                  <span className="hidden text-muted-foreground sm:inline">
                    {activityTypeLabel(a.activity_type)}
                  </span>
                  <Link
                    href={`/tasks/${a.task_id}`}
                    className="shrink-0 truncate rounded border border-soft px-2 py-0.5 text-[11px] text-cyan hover:bg-cyan-dim/40"
                    title={a.task_title}
                  >
                    {a.task_code ?? a.task_title.slice(0, 30)}
                  </Link>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      overdue ? "text-red-500" : "text-muted-foreground",
                    )}
                    dir="ltr"
                  >
                    {a.due_date ? shortDateFormatter.format(new Date(a.due_date)) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "cyan" | "emerald";
}) {
  const cls =
    tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "cyan"
          ? "border-cyan/30 bg-cyan-dim text-cyan"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return (
    <div className={cn("flex items-center justify-between rounded-xl border px-3 py-2", cls)}>
      <span className="text-xs">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
    </div>
  );
}
