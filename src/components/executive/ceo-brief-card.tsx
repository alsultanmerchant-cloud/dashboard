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
  Newspaper,
  ChevronDown,
  ChevronLeft,
  MessageCircleQuestion,
  ListTree,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Explained, MetricInfo } from "@/components/metric-info";
import type { BriefTodayItem } from "@/lib/data/ceo-brief-signals";
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
  improving: { icon: TrendingUp, chip: "bg-green-dim text-cc-green" },
  stable: { icon: Minus, chip: "bg-amber-dim text-amber" },
  declining: { icon: TrendingDown, chip: "bg-red-dim text-cc-red" },
} as const;

const TODAY_TONE = {
  good: "bg-cc-green",
  bad: "bg-cc-red",
  info: "bg-cc-blue",
} as const;

// Which evidence breakdown (the /api/ceo-brief/evidence kind + params) proves
// each calculated row. null → the row has no row-level breakdown to show.
function evidenceQueryForRisk(id: string, entityId?: string): string | null {
  switch (id) {
    case "delivery_slip":
      return "kind=sla_late";
    case "stuck_project":
      return entityId ? `kind=sla_late&projectId=${entityId}` : "kind=sla_late";
    case "at_risk_client":
      return entityId ? `kind=sla_late&clientId=${entityId}` : null;
    case "overdue_money":
      return "kind=overdue_money";
    case "client_churn":
      return "kind=client_churn";
    default:
      return null;
  }
}

function evidenceQueryForTodayItem(id: string): string | null {
  switch (id) {
    case "sla-new":
      return "kind=sla_late_new";
    case "done":
      return "kind=done";
    case "collected":
      return "kind=collected";
    case "complaints":
      return "kind=complaints";
    default:
      return null;
  }
}

interface EvidenceTable {
  columns: string[];
  rows: Array<{ id: string; href: string | null; cells: string[] }>;
  note?: string;
}

// Lazy evidence modal: nothing is fetched until the FIRST open, then the
// result is kept for re-opens. The API recomputes the breakdown live from the
// same formula that produced the headline number, so what the modal lists is
// exactly what was counted.
function EvidenceDialog({ query, title, t }: { query: string; title: string; t: T }) {
  const [open, setOpen] = useState(false);
  const [table, setTable] = useState<EvidenceTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/ceo-brief/evidence?${query}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setTable((await res.json()) as EvidenceTable);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !table && !loading) void load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-soft-1/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <ListTree className="size-3" />
        {t("details")}
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm" data-private="client person">
            {title}
          </DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="space-y-2 py-2">
            <div className="h-8 animate-pulse rounded-lg bg-soft-1/60" />
            <div className="h-8 animate-pulse rounded-lg bg-soft-1/60" />
            <div className="h-8 animate-pulse rounded-lg bg-soft-1/60" />
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center gap-3 rounded-xl border border-cc-red/30 bg-cc-red/[0.04] p-3">
            <AlertTriangle className="size-4 shrink-0 text-cc-red" />
            <p className="flex-1 text-xs text-muted-foreground">{t("evidenceError")}</p>
            <Button variant="ghost" size="sm" onClick={() => void load()} className="h-7 text-xs">
              {t("retry")}
            </Button>
          </div>
        )}
        {table && !loading && !error && (
          table.rows.length === 0 ? (
            <p className="rounded-xl bg-soft-1/40 px-4 py-5 text-center text-xs text-muted-foreground">
              {t("evidenceEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-soft text-start text-[10px] text-muted-foreground">
                    {table.columns.map((c) => (
                      <th key={c} className="px-2 py-2 text-start font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-b border-soft/50",
                        r.href && "cursor-pointer transition-colors hover:bg-soft-1/40",
                      )}
                    >
                      {r.cells.map((cell, i) => (
                        <td key={i} className="px-2 py-2 align-top" data-private="client person">
                          {r.href && i === 0 ? (
                            <Link href={r.href} className="hover:text-cyan hover:underline">
                              {cell}
                            </Link>
                          ) : (
                            cell
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {table.note && (
                <p className="mt-2 text-[10px] text-muted-foreground">{table.note}</p>
              )}
              <p className="mt-2 text-[10px] text-muted-foreground/80">
                {t("evidenceLiveNote")}
              </p>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

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

// «الجديد اليوم» — the secretary digest. Items are code-computed facts (never
// AI prose); each row deep-links into the surface holding the evidence.
function TodayDigest({ items, t }: { items: BriefTodayItem[]; t: T }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-6 items-center justify-center rounded-full bg-cyan-dim text-cyan">
          <Newspaper className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold">{t("todayTitle")}</h3>
      </div>
      <ul className="space-y-1">
        {items.map((item) => {
          const evidence = evidenceQueryForTodayItem(item.id);
          return (
            <li key={item.id} className="group -mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-soft-1/40">
              <span
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", TODAY_TONE[item.tone])}
                aria-hidden
              />
              {item.href ? (
                <Link
                  href={item.href}
                  className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90 hover:text-foreground"
                  data-private="client person"
                >
                  {item.text}
                </Link>
              ) : (
                <span
                  className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90"
                  data-private="client person"
                >
                  {item.text}
                </span>
              )}
              {evidence && <EvidenceDialog query={evidence} title={item.text} t={t} />}
              {item.href && (
                <Link href={item.href} aria-label={item.text}>
                  <ChevronLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground ltr:rotate-180" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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
                <p className="text-xs leading-relaxed text-foreground/90" data-brief-field={`rec:${i}`} data-private="client person">{rec.action}</p>
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
  const today = data.today ?? [];
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

  // One button refreshes the whole narrative: the headline (trajectory — which
  // also refreshes the code-computed «الجديد اليوم» digest) and the synthesis.
  const narrative = {
    isLoading: traj.isLoading || synth.isLoading,
    run: () => {
      traj.run();
      synth.run();
    },
  };

  return (
    <div className="space-y-7">
      {today.length > 0 && <TodayDigest items={today} t={t} />}

      {today.length > 0 && <div className="border-t border-soft/60" />}

      <QSection
        n={1}
        title={t("q1")}
        error={traj.error || synth.error ? t("sectionError") : null}
        action={<ReanalyzeButton ctl={narrative} t={t} disabled={busy} />}
      >
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
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
            {focus && focus !== "stable" && (
              <span className="rounded-full bg-soft-2 px-2 py-0.5 text-[10px] font-medium text-foreground/70">
                {t("focusLabel")}: {t(`focus.${focus}`)}
              </span>
            )}
          </div>
          <p
            className={cn("text-sm leading-7 text-foreground/90", traj.isLoading && "animate-pulse")}
            data-brief-field="headline"
            data-private="client person"
          >
            {headline}
          </p>
          {(synthesis || synth.isLoading) && (
            <p
              className={cn(
                "text-sm leading-7 text-foreground/80",
                synth.isLoading && "animate-pulse",
              )}
              data-brief-field="synthesis"
              // AI prose names clients and staff mid-sentence, so there is no
              // substring to tag — the whole block blurs if either category is
              // on.
              data-private="client person"
            >
              {synthesis}
            </p>
          )}
        </div>
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
                          data-private="client person"
                        >
                          {r.title}
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold" data-private="client person">{r.title}</p>
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
                      {(() => {
                        const evidence = evidenceQueryForRisk(r.id, r.entityId);
                        return evidence ? (
                          <EvidenceDialog query={evidence} title={r.title} t={t} />
                        ) : null;
                      })()}
                    </div>
                    {r.href ? (
                      <Link
                        href={r.href}
                        className="mt-1 block w-fit text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                        data-private="client person"
                      >
                        {r.metric}
                      </Link>
                    ) : (
                      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground" data-private="client person">{r.metric}</p>
                    )}
                    <p
                      className={cn(
                        "mt-1.5 text-xs leading-relaxed text-foreground/85",
                        risksCtl.isLoading && "animate-pulse",
                      )}
                      data-brief-field={`risk:${r.id}`}
                      data-private="client person"
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
  const [expanded, setExpanded] = useState(false);
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
      <header className={cn("flex items-center justify-between gap-3", expanded && "mb-5")}>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls="ceo-brief-content"
          className="flex items-center gap-2.5 rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="sr-only">{expanded ? t("collapse") : t("expand")}</span>
        </button>
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

      <div id="ceo-brief-content" hidden={!expanded}>
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
      </div>
    </section>
  );
}
