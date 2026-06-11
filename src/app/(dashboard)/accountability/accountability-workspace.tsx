"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Search,
  Sparkles,
  Timer,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type {
  AccountabilityEvidence,
  AccountabilityOverview,
  AccountabilityRole,
  AccountabilityScorecardRow,
  AiLinkedSignal,
  ReviewerRigorRow,
} from "@/lib/data/accountability";

const NA = "—";
const SCORECARD_PAGE_SIZE = 5;

interface Props {
  overview: AccountabilityOverview;
  evidence: AccountabilityEvidence | null;
  selectedId: string | null;
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

export function AccountabilityWorkspace({ overview, evidence, selectedId }: Props) {
  const t = useTranslations("AccountabilityPage");
  const tStages = useTranslations("TasksBoard.stages");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<AccountabilityRole | "all">("all");

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

  const roleCounts = useMemo(() => {
    const counts: Record<AccountabilityRole | "all", number> = {
      all: overview.rows.length,
      agent: 0,
      account_manager: 0,
      team_manager: 0,
    };
    for (const r of overview.rows) counts[r.role] += 1;
    return counts;
  }, [overview.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview.rows
      .filter((r) => {
        if (roleFilter !== "all" && r.role !== roleFilter) return false;
        if (q && !r.fullName.toLowerCase().includes(q)) return false;
        return true;
      })
      // Worst measurable first; low-confidence and unmeasured sink to the end
      // so a 2-event sample never headlines the board.
      .sort((a, b) => {
        const rank = (r: AccountabilityScorecardRow) =>
          r.score === null ? 2 : r.confidence === "low" ? 1 : 0;
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return (a.score ?? 999) - (b.score ?? 999);
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
    { icon: Users, label: t("stats.measured"), value: String(stats.measured), tone: "text-cyan" },
    {
      icon: Gauge,
      label: t("stats.medianScore"),
      value: stats.median == null ? NA : `${stats.median}%`,
      tone: scoreTone(stats.median, false),
    },
    {
      icon: AlertTriangle,
      label: t("stats.overdueOwned"),
      value: String(stats.overdueOwned),
      tone: stats.overdueOwned > 0 ? "text-cc-red" : "text-cc-green",
    },
    {
      icon: Hourglass,
      label: t("stats.lowConfidence"),
      value: String(stats.lowConfidence),
      tone: "text-muted-foreground",
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
                <span dir="ltr">{s.value}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar: search + role filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className="h-9 w-full rounded-lg border border-border bg-card ps-8 pe-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-cyan/40"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(["all", "agent", "account_manager", "team_manager"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                roleFilter === key
                  ? "bg-soft-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "all" ? t("roleFilter.all") : t(`role.${key}`)}
              <span className="rounded-full bg-soft-1 px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {roleCounts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Scorecard board */}
      <ScorecardTable
        key={`${roleFilter}:${query}`}
        rows={filtered}
        selectedId={selectedId}
        onSelect={select}
        fmtMinutes={fmtMinutes}
        t={t}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewerRigorSection
          reviewers={overview.reviewers}
          onSelect={select}
          fmtMinutes={fmtMinutes}
          t={t}
        />
        <CoveragePanel coverage={overview.coverage} t={t} />
      </div>

      {/* Tier-B: AI-linked signals — always quoted, always labeled, never scored */}
      <AiLinkedSection signals={overview.aiSignals} t={t} />

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
                <th className="px-3 py-3 text-start font-semibold text-foreground">{t("col.score")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("col.onTime")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("col.avgDwell")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("col.rework")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("col.openTasks")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("col.overdue")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("col.sample")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleRows.map((r) => {
                const low = r.confidence === "low";
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
                        {t(`role.${r.role}`)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex min-w-14 justify-center rounded-md border px-2 py-1 text-sm font-bold tabular-nums",
                            scoreBadgeTone(r.score, low),
                          )}
                          dir="ltr"
                        >
                          {r.score === null ? NA : `${r.score}%`}
                        </span>
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
            <p className="mt-1 text-[11px] text-muted-foreground">{t("evidence.hint")}</p>
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
  reviewers: ReviewerRigorRow[];
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
        {/* Honesty label: stage-history mode credits the assigned team
            manager, not the person who actually moved the task. */}
        {reviewers.some((r) => r.attribution === "stage_history_assignment") && (
          <p className="mt-2 rounded-md border border-amber/20 bg-amber/5 px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground">
            {t("reviewers.attributedNote")}
          </p>
        )}

        {reviewers.length === 0 ? (
          <p className="mt-3 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("reviewers.empty")}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="p-2 text-start font-medium">{t("reviewers.col.reviewer")}</th>
                  <th className="p-2 text-center font-medium">{t("reviewers.col.reviews")}</th>
                  <th className="p-2 text-center font-medium">{t("reviewers.col.medianTime")}</th>
                  <th className="p-2 text-center font-medium">{t("reviewers.col.fastShare")}</th>
                  <th className="p-2 text-center font-medium">{t("reviewers.col.rework")}</th>
                  <th className="p-2 text-center font-medium">{t("reviewers.col.pending")}</th>
                </tr>
              </thead>
              <tbody>
                {reviewers.map((r) => {
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
      </CardContent>
    </Card>
  );
}

// ---- Coverage panel ---------------------------------------------------------
function CoveragePanel({
  coverage,
  t,
}: {
  coverage: AccountabilityOverview["coverage"];
  t: ReturnType<typeof useTranslations>;
}) {
  const pct = (num: number, den: number): string =>
    den > 0 ? `${Math.round((num / den) * 100)}%` : NA;

  const rows = [
    { label: t("coverage.totalTasks"), value: String(coverage.totalTasks), share: null },
    {
      label: t("coverage.withHistory"),
      value: String(coverage.tasksWithHistory),
      share: pct(coverage.tasksWithHistory, coverage.totalTasks),
    },
    {
      label: t("coverage.withAgent"),
      value: String(coverage.tasksWithAgent),
      share: pct(coverage.tasksWithAgent, coverage.tasksWithHistory),
    },
    {
      label: t("coverage.withAm"),
      value: String(coverage.tasksWithAccountManager),
      share: pct(coverage.tasksWithAccountManager, coverage.tasksWithHistory),
    },
    {
      label: t("coverage.overdueDistinct"),
      value: String(coverage.distinctOverdueTasks),
      share: null,
    },
    {
      label: t("coverage.archivedExcluded"),
      value: String(coverage.archivedExcluded),
      share: null,
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="size-4 text-cyan" /> {t("coverage.title")}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("coverage.hint")}
        </p>
        <ul className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center justify-between gap-3 rounded-lg bg-soft-1/60 px-2.5 py-1.5 text-[13px]"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold tabular-nums" dir="ltr">
                  {row.value}
                </span>
                {row.share && (
                  <span
                    className="rounded bg-soft-2 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                    dir="ltr"
                  >
                    {row.share}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground/70">
          {t("coverage.window")}{" "}
          <span dir="ltr" className="tabular-nums">
            {coverage.windowStart && coverage.windowEnd
              ? `${coverage.windowStart.slice(0, 10)} → ${coverage.windowEnd.slice(0, 10)}`
              : t("coverage.allTime")}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

// ---- Tier-B: AI-linked signals ----------------------------------------------
const KIND_TONES: Record<string, string> = {
  complaint: "text-cc-red",
  praise: "text-cc-green",
  delay_mention: "text-amber",
  risk: "text-amber",
};

const KNOWN_KINDS = new Set(["complaint", "praise", "delay_mention", "risk"]);

function AiLinkedSection({
  signals,
  t,
}: {
  signals: AiLinkedSignal[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-cyan" /> {t("ai.title")}
          </p>
          <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan">
            {t("ai.badge")}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("ai.hint")}</p>

        {signals.length === 0 ? (
          <p className="mt-3 rounded-lg bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("ai.empty")}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {signals.map((s) => {
              const kindKey = KNOWN_KINDS.has(s.kind) ? s.kind : "other";
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-border bg-card p-3 text-[13px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          KIND_TONES[s.kind] ?? "text-muted-foreground",
                        )}
                      >
                        {t(`ai.kind.${kindKey}`)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan">
                        <Sparkles className="size-2.5" />
                        {t("ai.badge")}
                      </span>
                    </span>
                    {s.occurredAt && (
                      <span dir="ltr" className="text-[10px] tabular-nums text-muted-foreground/70">
                        {s.occurredAt.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  {/* Source quote — always rendered, per the trust posture */}
                  <blockquote className="mt-2 flex gap-2 rounded-md bg-soft-1/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                    <Quote className="mt-0.5 size-3 shrink-0 text-cyan" />
                    <span>{s.quote}</span>
                  </blockquote>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {s.clientName && (
                      <span className="rounded bg-soft-2 px-1.5 py-0.5">{s.clientName}</span>
                    )}
                    <span className="rounded bg-soft-2 px-1.5 py-0.5">
                      {t("ai.sourceLabel")}: {s.source}
                    </span>
                  </div>
                  {/* Related open work — the client's overdue tasks. Context
                      for the conversation, never presented as the cause. */}
                  {s.relatedOpenTasks.length > 0 && (
                    <div className="mt-2 border-t border-border/60 pt-2">
                      <p
                        className="text-[10px] font-medium text-muted-foreground"
                        title={t("ai.relatedWorkHint")}
                      >
                        {t("ai.relatedWork")}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {s.relatedOpenTasks.map((rt) => (
                          <li key={rt.taskId}>
                            <Link
                              href={`/tasks/${rt.taskId}`}
                              className="flex flex-wrap items-center gap-1.5 rounded-md bg-soft-1/60 px-2 py-1 text-[11px] transition-colors hover:bg-soft-1"
                            >
                              {rt.taskCode && (
                                <span dir="ltr" className="shrink-0 text-[9px] tabular-nums text-cyan">
                                  {rt.taskCode}
                                </span>
                              )}
                              <span className="max-w-[16rem] truncate">{rt.title}</span>
                              {rt.assigneeNames && (
                                <span className="ms-auto shrink-0 text-[9px] text-muted-foreground">
                                  {rt.assigneeNames}
                                </span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
