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
  Plus,
  Trash2,
  X,
  Loader2,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
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

// §6.2: personal calendar events (self-created reminders). Distinct from
// task activities; rendered alongside them in the popover with a bookmark
// icon + the user-chosen color tag.
type PersonalEvent = {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  note: string | null;
  color: number;
  created_at: string;
};

const ODOO_COLORS = [
  "#9c9c9c", "#d44d4d", "#dfb700", "#3597d3", "#5b8a72", "#9b59b6",
  "#e63946", "#2a9d8f", "#264653", "#f4a261", "#28a745", "#5241c3",
];
function odooColor(i: number): string {
  return ODOO_COLORS[Math.max(0, Math.min(ODOO_COLORS.length - 1, i))];
}

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
  const [personal, setPersonal] = useState<PersonalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // §6.2 inline "add personal event" form. Anchored to the selected day so
  // creating an event from the popover doesn't require a separate page.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newColor, setNewColor] = useState(3);
  const [saving, setSaving] = useState(false);

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
  // reflect any activities the user just scheduled on a task. We pull
  // task activities and personal events in parallel.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/my-activities")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .catch(() => ({ items: [] })),
      fetch("/api/personal-events")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .catch(() => ({ items: [] })),
    ])
      .then(
        ([acts, evs]: [
          { items?: Activity[] },
          { items?: PersonalEvent[] },
        ]) => {
          if (cancelled) return;
          setItems(acts.items ?? []);
          setPersonal(evs.items ?? []);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Index activities + personal events by day (YYYY-MM-DD).
  const byDay = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const r of items) {
      if (!r.due_date) continue;
      if (!map.has(r.due_date)) map.set(r.due_date, []);
      map.get(r.due_date)!.push(r);
    }
    return map;
  }, [items]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PersonalEvent[]>();
    for (const e of personal) {
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return map;
  }, [personal]);

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

  async function submitPersonalEvent() {
    if (!addingFor) return;
    const title = newTitle.trim();
    if (!title) {
      toast.error("اكتب عنوانًا للحدث");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/personal-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          eventDate: addingFor,
          eventTime: newTime || null,
          color: newColor,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "تعذر حفظ الحدث");
        return;
      }
      const data = (await res.json()) as { event: PersonalEvent };
      setPersonal((prev) => [...prev, data.event]);
      setNewTitle("");
      setNewTime("");
      setAddingFor(null);
      toast.success("أُضيف الحدث");
    } catch {
      toast.error("تعذر حفظ الحدث");
    } finally {
      setSaving(false);
    }
  }

  async function deletePersonalEvent(id: string) {
    const prev = personal;
    setPersonal((p) => p.filter((e) => e.id !== id));
    const res = await fetch(`/api/personal-events/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Revert.
      setPersonal(prev);
      toast.error("تعذر الحذف");
      return;
    }
    toast.success("حُذف الحدث");
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
  const selectedEvents = selectedDate
    ? (eventsByDay.get(selectedDate) ?? []).slice().sort((a, b) =>
        (a.event_time ?? "00:00").localeCompare(b.event_time ?? "00:00"),
      )
    : [];

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
                const evList = eventsByDay.get(dayKey) ?? [];
                const hasAny = list.length > 0 || evList.length > 0;
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
                    onClick={() => {
                      // §6.2: clicking any day opens it for inspection +
                      // creating personal events, even when it has no
                      // activities yet.
                      setSelectedDate(dayKey);
                      setAddingFor(null);
                    }}
                    className={cn(
                      "relative h-8 rounded-md text-xs font-medium tabular-nums transition-colors hover:bg-muted/40",
                      !hasAny && "text-muted-foreground/80",
                      list.length > 0 && "ring-1",
                      list.length > 0 && tone && toneRing[tone],
                      isSelected && "ring-2 ring-foreground",
                      isToday && !isSelected && "ring-2 ring-cyan",
                    )}
                  >
                    {c.date.getDate()}
                    {hasAny && (
                      <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 text-[8px] tabular-nums">
                        {list.length > 0 && <span>·{list.length}</span>}
                        {evList.length > 0 && (
                          <span
                            className="inline-block size-1.5 rounded-full"
                            style={{ backgroundColor: odooColor(evList[0].color) }}
                            title={`${evList.length} حدث شخصي`}
                          />
                        )}
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

          {/* Activity + personal-event list for the selected day. */}
          {selectedDate && (
            <div className="border-t border-soft/40 max-h-80 overflow-y-auto p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                  {selectedDate}
                </p>
                <button
                  type="button"
                  onClick={() => setAddingFor((cur) => (cur === selectedDate ? null : selectedDate))}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan hover:bg-cyan/20"
                  title="أضف حدثًا شخصيًا"
                >
                  <Plus className="size-3" />
                  حدث شخصي
                </button>
              </div>

              {/* Inline create form. */}
              {addingFor === selectedDate && (
                <div className="rounded-lg border border-cyan/30 bg-cyan-dim/30 p-2 space-y-1.5">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitPersonalEvent();
                      }
                    }}
                    placeholder="عنوان الحدث…"
                    maxLength={120}
                    autoFocus
                    className="h-7 w-full rounded-md border border-soft bg-background px-2 text-[11px]"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="h-7 rounded-md border border-soft bg-background px-1.5 text-[11px] tabular-nums"
                      title="وقت اختياري"
                    />
                    <div className="flex items-center gap-0.5">
                      {[3, 1, 2, 4, 7, 10, 5, 11].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewColor(c)}
                          className={cn(
                            "size-4 rounded-full transition-all",
                            newColor === c
                              ? "ring-2 ring-foreground/60 scale-110"
                              : "opacity-70 hover:opacity-100",
                          )}
                          style={{ backgroundColor: odooColor(c) }}
                          aria-label={`لون ${c}`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={submitPersonalEvent}
                      disabled={saving || !newTitle.trim()}
                      className="ms-auto inline-flex items-center gap-1 rounded-md bg-cyan px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan/90 disabled:opacity-40"
                    >
                      {saving ? <Loader2 className="size-3 animate-spin" /> : "حفظ"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddingFor(null); setNewTitle(""); setNewTime(""); }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="إلغاء"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Personal events first — most actionable to the user. */}
              {selectedEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="group flex items-start gap-2 rounded-lg border border-soft/60 bg-card/60 p-2"
                >
                  <span
                    aria-hidden
                    className="mt-1 inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: odooColor(ev.color) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Bookmark className="size-3" />
                      حدث شخصي
                      {ev.event_time && (
                        <span className="tabular-nums" dir="ltr">· {ev.event_time}</span>
                      )}
                    </div>
                    <p className="text-xs font-medium leading-snug">{ev.title}</p>
                    {ev.note && (
                      <p className="text-[10px] text-muted-foreground truncate">{ev.note}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deletePersonalEvent(ev.id)}
                    aria-label="حذف الحدث"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-cc-red transition"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}

              {selectedActivities.length === 0 && selectedEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  لا أنشطة. اضغط «حدث شخصي» لإضافة تذكير.
                </p>
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

          {loading && items.length === 0 && personal.length === 0 && (
            <div className="border-t border-soft/40 p-3 text-center text-xs text-muted-foreground">
              جاري التحميل...
            </div>
          )}

          {!loading && items.length === 0 && personal.length === 0 && !selectedDate && (
            <div className="border-t border-soft/40 p-3 text-center text-xs text-muted-foreground">
              لا توجد أنشطة مجدولة. اختر أي يوم لإضافة حدث شخصي.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
