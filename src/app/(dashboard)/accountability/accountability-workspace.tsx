"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  Eye,
  Gauge,
  Hourglass,
  Info,
  Quote,
  Scale,
  Sparkles,
  Timer,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FilterChip } from "@/components/filter-chip";
import { cn } from "@/lib/utils";
import {
  TASK_OWNER_ROLE_KEYS,
  TASK_OWNER_ROLE_LABELS,
} from "@/lib/labels";
import { ClientFinanceBadges } from "@/components/client-finance-badges";
import { Explained, MetricInfo } from "@/components/metric-info";
import type { ClientFinanceMap } from "@/lib/data/client-finance";
import type {
  AccountabilityEvidence,
  AccountabilityOverview,
  AccountabilityScorecardRow,
  AiLinkedSignal,
  ReviewerRigorRow,
} from "@/lib/data/accountability";

const NA = "—";
const SCORECARD_PAGE_SIZE = 5;
// Filter bucket key for employees with no position set on /organization/employees.
const NONE_KEY = "__none__";

interface Props {
  overview: AccountabilityOverview;
  evidence: AccountabilityEvidence | null;
  selectedId: string | null;
  financeMap: ClientFinanceMap;
}

// Low-confidence rows render neutral (never red): a tiny sample must not look
// like an indictment. Tone only kicks in at high confidence.
function scoreTone(score: number | null, lowConfidence: boolean): string {
  if (score === null || lowConfidence) return "text-muted-foreground";
  if (score >= 70) return "text-cc-green";
  if (score >= 50) return "text-amber";
  return "text-cc-red";
}

function scoreBadgeTone(score: number | null, lowConfidence: boolean): string {
  if (score === null || lowConfidence) return "border-border bg-soft-1 text-muted-foreground";
  if (score >= 70) return "border-cc-green/25 bg-green-dim text-cc-green";
  if (score >= 50) return "border-amber/25 bg-amber-dim text-amber";
  return "border-cc-red/25 bg-red-dim text-cc-red";
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function AccountabilityWorkspace({ overview, evidence, selectedId, financeMap }: Props) {
  const t = useTranslations("AccountabilityPage");
  const tStages = useTranslations("TasksBoard.stages");
  const router = useRouter();
  const searchParams = useSearchParams();
  // Filtering stays client-side (instant) because getAccountabilityOverview is
  // an expensive live-compute that already loads every row — re-running it per
  // keystroke would be wrong. We still mirror state to the URL via
  // history.replaceState so links/refresh restore the view WITHOUT a server
  // round-trip, and seed initial state from the URL on mount.
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  // Filter by the employee's real POSITION (positions.role), not the
  // accountability/stage attribution — so the chips agree with the الدور
  // column. "all" = no filter; NONE_KEY = employees with no position set.
  const [roleFilter, setRoleFilter] = useState<string>(
    () => searchParams.get("role") ?? "all",
  );

  // Mirror toolbar state into the URL bar without triggering a Next navigation
  // (which would re-run the expensive server component). `emp` is preserved.
  const mirrorUrl = (next: { q?: string; role?: string }) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = next.q ?? query;
    const role = next.role ?? roleFilter;
    if (q.trim()) params.set("q", q.trim());
    else params.delete("q");
    if (role !== "all") params.set("role", role);
    else params.delete("role");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    mirrorUrl({ q: value });
  };
  const onRoleChange = (key: string) => {
    setRoleFilter(key);
    mirrorUrl({ role: key });
  };

  const stageLabel = (s: string) => {
    try {
      return tStages(s);
    } catch {
      return s;
    }
  };

  const fmtMinutes = (min: number | null): string => {
    if (min == null) return NA;
    const m = Math.round(min);
    if (m < 60) return t("fmt.minutes", { n: m });
    const h = m / 60;
    // 8h business day (Sun–Thu 09:00–17:00 Riyadh) — matches business_minutes_between.
    if (h < 8) return t("fmt.hours", { n: Math.round(h * 10) / 10 });
    return t("fmt.workdays", { n: Math.round((h / 8) * 10) / 10 });
  };

  // Position-role filter groups, in canonical order, only those present. A
  // trailing bucket collects employees with no position set.
  const positionGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of overview.rows) {
      const k = r.positionRole ?? NONE_KEY;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const groups: { key: string; label: string; count: number }[] = [];
    for (const key of TASK_OWNER_ROLE_KEYS) {
      const c = counts.get(key);
      if (c) groups.push({ key, label: TASK_OWNER_ROLE_LABELS[key], count: c });
    }
    const none = counts.get(NONE_KEY);
    if (none) groups.push({ key: NONE_KEY, label: "غير محدد", count: none });
    return groups;
  }, [overview.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview.rows
      .filter((r) => {
        if (roleFilter !== "all" && (r.positionRole ?? NONE_KEY) !== roleFilter)
          return false;
        if (q && !r.fullName.toLowerCase().includes(q)) return false;
        return true;
      })
      // Ordered by on-time commitment (الالتزام بالمواعيد) ascending — worst
      // first — per the team's request: the composite score's makeup wasn't
      // obvious, whereas on-time % is the single metric they steer by. Rows with
      // no/low-confidence SLA sample still sink to the end so a 2-event sample
      // never headlines the board.
      .sort((a, b) => {
        const rank = (r: AccountabilityScorecardRow) =>
          r.onTimeRate === null ? 2 : r.confidence === "low" ? 1 : 0;
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return (a.onTimeRate ?? 999) - (b.onTimeRate ?? 999);
      });
  }, [overview.rows, query, roleFilter]);

  const stats = useMemo(() => {
    const measured = overview.rows.filter(
      (r) => r.score !== null && r.confidence === "high",
    );
    return {
      measured: overview.rows.length,
      median: median(measured.map((r) => r.score as number)),
      // Distinct task count — per-row overdueOwned fans out across
      // co-assignees, so summing rows would double-count one delay.
      overdueOwned: overview.coverage.distinctOverdueTasks,
      lowConfidence: overview.rows.filter(
        (r) => r.confidence === "low" || r.score === null,
      ).length,
    };
  }, [overview.rows, overview.coverage.distinctOverdueTasks]);

  const select = (id: string) => router.push(`/accountability?emp=${id}`);

  const headStats = [
    {
      icon: Users,
      label: t("stats.measured"),
      value: String(stats.measured),
      tone: "text-cyan",
      help: t("metricTooltips.accountability_measured"),
    },
    {
      icon: Gauge,
      label: t("stats.medianScore"),
      value: stats.median == null ? NA : `${stats.median}%`,
      tone: scoreTone(stats.median, false),
      help: t("metricTooltips.accountability_medianScore"),
    },
    {
      icon: AlertTriangle,
      label: t("stats.overdueOwned"),
      value: String(stats.overdueOwned),
      tone: stats.overdueOwned > 0 ? "text-cc-red" : "text-cc-green",
      help: t("metricTooltips.accountability_overdueOwned"),
    },
    {
      icon: Hourglass,
      label: t("stats.lowConfidence"),
      value: String(stats.lowConfidence),
      tone: "text-muted-foreground",
      help: t("metricTooltips.accountability_lowConfidence"),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Honesty banner: how dwell is computed + attribution + N/A rules */}
      <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-cyan" />
        <p>
          {t("methodology")}{" "}
          <span className="text-foreground/80">{t("evidenceRule")}</span>
        </p>
      </div>

      {/* Evidence drill-down for the selected employee */}
      {selectedId && (
        <EvidencePanel
          evidence={evidence}
          stageLabel={stageLabel}
          fmtMinutes={fmtMinutes}
          onClose={() => router.push("/accountability")}
          t={t}
        />
      )}

      {/* Head stats */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {headStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <s.icon className={cn("size-4", s.tone)} />
              <p className={cn("mt-2 text-2xl font-bold tabular-nums", s.tone)}>
                <Explained text={s.help}>
                  <span dir="ltr">{s.value}</span>
                </Explained>
              </p>
              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {s.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar: search + role filter (shared FilterBar / FilterChip) */}
      <FilterBar
        className="mb-0"
        search={{ value: query, onChange: onQueryChange, placeholder: t("search") }}
        hasActiveFilters={query.trim() !== "" || roleFilter !== "all"}
        onClear={() => {
          setQuery("");
          setRoleFilter("all");
          mirrorUrl({ q: "", role: "all" });
        }}
      >
        {[
          { key: "all", label: t("roleFilter.all"), count: overview.rows.length },
          ...positionGroups,
        ].map((g) => (
          <FilterChip
            key={g.key}
            as="button"
            active={roleFilter === g.key}
            count={g.count}
            onClick={() => onRoleChange(g.key)}
          >
            {g.label}
          </FilterChip>
        ))}
      </FilterBar>

      {/* Scorecard board */}
      <ScorecardTable
        key={`${roleFilter}:${query}`}
        rows={filtered}
        selectedId={selectedId}
        onSelect={select}
        fmtMinutes={fmtMinutes}
        t={t}
      />

      <ReviewerRigorSection
        reviewers={overview.reviewers}
        onSelect={select}
        fmtMinutes={fmtMinutes}
        t={t}
      />

      {/* Tier-B: AI-linked signals — always quoted, always labeled, never scored */}
      <AiLinkedSection signals={overview.aiSignals} financeMap={financeMap} t={t} />

      <p className="text-end text-[10px] text-muted-foreground/60">
        {t("generatedAt")}{" "}
        <span dir="ltr" className="tabular-nums">
          {overview.generatedAt.slice(0, 16).replace("T", " ")}
        </span>
      </p>
    </div>
  );
}

// ---- Scorecard table ------------------------------------------------------
function ScorecardTable({
  rows,
  selectedId,
  onSelect,
  fmtMinutes,
  t,
}: {
  rows: AccountabilityScorecardRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fmtMinutes: (min: number | null) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [visibleCount, setVisibleCount] = useState(SCORECARD_PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-6" />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }

  const visibleRows = rows.slice(0, visibleCount);
  const canLoadMore = visibleRows.length < rows.length;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/95 shadow-sm">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-soft-1/80">
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-start font-semibold">{t("col.employee")}</th>
                <th className="px-3 py-3 text-start font-semibold">{t("col.role")}</th>
                <th className="px-3 py-3 text-start font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1">
                    {t("col.score")}
                    <MetricInfo text={t("help.score")} label={t("col.score")} />
                  </span>
                </th>
                <th className="px-3 py-3 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {t("col.onTime")}
                    <MetricInfo text={t("help.onTime")} label={t("col.onTime")} />
                  </span>
                </th>
                <th className="px-3 py-3 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {t("col.avgDwell")}
                    <MetricInfo text={t("metricTooltips.accountability_avgDwell")} label={t("col.avgDwell")} />
                  </span>
                </th>
                <th className="px-3 py-3 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {t("col.rework")}
                    <MetricInfo text={t("metricTooltips.accountability_rework")} label={t("col.rework")} />
                  </span>
                </th>
                <th className="px-3 py-3 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {t("col.openTasks")}
                    <MetricInfo text={t("metricTooltips.accountability_openTasks")} label={t("col.openTasks")} />
                  </span>
                </th>
                <th className="px-3 py-3 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {t("col.overdue")}
                    <MetricInfo text={t("metricTooltips.accountability_overdue")} label={t("col.overdue")} />
                  </span>
                </th>
                <th className="px-3 py-3 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {t("col.sample")}
                    <MetricInfo text={t("metricTooltips.accountability_sample")} label={t("col.sample")} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleRows.map((r) => {
                const low = r.confidence === "low";
                // Per-employee breakdown of how the composite score was formed,
                // so hovering the badge shows the actual makeup (not just the formula).
                const nonOverdue =
                  r.openTasks > 0
                    ? Math.round(100 * (1 - r.overdueOwned / r.openTasks))
                    : null;
                const otStr = r.onTimeRate === null ? NA : `${r.onTimeRate}%`;
                const scoreBreakdown =
                  nonOverdue === null
                    ? t("help.scoreBreakdownNoOpen", { onTime: otStr })
                    : t("help.scoreBreakdown", { onTime: otStr, nonOverdue: `${nonOverdue}%` });
                return (
                  <tr
                    key={r.employeeId}
                    onClick={() => onSelect(r.employeeId)}
                    className={cn(
                      "group cursor-pointer border-s-2 border-s-transparent transition-colors hover:bg-soft-1/70",
                      selectedId === r.employeeId && "border-s-cyan bg-cyan/5",
                    )}
                    title={t("evidenceRule")}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold tracking-[0px] group-hover:text-cyan">
                        {r.fullName}
                      </div>
                      {r.jobTitle && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {r.jobTitle}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-md border border-border/60 bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {r.positionLabel ?? t(`role.${r.role}`)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {r.score === null ? (
                          <span
                            className={cn(
                              "inline-flex min-w-14 justify-center rounded-md border px-2 py-1 text-sm font-bold tabular-nums",
                              scoreBadgeTone(r.score, low),
                            )}
                            dir="ltr"
                          >
                            {NA}
                          </span>
                        ) : (
                          <Explained text={scoreBreakdown}>
                            <span
                              className={cn(
                                "inline-flex min-w-14 justify-center rounded-md border px-2 py-1 text-sm font-bold tabular-nums",
                                scoreBadgeTone(r.score, low),
                              )}
                              dir="ltr"
                            >
                              {`${r.score}%`}
                            </span>
                          </Explained>
                        )}
                        {r.score === null ? (
                          <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            {t("noScore")}
                          </span>
                        ) : low ? (
                          <span
                            className="rounded border border-border bg-soft-1 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                            title={t("lowSampleHint")}
                          >
                            {t("lowSample", { n: r.slaSampleSize })}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-center font-medium tabular-nums",
                        scoreTone(r.onTimeRate, low),
                      )}
                    >
                      <span dir="ltr">{r.onTimeRate === null ? NA : `${r.onTimeRate}%`}</span>
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">
                      {fmtMinutes(r.avgDwellBusinessMinutes)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-center tabular-nums",
                        r.reworkReturns30d > 0 ? "text-amber" : "text-muted-foreground",
                      )}
                    >
                      {r.reworkReturns30d}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums text-foreground/80">
                      {r.openTasks}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-center tabular-nums",
                        r.overdueOwned > 0 && "font-semibold text-cc-red",
                      )}
                    >
                      {r.overdueOwned}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">
                      {r.sampleSize}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canLoadMore && (
          <div className="flex items-center justify-between gap-3 border-t border-border bg-soft-1/40 px-4 py-3">
            <p className="text-[11px] text-muted-foreground">
              {t("showingRows", { shown: visibleRows.length, total: rows.length })}
            </p>
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + SCORECARD_PAGE_SIZE)}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan/20 bg-cyan/10 px-3 py-1.5 text-xs font-semibold text-cyan transition-colors hover:bg-cyan/15"
            >
              {t("loadMore")}
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Evidence drill-down ---------------------------------------------------
function EvidencePanel({
  evidence,
  stageLabel,
  fmtMinutes,
  onClose,
  t,
}: {
  evidence: AccountabilityEvidence | null;
  stageLabel: (s: string) => string;
  fmtMinutes: (min: number | null) => string;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="border-cyan/30">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <Eye className="size-4 text-cyan" />
              {evidence
                ? t("evidence.title", { name: evidence.fullName })
                : t("evidence.notFound")}
              {evidence && (
                <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t(`role.${evidence.role}`)}
                </span>
              )}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {t("evidence.hint")}
              <MetricInfo text={t("metricTooltips.accountability_evidenceDwell")} label={t("col.avgDwell")} />
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("evidence.close")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-soft-1 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {!evidence || evidence.items.length === 0 ? (
          <p className="mt-3 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("evidence.empty")}
          </p>
        ) : (
          <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pe-1">
            {evidence.items.map((item) => (
              <li key={`${item.taskId}-${item.stage}-${item.enteredAt}`}>
                <Link
                  href={`/tasks/${item.taskId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-cyan/30 hover:bg-soft-1"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {item.taskCode && (
                      <span
                        dir="ltr"
                        className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/70"
                      >
                        {item.taskCode}
                      </span>
                    )}
                    <span className="max-w-[18rem] truncate">{item.title}</span>
                    {item.clientName && (
                      <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
                        {item.clientName}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px]">
                    <span className="rounded bg-soft-2 px-1.5 py-0.5 text-muted-foreground">
                      {stageLabel(item.stage)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtMinutes(item.dwellBusinessMinutes)}
                    </span>
                    {item.exitedAt === null && (
                      <span className="rounded bg-cyan/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
                        {t("evidence.inStageNow")}
                      </span>
                    )}
                    {item.isOverdue && (
                      <span className="rounded bg-red-dim px-1.5 py-0.5 text-[10px] font-medium text-cc-red">
                        {item.delayDays !== null
                          ? t("evidence.delayDays", { n: item.delayDays })
                          : t("evidence.overdue")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Reviewer rigor ---------------------------------------------------------
function ReviewerRigorSection({
  reviewers,
  onSelect,
  fmtMinutes,
  t,
}: {
  reviewers: { managerReview: ReviewerRigorRow[]; specialistReview: ReviewerRigorRow[] };
  onSelect: (id: string) => void;
  fmtMinutes: (min: number | null) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <Scale className="size-4 text-cyan" /> {t("reviewers.title")}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("reviewers.hint")}
        </p>

        {/* Two distinct review stages, each credited to a different role:
            Manager Review → the Manager/Head; Specialist Review → the executing
            specialist (task assignee). Shown as separate sections. */}
        <div className="mt-4 space-y-6">
          <ReviewerStageBlock
            title={t("reviewers.managerReviewTitle")}
            subtitle={t("reviewers.managerReviewSubtitle")}
            rows={reviewers.managerReview}
            onSelect={onSelect}
            fmtMinutes={fmtMinutes}
            t={t}
          />
          <ReviewerStageBlock
            title={t("reviewers.specialistReviewTitle")}
            subtitle={t("reviewers.specialistReviewSubtitle")}
            rows={reviewers.specialistReview}
            onSelect={onSelect}
            fmtMinutes={fmtMinutes}
            t={t}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// One review stage's reviewer table (Manager Review or Specialist Review).
function ReviewerStageBlock({
  title,
  subtitle,
  rows,
  onSelect,
  fmtMinutes,
  t,
}: {
  title: string;
  subtitle: string;
  rows: ReviewerRigorRow[];
  onSelect: (id: string) => void;
  fmtMinutes: (min: number | null) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-foreground/90">{title}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{subtitle}</p>
      {/* Honesty label: stage-history mode credits the assigned person, not
          whoever actually moved the task. */}
      {rows.some((r) => r.attribution === "stage_history_assignment") && (
        <p className="mt-2 rounded-md border border-amber/20 bg-amber/5 px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground">
          {t("reviewers.attributedNote")}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {t("reviewers.empty")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="p-2 text-start font-medium">{t("reviewers.col.reviewer")}</th>
                  <th className="p-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t("reviewers.col.reviews")}
                      <MetricInfo text={t("metricTooltips.accountability_reviewerReviews")} label={t("reviewers.col.reviews")} />
                    </span>
                  </th>
                  <th className="p-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t("reviewers.col.medianTime")}
                      <MetricInfo text={t("metricTooltips.accountability_reviewerMedianTime")} label={t("reviewers.col.medianTime")} />
                    </span>
                  </th>
                  <th className="p-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t("reviewers.col.fastShare")}
                      <MetricInfo text={t("metricTooltips.accountability_reviewerFastShare")} label={t("reviewers.col.fastShare")} />
                    </span>
                  </th>
                  <th className="p-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t("reviewers.col.rework")}
                      <MetricInfo text={t("metricTooltips.accountability_reviewerRework")} label={t("reviewers.col.rework")} />
                    </span>
                  </th>
                  <th className="p-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t("reviewers.col.pending")}
                      <MetricInfo text={t("metricTooltips.accountability_reviewerPending")} label={t("reviewers.col.pending")} />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = r.confidence === "low";
                  // High fast-review share = possible rubber-stamping. Only an
                  // amber flag at high confidence — small samples stay neutral.
                  const rubberStamp =
                    !low && r.fastReviewShare !== null && r.fastReviewShare >= 30;
                  return (
                    <tr
                      key={r.employeeId}
                      onClick={() => onSelect(r.employeeId)}
                      className="cursor-pointer border-b border-border/50 transition-colors hover:bg-soft-1"
                      title={t("evidenceRule")}
                    >
                      <td className="p-2">
                        <span className="font-medium hover:text-cyan">{r.fullName}</span>
                        {low && (
                          <span
                            className="ms-1.5 rounded border border-border bg-soft-1 px-1 py-0.5 text-[9px] text-muted-foreground"
                            title={t("lowSampleHint")}
                          >
                            {t("lowSample", { n: r.sampleSize })}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-center tabular-nums">{r.reviewsCompleted}</td>
                      <td className="p-2 text-center tabular-nums text-muted-foreground">
                        {fmtMinutes(r.medianReviewBusinessMinutes)}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 tabular-nums",
                            rubberStamp ? "font-semibold text-amber" : "text-muted-foreground",
                          )}
                        >
                          {rubberStamp && <Timer className="size-3" />}
                          <span dir="ltr">
                            {r.fastReviewShare === null ? NA : `${r.fastReviewShare}%`}
                          </span>
                        </span>
                        {rubberStamp && (
                          <div className="text-[9px] text-amber">{t("reviewers.rubberStamp")}</div>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={cn(
                            "tabular-nums",
                            !low && r.reworkAfterPassRate !== null && r.reworkAfterPassRate >= 30
                              ? "font-semibold text-amber"
                              : "text-muted-foreground",
                          )}
                          dir="ltr"
                        >
                          {r.reworkAfterPassRate === null ? NA : `${r.reworkAfterPassRate}%`}
                        </span>
                        {r.passCount > 0 && (
                          <div className="text-[9px] tabular-nums text-muted-foreground">
                            {t("reviewers.reworkDetail", { k: r.reworkCount, n: r.passCount })}
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <span className="tabular-nums">{r.pendingReviews}</span>
                        {r.oldestPendingBusinessMinutes !== null && r.pendingReviews > 0 && (
                          <div className="text-[9px] tabular-nums text-muted-foreground">
                            {t("reviewers.oldestPending", {
                              v: fmtMinutes(r.oldestPendingBusinessMinutes),
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ---- Tier-B: AI-linked signals ----------------------------------------------
function AiLinkedSection({
  signals,
  financeMap,
  t,
}: {
  signals: AiLinkedSignal[];
  financeMap: ClientFinanceMap;
  t: ReturnType<typeof useTranslations>;
}) {
  const [range, setRange] = useState<"today" | "week">("week");

  // Latest COMPLAINT per client within the selected window. The task↔complaint
  // linkage proved unreliable, so we drop "related tasks" and keep this concise:
  // one freshest complaint per client, with its source quote.
  const complaints = useMemo(() => {
    const cutoff = new Date();
    if (range === "today") cutoff.setHours(0, 0, 0, 0);
    else cutoff.setDate(cutoff.getDate() - 7);
    const cutoffMs = cutoff.getTime();
    const latest = new Map<string, AiLinkedSignal>();
    for (const s of signals) {
      if (s.kind !== "complaint" || !s.occurredAt) continue;
      const ts = new Date(s.occurredAt).getTime();
      if (Number.isNaN(ts) || ts < cutoffMs) continue;
      const key = s.clientId ?? s.clientName ?? s.id;
      const prev = latest.get(key);
      if (!prev || new Date(prev.occurredAt as string).getTime() < ts) latest.set(key, s);
    }
    return [...latest.values()].sort(
      (a, b) =>
        new Date(b.occurredAt as string).getTime() - new Date(a.occurredAt as string).getTime(),
    );
  }, [signals, range]);

  const rangeBtn = (key: "today" | "week", label: string) => (
    <button
      type="button"
      onClick={() => setRange(key)}
      aria-pressed={range === key}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] transition-colors",
        range === key
          ? "bg-cyan-dim text-cyan font-medium"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-cyan" /> {t("ai.complaintsTitle")}
            <MetricInfo text={t("ai.complaintsHint")} label={t("ai.complaintsTitle")} />
          </p>
          <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan">
            {t("ai.badge")}
          </span>
          {/* Today / This week toggle */}
          <div className="ms-auto inline-flex rounded-lg border border-soft bg-card/60 p-0.5">
            {rangeBtn("today", t("ai.windowToday"))}
            {rangeBtn("week", t("ai.windowWeek"))}
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("ai.complaintsHint")}
        </p>

        {complaints.length === 0 ? (
          <p className="mt-3 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("ai.emptyComplaints")}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {complaints.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-border bg-card p-3 text-[13px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {s.clientName && (
                      <span className="truncate font-semibold text-foreground">
                        {s.clientName}
                      </span>
                    )}
                    {s.clientId && <ClientFinanceBadges badge={financeMap[s.clientId]} />}
                  </span>
                  {s.occurredAt && (
                    <span dir="ltr" className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                      {s.occurredAt.slice(0, 10)}
                    </span>
                  )}
                </div>
                {/* Source quote — always rendered, per the trust posture */}
                <blockquote className="mt-2 flex gap-2 rounded-md bg-soft-1/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                  <Quote className="mt-0.5 size-3 shrink-0 text-cc-red" />
                  <span>{s.quote}</span>
                </blockquote>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  <span className="rounded bg-soft-2 px-1.5 py-0.5">
                    {t("ai.sourceLabel")}: {s.source}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
