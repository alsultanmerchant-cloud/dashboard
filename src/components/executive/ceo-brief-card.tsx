"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CalendarRange,
  History,
  ListFilter,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BriefChange } from "@/lib/data/ceo-brief-signals";
import {
  applyBriefPatch,
  type CeoBriefEvent,
  type CeoBriefEventCategory,
  type CeoBriefEventSource,
  type CeoBriefResult,
  type StoredCeoBrief,
} from "@/lib/ceo-brief-schema";
import { BRIEF_PATCHED_EVENT } from "@/components/executive/dashboard-selection-assistant";

const VERDICT = {
  improving: { icon: TrendingUp, accent: "text-cc-green", ring: "ring-cc-green/35", chip: "bg-green-dim text-cc-green" },
  stable: { icon: Minus, accent: "text-amber", ring: "ring-amber/35", chip: "bg-amber-dim text-amber" },
  declining: { icon: TrendingDown, accent: "text-cc-red", ring: "ring-cc-red/35", chip: "bg-red-dim text-cc-red" },
} as const;

const SEVERITY = {
  critical: { bar: "bg-cc-red", text: "text-cc-red" },
  high: { bar: "bg-amber", text: "text-amber" },
  medium: { bar: "bg-cc-blue", text: "text-cc-blue" },
} as const;

const CATEGORY = {
  delivery: { chip: "bg-cyan-dim text-cyan" },
  people: { chip: "bg-violet-500/10 text-violet-300" },
  clients: { chip: "bg-amber-dim text-amber" },
  money: { chip: "bg-green-dim text-cc-green" },
  growth: { chip: "bg-blue-dim text-cc-blue" },
} as const;

type T = ReturnType<typeof useTranslations>;
type BriefTab = "critical" | "timeline";
type TimelineRange = "7" | "30" | "90" | "all";
type EventFilter = "all" | CeoBriefEventCategory;

function changeLabel(c: BriefChange, t: T): string {
  return c.labelKey === "service"
    ? t("changes.service", { name: c.serviceName ?? "" })
    : t(`changes.${c.labelKey}`);
}

function changeDelta(c: BriefChange, t: T): string {
  const sign = c.value > 0 ? "+" : "";
  if (c.unit === "percent") return `${sign}${c.value}%`;
  return `${sign}${c.value} ${t(`units.${c.unit}`)}`;
}

function eventTime(date: string | null): number {
  if (!date) return 0;
  const ts = new Date(date).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function eventDate(date: string | null, locale: string): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date.slice(0, 10);
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

function SourceIcon({ source }: { source: CeoBriefEventSource }) {
  const Icon = source === "client_group" ? MessageCircle : source === "technical_group" ? ListFilter : AlertTriangle;
  return <Icon className="size-3.5" />;
}

/** Numbered section wrapper — gives the brief its "three answers" rhythm. */
function QSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-6 items-center justify-center rounded-full bg-cyan-dim text-xs font-bold text-cyan tabular-nums">
          {n}
        </span>
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SourceBadge({ source, t }: { source: CeoBriefEventSource; t: T }) {
  const tone =
    source === "client_group"
      ? "border-cyan/25 bg-cyan/[0.06] text-cyan"
      : source === "technical_group"
        ? "border-amber/25 bg-amber/[0.08] text-amber"
        : "border-soft bg-soft-1 text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", tone)}>
      <SourceIcon source={source} />
      {t(`eventSource.${source}`)}
    </span>
  );
}

function EventCategoryBadge({ category, t }: { category: CeoBriefEventCategory; t: T }) {
  const tone: Record<CeoBriefEventCategory, string> = {
    complaint: "bg-red-dim text-cc-red",
    approval: "bg-green-dim text-cc-green",
    delay: "bg-amber-dim text-amber",
    internal: "bg-soft-2 text-muted-foreground",
    decision: "bg-cyan-dim text-cyan",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", tone[category])}>
      {t(`eventCategory.${category}`)}
    </span>
  );
}

function EventRow({ event, t, locale }: { event: CeoBriefEvent; t: T; locale: string }) {
  const sev = event.severity === "low" ? SEVERITY.medium : SEVERITY[event.severity];
  const body = (
    <div className="group flex items-stretch gap-3 overflow-hidden rounded-xl border border-soft bg-card">
      <span className={cn("w-1 shrink-0", sev.bar)} aria-hidden />
      <div className="min-w-0 flex-1 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2 pe-3">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-6">{event.title}</p>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {eventDate(event.date, locale)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SourceBadge source={event.source} t={t} />
          <EventCategoryBadge category={event.category} t={t} />
          <span className={cn("text-[10px] font-medium", sev.text)}>
            {event.severity === "low" ? t("severity.medium") : t(`severity.${event.severity}`)}
          </span>
        </div>
      </div>
      {event.href && (
        <span className="flex shrink-0 items-center pe-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground">
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </span>
      )}
    </div>
  );

  return event.href ? (
    <Link href={event.href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function RecommendationsList({ data, t }: { data: CeoBriefResult; t: T }) {
  const recommendations = data.recommendations ?? [];
  if (recommendations.length === 0) {
    return (
      <p className="rounded-xl bg-soft-1/40 px-4 py-5 text-center text-xs text-muted-foreground">
        {t("noRecommendations")}
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {recommendations.map((rec, i) => {
        const cat = CATEGORY[rec.category] ?? CATEGORY.delivery;
        return (
          <li key={i} className="rounded-xl border border-soft bg-soft-1/25 p-3">
            <div className="flex items-start gap-3">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-soft-2 text-[11px] font-bold text-foreground/70 tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-relaxed text-foreground/90" data-brief-field={`rec:${i}`}>{rec.action}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cat.chip)}>
                    {t(`categories.${rec.category}`)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("owner")}: {rec.owner}
                  </span>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function BriefBody({ data, t }: { data: CeoBriefResult; t: T }) {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<BriefTab>("critical");
  const [range, setRange] = useState<TimelineRange>("7");
  const [filter, setFilter] = useState<EventFilter>("all");
  const v = VERDICT[data.verdict];
  const VIcon = v.icon;
  // Tolerate older/partial cached briefs that predate a field.
  const changes = data.changes ?? [];
  const risks = data.risks ?? [];
  const recommendations = data.recommendations ?? [];
  const criticalEvents = data.criticalEvents ?? [];
  const timelineEvents = useMemo(
    () => [...(data.timelineEvents ?? [])].sort((a, b) => eventTime(b.date) - eventTime(a.date)),
    [data.timelineEvents],
  );
  const visibleTimelineEvents = useMemo(() => {
    const anchor = Math.max(eventTime(data.criticalEvents?.[0]?.date ?? null), ...timelineEvents.map((event) => eventTime(event.date)));
    const minDate = range === "all" ? null : anchor - Number(range) * 86_400_000;
    return timelineEvents.filter((event) => {
      if (filter !== "all" && event.category !== filter) return false;
      if (minDate === null) return true;
      return eventTime(event.date) >= minDate;
    });
  }, [data.criticalEvents, filter, range, timelineEvents]);

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-soft bg-card p-0.5">
            {(["critical", "timeline"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === tab
                    ? "bg-soft-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "critical" ? <AlertTriangle className="size-3.5" /> : <History className="size-3.5" />}
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </div>

          {activeTab === "timeline" && (
            <div className="inline-flex rounded-lg border border-soft bg-card p-0.5">
              {(["7", "30", "90", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRange(value)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    range === value
                      ? "bg-soft-2 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CalendarRange className="size-3" />
                  {t(`range.${value}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === "critical" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold">{t("criticalTitle")}</h3>
                <span className="text-[11px] text-muted-foreground">{t("latestFirst")}</span>
              </div>
              {criticalEvents.length === 0 ? (
                <p className="rounded-xl bg-soft-1/40 px-4 py-5 text-center text-xs text-muted-foreground">
                  {t("noCriticalEvents")}
                </p>
              ) : (
                <div className="space-y-2">
                  {criticalEvents.map((event) => (
                    <EventRow key={event.id} event={event} t={t} locale={locale} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-3 text-sm font-bold">{t("recommendationsTitle")}</h3>
              <RecommendationsList data={data} t={t} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(["all", "complaint", "approval", "delay", "internal", "decision"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    filter === value
                      ? "border-cyan/35 bg-cyan/[0.08] text-cyan"
                      : "border-soft bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`filter.${value}`)}
                </button>
              ))}
            </div>
            {visibleTimelineEvents.length === 0 ? (
              <p className="rounded-xl bg-soft-1/40 px-4 py-5 text-center text-xs text-muted-foreground">
                {t("noTimelineEvents")}
              </p>
            ) : (
              <div className="space-y-2">
                {visibleTimelineEvents.map((event) => (
                  <EventRow key={event.id} event={event} t={t} locale={locale} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="border-t border-soft/60" />

      {/* Q1 — better or worse? */}
      <QSection n={1} title={t("q1")}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div
            className={cn(
              "flex size-[60px] shrink-0 flex-col items-center justify-center rounded-full bg-card ring-2 ring-inset",
              v.ring,
            )}
          >
            <span className={cn("text-lg font-extrabold leading-none tabular-nums", v.accent)}>
              {data.statusPct}%
            </span>
            <span className="mt-0.5 text-[9px] text-muted-foreground">{data.grade}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
                v.chip,
              )}
            >
              <VIcon className="size-3.5" />
              {t(`verdict.${data.verdict}`)}
            </span>
            <p className="text-sm leading-7 text-foreground/90" data-brief-field="headline">{data.headline}</p>
          </div>
        </div>

        {changes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {changes.map((c, i) => {
              const Arrow = c.dir === "up" ? ArrowUpRight : c.dir === "down" ? ArrowDownRight : Minus;
              return (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                    c.good ? "bg-cc-green/[0.08] text-cc-green" : "bg-cc-red/[0.08] text-cc-red",
                  )}
                >
                  <Arrow className="size-3.5" />
                  <span className="text-foreground/75">{changeLabel(c, t)}</span>
                  <span className="font-semibold tabular-nums">{changeDelta(c, t)}</span>
                </span>
              );
            })}
          </div>
        )}
      </QSection>

      <div className="border-t border-soft/60" />

      {/* Q2 — where is the danger? */}
      <QSection n={2} title={t("q2")}>
        {risks.length === 0 ? (
          <p className="rounded-xl bg-soft-1/40 px-4 py-5 text-center text-xs text-muted-foreground">
            {t("noRisks")}
          </p>
        ) : (
          <div className="space-y-2">
            {risks.map((r) => {
              const sev = SEVERITY[r.severity];
              return (
                <div
                  key={r.id}
                  className="group flex items-stretch gap-3 overflow-hidden rounded-xl border border-soft bg-card"
                >
                  <span className={cn("w-1 shrink-0", sev.bar)} aria-hidden />
                  <div className="min-w-0 flex-1 py-3.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-semibold">{r.title}</p>
                      <span className={cn("text-[10px] font-medium", sev.text)}>
                        {t(`severity.${r.severity}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{r.metric}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-foreground/85" data-brief-field={`risk:${r.id}`}>
                      {r.interpretation}
                    </p>
                  </div>
                  {r.href && (
                    <Link
                      href={r.href}
                      className="flex shrink-0 items-center pe-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                      aria-label={r.title}
                    >
                      <ChevronLeft className="size-4 ltr:rotate-180" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </QSection>

      <div className="border-t border-soft/60" />

      {/* Q3 — what to do? */}
      <QSection n={3} title={t("q3")}>
        <div className="space-y-3">
          {data.bottomLine && (
            <div className="rounded-xl border border-cyan/25 bg-cyan/[0.05] p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-cyan">
                {t("topPriority")}
              </p>
              <p className="mt-1 text-sm leading-7 text-foreground/90" data-brief-field="bottomLine">{data.bottomLine}</p>
            </div>
          )}
          {recommendations.length > 0 && (
            <RecommendationsList data={data} t={t} />
          )}
        </div>
      </QSection>
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-20 animate-pulse rounded-xl bg-white/[0.05]" />
      <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      <div className="h-20 animate-pulse rounded-xl bg-white/[0.05]" />
    </div>
  );
}

export function CeoBriefCard({ initialBrief = null }: { initialBrief?: StoredCeoBrief | null }) {
  const t = useTranslations("Executive.brief");
  const locale = useLocale();
  const [data, setData] = useState<CeoBriefResult | null>(initialBrief?.result ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    initialBrief?.completedAt ? new Date(initialBrief.completedAt) : null,
  );
  // The global dashboard assistant broadcasts inline edits; apply them to local
  // state so the card re-renders instantly (the server already persisted them).
  useEffect(() => {
    const onPatched = (e: Event) => {
      const { field, newText } = (e as CustomEvent<{ field: string; newText: string }>).detail ?? {};
      if (!field || typeof newText !== "string") return;
      setData((prev) => {
        if (!prev) return prev;
        const patch = applyBriefPatch(prev, field, newText);
        return patch.ok ? patch.next : prev;
      });
    };
    window.addEventListener(BRIEF_PATCHED_EVENT, onPatched);
    return () => window.removeEventListener(BRIEF_PATCHED_EVENT, onPatched);
  }, []);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(force ? "/api/ceo-brief?force=1" : "/api/ceo-brief", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      const json: { current: StoredCeoBrief | null } = await res.json();
      setData(json.current?.result ?? null);
      setLastUpdated(json.current?.completedAt ? new Date(json.current.completedAt) : new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const timeFmt = lastUpdated
    ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      }).format(lastUpdated)
    : null;

  return (
    <section className="mb-8 rounded-2xl border border-soft bg-card/40 p-5">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-dim text-cyan">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-sm font-bold">{t("title")}</p>
            <p className="text-[11px] text-muted-foreground">
              {loading
                ? t("analyzing")
                : timeFmt
                  ? t("lastUpdated", { time: timeFmt })
                  : t("tagline")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh(false)}
            disabled={loading}
            className="h-8 gap-2 text-xs"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {loading ? t("working") : data ? t("refresh") : t("generate")}
          </Button>
          {data && !loading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refresh(true)}
              disabled={loading}
              className="h-8 text-[11px] text-muted-foreground"
              title={t("forceTitle")}
            >
              {t("force")}
            </Button>
          )}
        </div>
      </header>

      {error && !loading && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-cc-red/30 bg-cc-red/[0.04] p-3.5">
          <AlertTriangle className="size-4 shrink-0 text-cc-red" />
          <p className="flex-1 text-xs text-muted-foreground">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => refresh(false)} className="h-7 text-xs">
            {t("retry")}
          </Button>
        </div>
      )}

      {loading && <BriefSkeleton />}

      {!loading && !data && !error && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-soft p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-cyan-dim text-cyan">
            <Sparkles className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t("emptyTitle")}</p>
            <p className="max-w-md text-xs text-muted-foreground">{t("emptyDescription")}</p>
          </div>
          <Button onClick={() => refresh(false)} size="sm" className="gap-2">
            <Sparkles className="size-4" />
            {t("generateFirst")}
          </Button>
        </div>
      )}

      {!loading && data && <BriefBody data={data} t={t} />}
    </section>
  );
}
