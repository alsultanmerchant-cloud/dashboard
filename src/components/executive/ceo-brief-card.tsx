"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import type { DeepPartial } from "ai";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  MessageCircleQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Explained, MetricInfo } from "@/components/metric-info";
import type { BriefChange } from "@/lib/data/ceo-brief-signals";
import {
  applyBriefPatch,
  SECTION_SCHEMA,
  type CeoBriefResult,
  type CeoBriefRecommendation,
  type StoredCeoBrief,
  type TrajectoryAi,
  type RisksAi,
  type ActionsAi,
  type SynthesisAi,
} from "@/lib/ceo-brief-schema";
import { applyTrajectory, applyActions, applySynthesis, overlayRiskNotes } from "@/lib/ceo-brief/merge";
import {
  BRIEF_PATCHED_EVENT,
  RISK_DISMISSED_EVENT,
  OPEN_BRIEF_ASSISTANT_EVENT,
} from "@/components/executive/dashboard-selection-assistant";

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

// One section's streaming re-analyze controller, surfaced to BriefBody.
interface Reanalyze<TObj> {
  object: DeepPartial<TObj> | undefined;
  isLoading: boolean;
  error: Error | undefined;
  run: () => void;
}

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

// A single before/after value rendered with its unit (e.g. "82%", "11 مهمة").
// onTime & delaysCleared carry percentages in their from/to, so render as "%".
function changeValueText(c: BriefChange, n: number, t: T): string {
  if (c.unit === "percent" || c.labelKey === "onTime" || c.labelKey === "delaysCleared")
    return `${n}%`;
  return `${n} ${t(`units.${c.unit}`)}`;
}

// One trajectory pill. When the change carries `detail` (the before→after facts
// behind the delta), the pill becomes a click target that opens a popover
// explaining what the metric measures, how it moved, and a link to the records.
function ChangePill({ c, t }: { c: BriefChange; t: T }) {
  const Arrow = c.dir === "up" ? ArrowUpRight : c.dir === "down" ? ArrowDownRight : Minus;
  const tone = c.good ? "bg-cc-green/[0.08] text-cc-green" : "bg-cc-red/[0.08] text-cc-red";
  const body = (
    <>
      <Arrow className="size-3.5" />
      <span className="text-foreground/75">{changeLabel(c, t)}</span>
      <span className="font-semibold tabular-nums">{changeDelta(c, t)}</span>
    </>
  );

  if (!c.detail) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs", tone)}>
        {body}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-shadow hover:ring-1 hover:ring-foreground/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          tone,
        )}
      >
        {body}
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2 text-xs">
        <p className="font-semibold text-foreground">{t("changeDetail.title")}</p>
        <p className="leading-relaxed text-foreground/80">{t(`changeDetail.why.${c.labelKey}`)}</p>
        <p className="flex items-center gap-1.5 font-semibold tabular-nums text-foreground">
          {t("changeDetail.fromTo", {
            from: changeValueText(c, c.detail.from, t),
            to: changeValueText(c, c.detail.to, t),
          })}
        </p>
        {c.detail.sample && (
          <p className="leading-relaxed tabular-nums text-foreground/80">
            {t("changeDetail.sample", {
              num: c.detail.sample.current.num,
              den: c.detail.sample.current.den,
              prevNum: c.detail.sample.previous.num,
              prevDen: c.detail.sample.previous.den,
            })}
          </p>
        )}
        <p className="leading-relaxed text-muted-foreground">{t("changeDetail.period")}</p>
        {c.detail.href && (
          <Link
            href={c.detail.href}
            className="inline-flex w-fit items-center gap-0.5 font-medium text-cc-blue hover:underline"
          >
            {t("changeDetail.link")}
            <ChevronLeft className="size-3.5" />
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Small "re-analyze this section" button shown in each section header. */
function ReanalyzeButton({
  ctl,
  t,
  disabled,
}: {
  ctl: Pick<Reanalyze<unknown>, "isLoading" | "run">;
  t: T;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={ctl.run}
      disabled={disabled || ctl.isLoading}
      className="h-7 gap-1.5 text-[11px] text-muted-foreground"
    >
      <RefreshCw className={cn("size-3", ctl.isLoading && "animate-spin")} />
      {ctl.isLoading ? t("reanalyzingSection") : t("reanalyzeSection")}
    </Button>
  );
}

/** Numbered section wrapper for the executive brief questions. */
function QSection({
  n,
  title,
  action,
  error,
  children,
}: {
  n: number;
  title: string;
  action?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-cyan-dim text-xs font-bold text-cyan tabular-nums">
            {n}
          </span>
          <h3 className="text-sm font-bold">{title}</h3>
        </div>
        {action}
      </div>
      {error && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-cc-red">
          <AlertTriangle className="size-3" />
          {error}
        </p>
      )}
      {children}
    </section>
  );
}

function RecommendationsList({
  recommendations,
  t,
}: {
  recommendations: CeoBriefRecommendation[];
  t: T;
}) {
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

function BriefBody({
  data,
  t,
  traj,
  risksCtl,
  acts,
  synth,
  busy,
}: {
  data: CeoBriefResult;
  t: T;
  traj: Reanalyze<TrajectoryAi>;
  risksCtl: Reanalyze<RisksAi>;
  acts: Reanalyze<ActionsAi>;
  synth: Reanalyze<SynthesisAi>;
  busy: boolean;
}) {
  const v = VERDICT[data.verdict];
  const VIcon = v.icon;
  // Tolerate older/partial cached briefs that predate a field.
  const changes = data.changes ?? [];
  const risks = data.risks ?? [];
  // Cross-section analyst narrative. Streamed partial wins only while loading.
  const synthesis = synth.isLoading ? synth.object?.synthesis ?? data.synthesis : data.synthesis;
  // Code-computed adaptive emphasis (never the model). The hero risk is only
  // highlighted if it still exists in the current risk list.
  const focus = data.emphasis?.focus ?? null;
  const heroRiskId =
    data.emphasis?.heroRiskId && risks.some((r) => r.id === data.emphasis!.heroRiskId)
      ? data.emphasis!.heroRiskId
      : null;

  // Streamed partials override the persisted value ONLY while that section is
  // re-analyzing; once finished, the stored `data` (updated in onFinish) is the
  // source of truth so it never fights an inline edit made afterwards.
  const headline = traj.isLoading ? traj.object?.headline ?? data.headline : data.headline;

  const streamedRiskNote = new Map<string, string>();
  if (risksCtl.isLoading) {
    for (const n of risksCtl.object?.riskNotes ?? []) {
      if (n?.id && typeof n.interpretation === "string") streamedRiskNote.set(n.id, n.interpretation);
    }
  }

  const bottomLine = acts.isLoading ? acts.object?.bottomLine ?? data.bottomLine : data.bottomLine;
  let recommendations: CeoBriefRecommendation[] = data.recommendations ?? [];
  if (acts.isLoading && acts.object?.recommendations) {
    // Overlay streamed action/owner by index onto the stable list, guarding holes.
    const streamed = acts.object.recommendations;
    recommendations = recommendations.map((rec, i) => ({
      ...rec,
      action: typeof streamed[i]?.action === "string" ? (streamed[i]!.action as string) : rec.action,
      owner: typeof streamed[i]?.owner === "string" ? (streamed[i]!.owner as string) : rec.owner,
    }));
  }

  return (
    <div className="space-y-7">
      {(synthesis || synth.isLoading || synth.error) && (
        <div className="rounded-xl border border-cyan/20 bg-cyan-dim/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-cyan">
                <Sparkles className="size-3.5" />
                {t("synthesisTitle")}
              </div>
              {focus && focus !== "stable" && (
                <span className="rounded-full bg-soft-2 px-2 py-0.5 text-[10px] font-medium text-foreground/70">
                  {t("focusLabel")}: {t(`focus.${focus}`)}
                </span>
              )}
            </div>
            <ReanalyzeButton ctl={synth} t={t} disabled={busy} />
          </div>
          {synth.error ? (
            <p className="flex items-center gap-1.5 text-[11px] text-cc-red">
              <AlertTriangle className="size-3" />
              {t("sectionError")}
            </p>
          ) : (
            <p
              className={cn(
                "text-sm leading-7 text-foreground/90",
                synth.isLoading && "animate-pulse",
              )}
              data-brief-field="synthesis"
            >
              {synthesis}
            </p>
          )}
        </div>
      )}

      <QSection
        n={1}
        title={t("q1")}
        error={traj.error ? t("sectionError") : null}
        action={<ReanalyzeButton ctl={traj} t={t} disabled={busy} />}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Explained text={t("q1ScoreHelp")}>
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
          </Explained>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Explained text={t("q1VerdictHelp")}>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
                  v.chip,
                )}
              >
                <VIcon className="size-3.5" />
                {t(`verdict.${data.verdict}`)}
              </span>
            </Explained>
            <p
              className={cn("text-sm leading-7 text-foreground/90", traj.isLoading && "animate-pulse")}
              data-brief-field="headline"
            >
              {headline}
            </p>
          </div>
        </div>

        {changes.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <MetricInfo text={t("q1ChangesHelp")} label={t("q1")} />
            {changes.map((c, i) => (
              <ChangePill key={i} c={c} t={t} />
            ))}
          </div>
        )}
      </QSection>

      <div className="border-t border-soft/60" />

      <QSection
        n={2}
        title={t("q2")}
        error={risksCtl.error ? t("sectionError") : null}
        action={<ReanalyzeButton ctl={risksCtl} t={t} disabled={busy} />}
      >
        {risks.length === 0 ? (
          <p className="rounded-xl bg-soft-1/40 px-4 py-5 text-center text-xs text-muted-foreground">
            {t("noRisks")}
          </p>
        ) : (
          <div className="space-y-2">
            {risks.map((r) => {
              const sev = SEVERITY[r.severity];
              const interpretation = streamedRiskNote.get(r.id) ?? r.interpretation;
              const isHero = r.id === heroRiskId;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "group flex items-stretch gap-3 overflow-hidden rounded-xl border border-soft bg-card transition-colors",
                    r.href && "hover:border-foreground/15 hover:bg-soft-1/30",
                    isHero && "border-cc-red/35 ring-1 ring-cc-red/30 bg-cc-red/[0.03]",
                  )}
                >
                  <span className={cn("w-1 shrink-0", sev.bar)} aria-hidden />
                  <div className="min-w-0 flex-1 py-3.5">
                    {/* Title + metric are the click target (navigate to the
                        scoped evidence). The interpretation below stays a plain
                        <p> so its AI-written text remains selectable for inline
                        editing, and the info icon keeps its own popover. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {r.href ? (
                        <Link
                          href={r.href}
                          className="text-sm font-semibold hover:text-cyan hover:underline"
                        >
                          {r.title}
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold">{r.title}</p>
                      )}
                      <span className={cn("text-[10px] font-medium", sev.text)}>
                        {t(`severity.${r.severity}`)}
                      </span>
                      {isHero && (
                        <span className="rounded bg-cc-red/10 px-1.5 py-0.5 text-[9px] font-bold text-cc-red">
                          {t("heroRisk")}
                        </span>
                      )}
                      <MetricInfo text={t("riskHelp")} label={t(`severity.${r.severity}`)} />
                    </div>
                    {r.href ? (
                      <Link
                        href={r.href}
                        className="mt-1 block w-fit text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {r.metric}
                      </Link>
                    ) : (
                      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{r.metric}</p>
                    )}
                    <p
                      className={cn(
                        "mt-1.5 text-xs leading-relaxed text-foreground/85",
                        risksCtl.isLoading && "animate-pulse",
                      )}
                      data-brief-field={`risk:${r.id}`}
                    >
                      {interpretation}
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

      <QSection
        n={3}
        title={t("q3")}
        error={acts.error ? t("sectionError") : null}
        action={<ReanalyzeButton ctl={acts} t={t} disabled={busy} />}
      >
        <div className="space-y-3">
          {bottomLine && (
            <div className="rounded-xl border border-cyan/25 bg-cyan/[0.05] p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-cyan">
                {t("topPriority")}
              </p>
              <p
                className={cn("mt-1 text-sm leading-7 text-foreground/90", acts.isLoading && "animate-pulse")}
                data-brief-field="bottomLine"
              >
                {bottomLine}
              </p>
            </div>
          )}
          {(recommendations.length > 0 || acts.isLoading) && (
            <RecommendationsList recommendations={recommendations} t={t} />
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
  const router = useRouter();
  const [data, setData] = useState<CeoBriefResult | null>(initialBrief?.result ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    initialBrief?.completedAt ? new Date(initialBrief.completedAt) : null,
  );

  // Per-section streaming re-analyze. Each hook streams its section's prose; the
  // server persists it on finish, and onFinish here merges the final object into
  // local state so the card stays in sync without a full reload. Errors are
  // isolated per section (one failing leaves the other two intact).
  // Each onFinish: optimistically apply the streamed AI prose for an instant
  // update, then router.refresh() to reconcile with the freshly-persisted brief
  // (which also carries the re-analyzed section's fresh code-computed fields —
  // statusPct/changes/risk set — that the stream itself doesn't carry).
  const trajObj = useObject({
    api: "/api/ceo-brief/section/trajectory",
    schema: SECTION_SCHEMA.trajectory,
    onFinish: ({ object }) => {
      if (!object) return;
      setData((prev) => (prev ? applyTrajectory(prev, object) : prev));
      router.refresh();
    },
  });
  const risksObj = useObject({
    api: "/api/ceo-brief/section/risks",
    schema: SECTION_SCHEMA.risks,
    onFinish: ({ object }) => {
      if (!object) return;
      setData((prev) =>
        prev ? { ...prev, risks: overlayRiskNotes(prev.risks ?? [], object.riskNotes) } : prev,
      );
      router.refresh();
    },
  });
  const actsObj = useObject({
    api: "/api/ceo-brief/section/actions",
    schema: SECTION_SCHEMA.actions,
    onFinish: ({ object }) => {
      if (!object) return;
      setData((prev) => (prev ? applyActions(prev, object) : prev));
      router.refresh();
    },
  });
  const synthObj = useObject({
    api: "/api/ceo-brief/section/synthesis",
    schema: SECTION_SCHEMA.synthesis,
    onFinish: ({ object }) => {
      if (!object) return;
      setData((prev) => (prev ? applySynthesis(prev, object) : prev));
      router.refresh();
    },
  });

  const sectionBusy =
    trajObj.isLoading || risksObj.isLoading || actsObj.isLoading || synthObj.isLoading;

  // After a section re-analyze persists + router.refresh(), the parent re-renders
  // with a fresh initialBrief carrying the re-computed code fields (statusPct /
  // changes / risk set). Adopt it when idle so the optimistic prose-only update
  // is replaced by the authoritative persisted brief. Guarded so it never
  // clobbers an in-flight stream or a pending full refresh.
  const briefSig = JSON.stringify(initialBrief?.result ?? null);
  useEffect(() => {
    if (sectionBusy || loading) return;
    setData((prev) => (JSON.stringify(prev) === briefSig ? prev : initialBrief?.result ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefSig, sectionBusy, loading]);

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
    const onDismissed = (e: Event) => {
      const { riskId } = (e as CustomEvent<{ riskId: string }>).detail ?? {};
      if (!riskId) return;
      setData((prev) => {
        if (!prev) return prev;
        const dropEvent = (id: string) => id.startsWith(`risk-${riskId}-`);
        return {
          ...prev,
          risks: (prev.risks ?? []).filter((r) => r.id !== riskId),
          criticalEvents: (prev.criticalEvents ?? []).filter((ev) => !dropEvent(ev.id)),
          timelineEvents: (prev.timelineEvents ?? []).filter((ev) => !dropEvent(ev.id)),
        };
      });
    };
    window.addEventListener(BRIEF_PATCHED_EVENT, onPatched);
    window.addEventListener(RISK_DISMISSED_EVENT, onDismissed);
    return () => {
      window.removeEventListener(BRIEF_PATCHED_EVENT, onPatched);
      window.removeEventListener(RISK_DISMISSED_EVENT, onDismissed);
    };
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

  // NOTE: we intentionally do NOT auto-generate on mount (even when the brief is
  // stale after a taught lesson). Generation only runs when the user clicks
  // "refresh" / "force" or a per-section "re-analyze" button.

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
          {data && !loading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_BRIEF_ASSISTANT_EVENT))}
              className="h-8 gap-1.5 text-xs text-muted-foreground"
            >
              <MessageCircleQuestion className="size-3.5" />
              {t("askBrief")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh(false)}
            disabled={loading || sectionBusy}
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
              disabled={loading || sectionBusy}
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

      {!loading && data && (
        <BriefBody
          data={data}
          t={t}
          traj={{ object: trajObj.object, isLoading: trajObj.isLoading, error: trajObj.error, run: () => trajObj.submit({}) }}
          risksCtl={{ object: risksObj.object, isLoading: risksObj.isLoading, error: risksObj.error, run: () => risksObj.submit({}) }}
          acts={{ object: actsObj.object, isLoading: actsObj.isLoading, error: actsObj.error, run: () => actsObj.submit({}) }}
          synth={{ object: synthObj.object, isLoading: synthObj.isLoading, error: synthObj.error, run: () => synthObj.submit({}) }}
          busy={loading || sectionBusy}
        />
      )}
    </section>
  );
}
