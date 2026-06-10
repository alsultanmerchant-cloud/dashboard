"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  AlertTriangle,
  Loader2,
  TrendingUp,
  Quote,
  Link2,
  Smartphone,
  LayoutGrid,
  TableProperties,
  Search,
  ChevronLeft,
  History,
  CalendarRange,
  ArrowRight,
  Archive,
  ArchiveRestore,
  Lightbulb,
  ArrowRightCircle,
} from "lucide-react";
import { setClientArchivedAction } from "./_actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AnalysisHistoryItem,
  ClientExecutionSnapshot,
  ClientSatisfactionDetail,
  SatisfactionRow,
} from "@/lib/data/satisfaction";

interface Props {
  options: { value: string; label: string }[];
  rows: SatisfactionRow[];
  detail: ClientSatisfactionDetail | null;
  execution: ClientExecutionSnapshot | null;
  selectedId: string | null;
  selectedAnalysisId: string | null;
}

function scoreTone(score: number | null) {
  if (score === null) return { text: "text-muted-foreground", ring: "text-muted-foreground/40" };
  if (score >= 70) return { text: "text-cc-green", ring: "text-cc-green" };
  if (score >= 50) return { text: "text-amber", ring: "text-amber" };
  return { text: "text-cc-red", ring: "text-cc-red" };
}

function Ring({ score, size = 72 }: { score: number | null; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const tone = scoreTone(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className={cn("-rotate-90", tone.ring)} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums",
          tone.text,
        )}
      >
        {score === null ? "—" : score}
      </span>
    </div>
  );
}

export function SatisfactionWorkspace({
  options,
  rows,
  detail,
  execution,
  selectedId,
  selectedAnalysisId,
}: Props) {
  const t = useTranslations("SatisfactionPage");
  const tStages = useTranslations("TasksPage.stages");
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState<"week" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const selRow = useMemo(
    () => rows.find((r) => r.clientId === selectedId) ?? null,
    [rows, selectedId],
  );

  const select = (id: string) => {
    if (id) router.push(`/satisfaction?client=${id}`);
  };

  const toggleArchive = async () => {
    if (!selectedId) return;
    setError(null);
    setArchiving(true);
    try {
      const res = await setClientArchivedAction({
        clientId: selectedId,
        archived: !selRow?.manuallyArchived,
      });
      if (res.error) setError(res.error);
      else router.refresh();
    } finally {
      setArchiving(false);
    }
  };

  // Board cards always analyze the current week (the headline status).
  const analyzeClient = async (clientId: string, windowKind: "week" | "all" = "week") => {
    const res = await fetch("/api/satisfaction/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, windowKind }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "تعذر التحليل");
    router.refresh();
  };

  const analyze = async (windowKind: "week" | "all") => {
    if (!selectedId) return;
    setError(null);
    setAnalyzing(windowKind);
    try {
      await analyzeClient(selectedId, windowKind);
      // After re-analyzing, drop any historical-snapshot selection so the
      // freshly stored result (current week, or the new all-time row) shows.
      if (selectedAnalysisId) router.push(`/satisfaction?client=${selectedId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(null);
    }
  };

  const sentimentLabel = (s: string | null) =>
    s ? t(`sentiment.${s}`) : "—";

  return (
    <div className="space-y-6">
      {/* Client selector + groups admin link */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-md flex-1">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t("selectClient")}
          </label>
          <SearchableSelect
            value={selectedId ?? ""}
            onValueChange={select}
            options={options}
            placeholder={t("selectClientPlaceholder")}
            searchPlaceholder={t("searchClient")}
            emptyMessage={t("noClients")}
            ariaLabel={t("selectClient")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/satisfaction/connect"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-cyan hover:border-cyan/35"
          >
            <Smartphone className="size-3.5" />
            {t("connect.connectLink")}
          </Link>
          <Link
            href="/satisfaction/groups"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-cyan hover:border-cyan/35"
          >
            <Link2 className="size-3.5" />
            {t("groups.manageLink")}
          </Link>
        </div>
      </div>

      {!selectedId ? (
        <SatisfactionOverview rows={rows} onSelect={select} onAnalyze={analyzeClient} t={t} />
      ) : detail ? (
        <div className="space-y-6">
          {error && (
            <p className="flex items-center gap-2 rounded-lg bg-red-dim px-3 py-2 text-sm text-cc-red">
              <AlertTriangle className="size-4" /> {error}
            </p>
          )}

          {/* Analyze — two windows. Current week feeds the board; all time is
              an on-demand full-history snapshot. */}
          <div className="flex flex-wrap items-center gap-3">
            {(() => {
              const hasTranscript =
                !!detail.imports.client || !!detail.imports.technical || detail.hasMessages;
              const busy = analyzing !== null;
              return (
                <>
                  <Button
                    onClick={() => analyze("week")}
                    disabled={busy || !hasTranscript}
                    title={t("analyzeWeekHint")}
                  >
                    {analyzing === "week" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {detail.analysis ? t("reanalyzeWeek") : t("analyzeWeek")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => analyze("all")}
                    disabled={busy || !hasTranscript}
                    title={t("analyzeAllHint")}
                  >
                    {analyzing === "all" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <TrendingUp className="size-4" />
                    )}
                    {t("analyzeAll")}
                  </Button>
                  {!hasTranscript && (
                    <span className="text-xs text-muted-foreground">{t("uploadFirst")}</span>
                  )}
                </>
              );
            })()}
            {detail.analysis && (
              <span className="text-xs text-muted-foreground">
                {t("lastAnalyzed")}: {detail.analysis.createdAt.slice(0, 16).replace("T", " ")}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleArchive}
              disabled={archiving}
              className="ms-auto text-muted-foreground hover:text-foreground"
              title={selRow?.manuallyArchived ? t("restoreHint") : t("archiveHint")}
            >
              {archiving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : selRow?.manuallyArchived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {selRow?.manuallyArchived ? t("restore") : t("archive")}
            </Button>
          </div>

          {/* Real delivery work — delayed tasks tied to this client */}
          {execution && <ExecutionPanel snapshot={execution} t={t} tStages={tStages} />}

          {/* Results */}
          {detail.analysis && (
            <AnalysisView
              analysis={detail.analysis}
              history={detail.history}
              clientId={selectedId}
              t={t}
              sentimentLabel={sentimentLabel}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---- Overview: board + table with view toggle ----------------------------
type BucketKey = "atRisk" | "watch" | "healthy" | "pending";

const BUCKETS: {
  key: BucketKey;
  accent: string; // text + border accent
  bar: string; // top bar bg
  dot: string;
}[] = [
  { key: "atRisk", accent: "text-cc-red", bar: "bg-cc-red", dot: "bg-cc-red" },
  { key: "watch", accent: "text-amber", bar: "bg-amber", dot: "bg-amber" },
  { key: "healthy", accent: "text-cc-green", bar: "bg-cc-green", dot: "bg-cc-green" },
  { key: "pending", accent: "text-muted-foreground", bar: "bg-border", dot: "bg-muted-foreground/40" },
];

function bucketOf(r: SatisfactionRow): BucketKey {
  if (!r.analyzedAt || r.satisfactionScore === null) return "pending";
  if (r.sentiment === "negative" || r.satisfactionScore < 55) return "atRisk";
  if (r.satisfactionScore < 70) return "watch";
  return "healthy";
}

function SatisfactionOverview({
  rows,
  onSelect,
  onAnalyze,
  t,
}: {
  rows: SatisfactionRow[];
  onSelect: (id: string) => void;
  onAnalyze: (id: string) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [view, setView] = useState<"board" | "table">("board");
  const [query, setQuery] = useState("");
  // Active clients (≥1 non-archived project) vs lost/archived relationships.
  // Defaults to "active" so the board isn't dominated by clients we've lost.
  const [relation, setRelation] = useState<"active" | "lost" | "all">("active");

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.hasActiveProject).length,
      lost: rows.filter((r) => !r.hasActiveProject).length,
      all: rows.length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (relation === "active" && !r.hasActiveProject) return false;
      if (relation === "lost" && r.hasActiveProject) return false;
      if (q && !r.clientName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, relation]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          {t("emptyOverview")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search + relation filter + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
            {(["active", "lost", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRelation(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  relation === key
                    ? "bg-soft-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`relationFilter.${key}`)}
                <span className="rounded-full bg-soft-1 px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("clientsCount", { n: filtered.length })}
          </span>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setView("board")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === "board" ? "bg-soft-2 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-3.5" />
              {t("viewBoard")}
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === "table" ? "bg-soft-2 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <TableProperties className="size-3.5" />
              {t("viewTable")}
            </button>
          </div>
        </div>
      </div>

      {view === "board" ? (
        <SatisfactionBoard rows={filtered} onSelect={onSelect} onAnalyze={onAnalyze} t={t} />
      ) : (
        <OverviewTable rows={filtered} onSelect={onSelect} t={t} />
      )}
    </div>
  );
}

// ---- Kanban board (health buckets) ---------------------------------------
function SatisfactionBoard({
  rows,
  onSelect,
  onAnalyze,
  t,
}: {
  rows: SatisfactionRow[];
  onSelect: (id: string) => void;
  onAnalyze: (id: string) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const grouped = useMemo(() => {
    const map: Record<BucketKey, SatisfactionRow[]> = {
      atRisk: [],
      watch: [],
      healthy: [],
      pending: [],
    };
    for (const r of rows) map[bucketOf(r)].push(r);
    return map;
  }, [rows]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {BUCKETS.map((b) => {
        const items = grouped[b.key];
        return (
          <div
            key={b.key}
            className="flex min-h-[8rem] flex-col overflow-hidden rounded-xl border border-border bg-soft-1/40"
          >
            <div className={cn("h-1 w-full", b.bar)} />
            <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", b.dot)} />
                <span className="text-sm font-semibold">{t(`board.${b.key}`)}</span>
                <span className="rounded-full bg-soft-2 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </div>
            </div>
            <p className="px-3 pb-2 text-[10px] leading-snug text-muted-foreground/70">
              {t(`board.${b.key}Hint`)}
            </p>
            <div className="flex flex-1 flex-col gap-2 p-2 pt-0">
              {items.length === 0 ? (
                <p className="px-1 py-4 text-center text-[11px] text-muted-foreground/60">
                  {t("board.emptyColumn")}
                </p>
              ) : (
                items.map((r) => (
                  <BoardCard
                    key={r.clientId}
                    row={r}
                    accent={b.accent}
                    onSelect={onSelect}
                    onAnalyze={onAnalyze}
                    t={t}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  row,
  accent,
  onSelect,
  onAnalyze,
  t,
}: {
  row: SatisfactionRow;
  accent: string;
  onSelect: (id: string) => void;
  onAnalyze: (id: string) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const analyzed = row.satisfactionScore !== null;
  // Analyzable once the client has synced WhatsApp messages.
  const hasImport = row.hasClient || row.hasTechnical || row.hasMessages;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const runAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setErr(false);
    setBusy(true);
    try {
      await onAnalyze(row.clientId);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(row.clientId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(row.clientId);
      }}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-2.5 text-start transition-colors hover:border-cyan/40 hover:bg-soft-1"
    >
      {analyzed ? (
        <Ring score={row.satisfactionScore} size={44} />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground">
          —
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{row.clientName}</span>
          {!row.hasActiveProject && (
            <span className="shrink-0 rounded bg-soft-2 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {t("relationFilter.lostBadge")}
            </span>
          )}
        </p>
        <p className={cn("text-[11px] font-medium", err ? "text-cc-red" : accent)}>
          {row.sentiment ? t(`sentiment.${row.sentiment}`) : t("board.noGroups")}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <Dot on={row.hasClient} label={t("clientGroup")} />
          <Dot on={row.hasTechnical} label={t("technicalGroup")} />
          {row.analyzedAt && (
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              {row.analyzedAt.slice(0, 10)}
            </span>
          )}
        </div>
      </div>
      {!analyzed && hasImport ? (
        <button
          type="button"
          onClick={runAnalyze}
          disabled={busy}
          title={t("board.analyze")}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan/30 bg-soft-2 px-2 py-1 text-[11px] font-medium text-cyan transition-colors hover:bg-cyan/10 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {t("board.analyze")}
        </button>
      ) : (
        <ChevronLeft className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-cyan ltr:rotate-180 rtl:rotate-0" />
      )}
    </div>
  );
}

// ---- Overview table ------------------------------------------------------
function OverviewTable({
  rows,
  onSelect,
  t,
}: {
  rows: SatisfactionRow[];
  onSelect: (id: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="p-3 text-start font-medium">{t("col.client")}</th>
                <th className="p-3 text-center font-medium">{t("col.groups")}</th>
                <th className="p-3 text-center font-medium">{t("col.satisfaction")}</th>
                <th className="p-3 text-center font-medium">{t("col.brief")}</th>
                <th className="p-3 text-center font-medium">{t("col.sentiment")}</th>
                <th className="p-3 text-center font-medium">{t("col.analyzed")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = scoreTone(r.satisfactionScore);
                return (
                  <tr
                    key={r.clientId}
                    onClick={() => onSelect(r.clientId)}
                    className="cursor-pointer border-b border-border/60 transition-colors hover:bg-soft-1"
                  >
                    <td className="p-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {r.clientName}
                        {!r.hasActiveProject && (
                          <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                            {t("relationFilter.lostBadge")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span className="inline-flex gap-1">
                        <Dot on={r.hasClient} label={t("clientGroup")} />
                        <Dot on={r.hasTechnical} label={t("technicalGroup")} />
                      </span>
                    </td>
                    <td className={cn("p-3 text-center font-semibold tabular-nums", tone.text)}>
                      {r.satisfactionScore ?? "—"}
                    </td>
                    <td className="p-3 text-center tabular-nums text-muted-foreground">
                      {r.briefAdherenceScore ?? "—"}
                    </td>
                    <td className="p-3 text-center text-xs text-muted-foreground">
                      {r.sentiment ? t(`sentiment.${r.sentiment}`) : "—"}
                    </td>
                    <td className="p-3 text-center text-xs text-muted-foreground">
                      {r.analyzedAt ? r.analyzedAt.slice(0, 10) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={label}
      className={cn("size-2.5 rounded-full", on ? "bg-cc-green" : "bg-border")}
    />
  );
}

// ---- Execution panel: client's delayed tasks (ties chat → real work) -----
function ExecutionPanel({
  snapshot,
  t,
  tStages,
}: {
  snapshot: ClientExecutionSnapshot;
  t: ReturnType<typeof useTranslations>;
  tStages: ReturnType<typeof useTranslations>;
}) {
  const stageLabel = (s: string) => {
    try {
      return tStages(s);
    } catch {
      return s;
    }
  };
  return (
    <Card className="border-amber/25">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-amber" /> {t("execution.title")}
          </p>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {t("execution.overdueCount", { n: snapshot.overdueCount })}
            </span>
            {snapshot.maxDaysStuck !== null && (
              <span className="tabular-nums">
                {t("execution.maxStuck", { n: snapshot.maxDaysStuck })}
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("execution.hint")}</p>

        {/* by-stage distribution — shows whether delays cluster in one phase */}
        {snapshot.byStage.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {snapshot.byStage.map((s) => (
              <span
                key={s.stage}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-soft-1 px-2 py-1 text-[11px]"
              >
                <span className="text-muted-foreground">{stageLabel(s.stage)}</span>
                <span className="rounded-full bg-soft-2 px-1.5 font-medium tabular-nums">{s.count}</span>
              </span>
            ))}
          </div>
        )}

        {/* worst-stuck tasks */}
        <ul className="mt-3 space-y-1.5">
          {snapshot.topTasks.map((task, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg bg-soft-1/60 px-2.5 py-1.5 text-[13px]"
            >
              <span className="flex min-w-0 items-center gap-2">
                {task.taskCode && (
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/70">
                    {task.taskCode}
                  </span>
                )}
                <span className="truncate">{task.title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px]">
                <span className="rounded bg-soft-2 px-1.5 py-0.5 text-muted-foreground">
                  {stageLabel(task.stage)}
                </span>
                {task.daysStuck !== null && (
                  <span className="tabular-nums text-amber">
                    {t("execution.daysStuck", { n: task.daysStuck })}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---- Analysis view -------------------------------------------------------
const HL_TONE: Record<string, string> = {
  praise: "text-cc-green",
  milestone: "text-cyan",
  request: "text-amber",
  complaint: "text-cc-red",
  escalation: "text-cc-red",
};

const REC_PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const REC_PRIORITY_TONE: Record<string, string> = {
  high: "bg-red-dim text-cc-red",
  medium: "bg-soft-2 text-amber",
  low: "bg-soft-2 text-muted-foreground",
};

function AnalysisView({
  analysis,
  history,
  clientId,
  t,
  sentimentLabel,
}: {
  analysis: NonNullable<ClientSatisfactionDetail["analysis"]>;
  history: AnalysisHistoryItem[];
  clientId: string;
  t: ReturnType<typeof useTranslations>;
  sentimentLabel: (s: string | null) => string;
}) {
  const tone = scoreTone(analysis.satisfactionScore);
  const timeline = analysis.sentimentTimeline ?? [];
  // We're viewing a past snapshot when the shown analysis isn't the current one.
  const viewingPast = !history.some((h) => h.id === analysis.id && h.isCurrent);
  const range = (a: {
    windowKind: string;
    windowStart: string | null;
    windowEnd: string | null;
  }) =>
    a.windowKind === "week" && a.windowStart && a.windowEnd
      ? `${a.windowStart.slice(0, 10)} → ${a.windowEnd.slice(0, 10)}`
      : null;
  return (
    <div className="space-y-4">
      {/* viewing-a-past-snapshot banner */}
      {viewingPast && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-[13px]">
          <span className="inline-flex items-center gap-2 text-amber">
            <History className="size-4" /> {t("history.viewingPast")}
          </span>
          <Link
            href={`/satisfaction?client=${clientId}`}
            className="inline-flex items-center gap-1 font-medium text-cyan hover:underline"
          >
            {t("history.backToCurrent")} <ArrowRight className="size-3.5 ltr:rotate-0 rtl:rotate-180" />
          </Link>
        </div>
      )}

      {/* headline */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex items-center gap-3">
            <Ring score={analysis.satisfactionScore} size={84} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("satisfactionScore")}
              </p>
              <p className={cn("text-sm font-semibold", tone.text)}>
                {sentimentLabel(analysis.sentiment)}
              </p>
              <p className="mt-1 inline-flex items-center gap-1 rounded bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <CalendarRange className="size-3" />
                {t(`window.${analysis.windowKind}`)}
                {range(analysis) && <span className="tabular-nums">· {range(analysis)}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-s border-border ps-6">
            <Ring score={analysis.briefAdherenceScore} size={64} />
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("briefAdherence")}
            </p>
          </div>
          <p className="min-w-[12rem] flex-1 text-sm leading-relaxed text-muted-foreground">
            {analysis.summary}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* sentiment timeline */}
        {timeline.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="size-4 text-cyan" /> {t("timeline")}
              </p>
              <div className="flex items-end gap-2" style={{ height: 100 }}>
                {timeline.map((pt, i) => {
                  const ptTone = scoreTone(pt.score);
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className={cn("w-full rounded-t", ptTone.text)}
                        style={{
                          height: `${Math.max(4, pt.score)}%`,
                          backgroundColor: "currentColor",
                          minHeight: 4,
                        }}
                        title={`${pt.period}: ${pt.score}`}
                      />
                      <span className="text-[9px] text-muted-foreground">
                        {pt.period.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* risks */}
        {analysis.risks.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 text-amber" /> {t("risks")}
              </p>
              <ul className="space-y-1.5">
                {analysis.risks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-muted-foreground">
                    <span className="text-amber">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* recommendations — AI advice grounded in chat + real Rawasm tasks */}
      {analysis.recommendations.length > 0 && (
        <Card className="border-cyan/30">
          <CardContent className="p-4">
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="size-4 text-cyan" /> {t("recommendations")}
            </p>
            <ul className="space-y-3">
              {[...analysis.recommendations]
                .sort(
                  (a, b) => REC_PRIORITY_RANK[a.priority] - REC_PRIORITY_RANK[b.priority],
                )
                .map((rec, i) => (
                  <li key={i} className="rounded-lg border border-border bg-soft-1 p-3">
                    <div className="mb-1.5 flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                          REC_PRIORITY_TONE[rec.priority],
                        )}
                      >
                        {t(`recPriority.${rec.priority}`)}
                      </span>
                      <span className="text-[13px] font-medium leading-snug">{rec.issue}</span>
                    </div>
                    <p className="flex items-start gap-1.5 text-[13px] text-cyan">
                      <ArrowRightCircle className="mt-0.5 size-3.5 shrink-0" />
                      {rec.action}
                    </p>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* highlights */}
      {analysis.highlights.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <Quote className="size-4 text-cyan" /> {t("highlights")}
            </p>
            <ul className="space-y-2">
              {[...analysis.highlights]
                // Client-facing items first; internal team items grouped after.
                // Within each group, oldest → newest (undated items sort last).
                .sort((a, b) => {
                  const teamDelta =
                    (a.audience === "team" ? 1 : 0) - (b.audience === "team" ? 1 : 0);
                  if (teamDelta !== 0) return teamDelta;
                  const ad = a.date || "9999-99-99";
                  const bd = b.date || "9999-99-99";
                  return ad.localeCompare(bd);
                })
                .map((h, i) => {
                  const isTeam = h.audience === "team";
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex items-start justify-between gap-3 text-[13px]",
                        isTeam && "opacity-70",
                      )}
                    >
                      <span className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-0.5 text-xs font-semibold",
                            HL_TONE[h.type] ?? "text-muted-foreground",
                          )}
                        >
                          {t(`highlightType.${h.type}`)}
                        </span>
                        {isTeam && (
                          <span className="mt-0.5 shrink-0 rounded bg-soft-2 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                            {t("highlightAudience.team")}
                          </span>
                        )}
                        <span className="text-muted-foreground">{h.text}</span>
                      </span>
                      {h.date && (
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                          {h.date}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* past analyses — click to view an earlier snapshot */}
      <HistoryList history={history} clientId={clientId} shownId={analysis.id} t={t} />
    </div>
  );
}

// ---- Past-analyses history ----------------------------------------------
function HistoryList({
  history,
  clientId,
  shownId,
  t,
}: {
  history: AnalysisHistoryItem[];
  clientId: string;
  shownId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (history.length <= 1) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-cyan" /> {t("history.title")}
        </p>
        <ul className="space-y-1.5">
          {history.map((h) => {
            const tone = scoreTone(h.satisfactionScore);
            const isShown = h.id === shownId;
            const href = h.isCurrent
              ? `/satisfaction?client=${clientId}`
              : `/satisfaction?client=${clientId}&analysis=${h.id}`;
            return (
              <li key={h.id}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-[13px] transition-colors",
                    isShown
                      ? "border-cyan/40 bg-soft-1"
                      : "border-border bg-card hover:border-cyan/30 hover:bg-soft-1",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("text-base font-bold tabular-nums", tone.text)}>
                      {h.satisfactionScore ?? "—"}
                    </span>
                    <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t(`window.${h.windowKind}`)}
                    </span>
                    {h.isCurrent && (
                      <span className="rounded bg-cc-green/15 px-1.5 py-0.5 text-[10px] font-medium text-cc-green">
                        {t("history.current")}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {h.sentiment ? t(`sentiment.${h.sentiment}`) : "—"}
                    </span>
                    <span className="tabular-nums text-muted-foreground/70">
                      {h.createdAt.slice(0, 10)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
