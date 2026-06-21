"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo, useRef } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useTranslations } from "next-intl";
import { SatisfactionSchema } from "@/lib/satisfaction-schema";
import {
  Sparkles,
  AlertTriangle,
  Loader2,
  TrendingUp,
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
  FileQuestion,
  Upload,
  FileUp,
  CheckCircle2,
  ShieldAlert,
  Activity,
  Wrench,
  MessagesSquare,
  GitBranch,
  FileSignature,
  FileText,
  ExternalLink,
  XCircle,
  MinusCircle,
  HelpCircle,
  ClipboardList,
} from "lucide-react";
import {
  attachClientBriefLinkAction,
  uploadClientBriefFileAction,
  setClientArchivedAction,
} from "./_actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ClientFinanceBadges } from "@/components/client-finance-badges";
import { MetricInfo, Explained } from "@/components/metric-info";
import type { ClientFinanceBadge, ClientFinanceMap } from "@/lib/data/client-finance";
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
  options: { value: string; label: string; keywords?: string | null }[];
  rows: SatisfactionRow[];
  detail: ClientSatisfactionDetail | null;
  execution: ClientExecutionSnapshot | null;
  selectedId: string | null;
  selectedAnalysisId: string | null;
  financeMap: ClientFinanceMap;
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
  financeMap,
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
    // The route returns JSON on success and on handled errors, but a platform
    // timeout on a long full-history run ("all") replies with a plain-text page,
    // so parse defensively — otherwise res.json() throws a cryptic
    // "Unexpected token 'A'…" instead of a readable message.
    const raw = await res.text();
    let data: { error?: string } = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      /* non-JSON body (timeout / gateway error) */
    }
    if (!res.ok) {
      throw new Error(
        data.error ??
          (res.status === 504 || res.status === 408 || res.status === 502
            ? "استغرق التحليل الكامل وقتًا أطول من المسموح. جرّب «تحليل الأسبوع»، أو أعد المحاولة لاحقًا."
            : `تعذر التحليل (${res.status})`),
      );
    }
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

  // Streaming "re-analyze (week)": the summary streams live while the rest of
  // the analysis is generated; on finish we reload so the freshly-persisted
  // full analysis renders (the body keeps rendering from the server-fetched
  // analysis, so partial arrays never hit the rich cards).
  const satStream = useObject({
    api: "/api/satisfaction/analyze/stream",
    schema: SatisfactionSchema,
    onError: (e) => setError(e instanceof Error ? e.message : "تعذر التحليل"),
    onFinish: ({ object }) => {
      if (!object || !selectedId) return;
      if (selectedAnalysisId) router.push(`/satisfaction?client=${selectedId}`);
      else router.refresh();
    },
  });
  const streamWeek = () => {
    if (!selectedId) return;
    setError(null);
    satStream.submit({ clientId: selectedId, windowKind: "week" });
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
        <SatisfactionOverview rows={rows} financeMap={financeMap} onSelect={select} onAnalyze={analyzeClient} t={t} />
      ) : detail ? (
        <div className="space-y-6">
          {error && (
            <p className="flex items-center gap-2 rounded-lg bg-red-dim px-3 py-2 text-sm text-cc-red">
              <AlertTriangle className="size-4" /> {error}
            </p>
          )}

          {selectedId && financeMap[selectedId] && (
            <ClientFinanceBadges badge={financeMap[selectedId]} size="md" />
          )}

          {/* Analyze — two windows. Current week feeds the board; all time is
              an on-demand full-history snapshot. */}
          <div className="flex flex-wrap items-center gap-3">
            {(() => {
              const hasTranscript =
                !!detail.imports.client || !!detail.imports.technical || detail.hasMessages;
              const busy = analyzing !== null || satStream.isLoading;
              return (
                <>
                  <Button
                    onClick={streamWeek}
                    disabled={busy || !hasTranscript}
                    title={t("analyzeWeekHint")}
                  >
                    {satStream.isLoading ? (
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

          {/* Live streaming preview while re-analyzing — the summary streams in;
              the full analysis below reloads once it finishes. */}
          {satStream.isLoading && (
            <div className="rounded-xl border border-cyan/25 bg-cyan/[0.04] p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan">
                <Loader2 className="size-3.5 animate-spin" />
                {t("analyzing")}
              </p>
              <p className="text-sm leading-7 text-foreground/85">
                {satStream.object?.summary ?? "…"}
              </p>
            </div>
          )}

          {/* Results */}
          {detail.analysis && (
            <AnalysisView
              analysis={detail.analysis}
              history={detail.history}
              execution={execution}
              clientId={selectedId}
              activeProjects={detail.activeProjects}
              brief={detail.brief}
              t={t}
              sentimentLabel={sentimentLabel}
            />
          )}

          {/* Real delivery work — delayed tasks tied to this client */}
          {execution && <ExecutionPanel snapshot={execution} t={t} tStages={tStages} />}
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
  financeMap,
  onSelect,
  onAnalyze,
  t,
}: {
  rows: SatisfactionRow[];
  financeMap: ClientFinanceMap;
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
          <MetricInfo
            text={t("metricTooltips.satisfaction_relationCounts")}
            label={t("relationFilter.all")}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {t("clientsCount", { n: filtered.length })}
            <MetricInfo
              text={t("metricTooltips.satisfaction_clientsCount")}
              label={t("clientsCount", { n: filtered.length })}
            />
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
        <SatisfactionBoard rows={filtered} financeMap={financeMap} onSelect={onSelect} onAnalyze={onAnalyze} t={t} />
      ) : (
        <OverviewTable rows={filtered} financeMap={financeMap} onSelect={onSelect} t={t} />
      )}
    </div>
  );
}

// ---- Kanban board (health buckets) ---------------------------------------
function SatisfactionBoard({
  rows,
  financeMap,
  onSelect,
  onAnalyze,
  t,
}: {
  rows: SatisfactionRow[];
  financeMap: ClientFinanceMap;
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
                <MetricInfo
                  text={t(`metricTooltips.satisfaction_bucket_${b.key}`)}
                  label={t(`board.${b.key}`)}
                />
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
                    finance={financeMap[r.clientId]}
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
  finance,
  accent,
  onSelect,
  onAnalyze,
  t,
}: {
  row: SatisfactionRow;
  finance: ClientFinanceBadge | undefined;
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
        <ClientFinanceBadges badge={finance} className="mt-0.5" />
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
          {row.stale && (
            <span
              title={t("board.staleHint")}
              className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400"
            >
              {t("board.staleBadge")}
            </span>
          )}
        </div>
      </div>
      {(!analyzed || row.stale) && hasImport ? (
        <button
          type="button"
          onClick={runAnalyze}
          disabled={busy}
          title={row.stale ? t("board.staleHint") : t("board.analyze")}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan/30 bg-soft-2 px-2 py-1 text-[11px] font-medium text-cyan transition-colors hover:bg-cyan/10 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {row.stale ? t("board.reanalyze") : t("board.analyze")}
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
  financeMap,
  onSelect,
  t,
}: {
  rows: SatisfactionRow[];
  financeMap: ClientFinanceMap;
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
                <th className="p-3 text-center font-medium">
                  <span className="inline-flex items-center justify-center gap-1">
                    {t("col.satisfaction")}
                    <MetricInfo text={t("help.satisfaction")} label={t("col.satisfaction")} />
                  </span>
                </th>
                <th className="p-3 text-center font-medium">
                  <span className="inline-flex items-center justify-center gap-1">
                    {t("col.brief")}
                    <MetricInfo text={t("help.brief")} label={t("col.brief")} />
                  </span>
                </th>
                <th className="p-3 text-center font-medium">
                  <span className="inline-flex items-center justify-center gap-1">
                    {t("col.sentiment")}
                    <MetricInfo text={t("help.sentiment")} label={t("col.sentiment")} />
                  </span>
                </th>
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
                      <ClientFinanceBadges badge={financeMap[r.clientId]} className="ms-1.5" />
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
                    <td className="p-3 text-center text-xs tabular-nums text-muted-foreground">
                      {r.analyzedAt && r.briefAdherenceScore === null ? (
                        <span className="rounded bg-amber/10 px-1.5 py-0.5 font-medium text-amber">
                          {t("briefMissingShort")}
                        </span>
                      ) : (
                        r.briefAdherenceScore ?? "—"
                      )}
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
            <Explained text={t("metricTooltips.satisfaction_execOverdueCount")}>
              <span className="tabular-nums">
                {t("execution.overdueCount", { n: snapshot.overdueCount })}
              </span>
            </Explained>
            {snapshot.maxDaysStuck !== null && (
              <Explained text={t("metricTooltips.satisfaction_execMaxStuck")}>
                <span className="tabular-nums">
                  {t("execution.maxStuck", { n: snapshot.maxDaysStuck })}
                </span>
              </Explained>
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
                <Explained text={t("metricTooltips.satisfaction_execStageCount")}>
                  <span className="rounded-full bg-soft-2 px-1.5 font-medium tabular-nums">{s.count}</span>
                </Explained>
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
                  <Explained text={t("metricTooltips.satisfaction_execDaysStuck")}>
                    <span className="tabular-nums text-amber">
                      {t("execution.daysStuck", { n: task.daysStuck })}
                    </span>
                  </Explained>
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
const REC_PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const REC_PRIORITY_TONE: Record<string, string> = {
  high: "bg-red-dim text-cc-red",
  medium: "bg-soft-2 text-amber",
  low: "bg-soft-2 text-muted-foreground",
};

type ExecutiveTab = "critical" | "timeline";
type TimelineRange = "7" | "30" | "90" | "all";
type EventFilter = "all" | "complaint" | "approval" | "delay" | "internal" | "decision";
type ClientTimelineEvent = {
  id: string;
  title: string;
  date: string | null;
  source: "client" | "technical" | "system";
  category: Exclude<EventFilter, "all">;
  critical: boolean;
  severity: "critical" | "high" | "medium" | "low";
};

function parseTime(date: string | null): number {
  if (!date) return 0;
  const ts = new Date(date).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function formatEventDate(date: string | null) {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date.slice(0, 10);
  return new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function highlightCategory(type: string, text: string, audience: string): ClientTimelineEvent["category"] {
  const body = text.toLowerCase();
  if (audience === "team") return "internal";
  if (type === "complaint" || type === "escalation") return "complaint";
  if (type === "milestone" || /اعتماد|اعتمد|وافق|موافقة|approved|approval/.test(body)) return "approval";
  if (/تأخير|متأخر|اتأخر|تأخر|delay|late|deadline|موعد/.test(body)) return "delay";
  if (/قرار|تقرر|قرر|decided|decision/.test(body)) return "decision";
  return "decision";
}

function taskEventDate(task: ClientExecutionSnapshot["topTasks"][number]) {
  return task.dueDate ?? task.stageEnteredAt ?? null;
}

// Short label for a contract activity-log event (mirrors log-type-meta keys).
function contractEventLabel(logType: string): string {
  if (/Lost/i.test(logType)) return "📄 إغلاق العقد (خسارة)";
  if (/Renew/i.test(logType)) return "📄 تجديد العقد";
  if (/LIFTED/i.test(logType)) return "📄 رفع تجميد العقد";
  if (/HOLD/i.test(logType)) return "📄 تجميد العقد";
  if (/EDIT MODE ON/i.test(logType)) return "📄 بدء تعديل بنود العقد";
  if (/EDIT MODE OFF/i.test(logType)) return "📄 انتهاء تعديل بنود العقد";
  return `📄 ${logType}`;
}

function buildClientTimelineEvents(
  analysis: NonNullable<ClientSatisfactionDetail["analysis"]>,
  execution: ClientExecutionSnapshot | null,
): ClientTimelineEvent[] {
  const events: ClientTimelineEvent[] = [];

  analysis.highlights.forEach((h, index) => {
    const category = highlightCategory(h.type, h.text, h.audience);
    const critical = h.type === "complaint" || h.type === "escalation";
    events.push({
      id: `highlight-${index}`,
      title: h.text,
      date: h.date ?? analysis.createdAt,
      source: h.audience === "team" ? "technical" : "client",
      category,
      critical,
      severity: h.type === "escalation" ? "critical" : critical ? "high" : "medium",
    });
  });

  if (execution && execution.overdueCount > 0) {
    const newestTaskDate =
      execution.topTasks.map(taskEventDate).sort((a, b) => parseTime(b) - parseTime(a))[0] ?? null;
    events.push({
      id: "system-overdue-summary",
      title: `يوجد ${execution.overdueCount} مهام متأخرة في المشروع`,
      date: newestTaskDate ?? analysis.createdAt,
      source: "system",
      category: "delay",
      critical: true,
      severity: execution.overdueCount >= 8 ? "critical" : execution.overdueCount >= 4 ? "high" : "medium",
    });

    execution.topTasks.slice(0, 6).forEach((task, index) => {
      events.push({
        id: `task-delay-${index}`,
        title: `${task.taskCode ? `${task.taskCode} · ` : ""}${task.title}`,
        date: taskEventDate(task),
        source: "system",
        category: "delay",
        critical: (task.delayDays ?? 0) >= 3 || (task.daysStuck ?? 0) >= 7,
        severity: (task.delayDays ?? 0) >= 5 || (task.daysStuck ?? 0) >= 14 ? "high" : "medium",
      });
    });
  }

  // Contract activity-log events — holds/edits/close/renew as dated timeline
  // entries. Lost/Hold are critical; Renew reads as a positive (approval) beat.
  (analysis.contractContext?.recentActivity ?? []).slice(0, 6).forEach((ev, index) => {
    const isLost = /Lost/i.test(ev.logType);
    const isRenew = /Renew/i.test(ev.logType);
    const isHold = /HOLD/i.test(ev.logType) && !/LIFTED/i.test(ev.logType);
    const critical = isLost || isHold;
    const note = ev.notes ? ev.notes.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    events.push({
      id: `contract-${index}`,
      title: `${contractEventLabel(ev.logType)}${note ? ` — ${note}` : ""}`,
      date: ev.logTime ?? analysis.createdAt,
      source: "system",
      category: isRenew ? "approval" : critical ? "complaint" : "decision",
      critical,
      severity: isLost ? "critical" : isHold ? "high" : "medium",
    });
  });

  return events.sort((a, b) => parseTime(b.date) - parseTime(a.date));
}

function buildFallbackRecommendations(
  analysis: NonNullable<ClientSatisfactionDetail["analysis"]>,
  execution: ClientExecutionSnapshot | null,
) {
  const recs = [...analysis.recommendations];
  if (execution && execution.overdueCount > 0 && recs.length < 6) {
    const stage = execution.byStage[0]?.stage;
    recs.push({
      priority: execution.overdueCount >= 4 ? ("high" as const) : ("medium" as const),
      issue: `يوجد ${execution.overdueCount} مهام متأخرة${stage ? `، أكثرها في مرحلة ${stage}` : ""}.`,
      action: "تحديد مالك لكل مهمة متأخرة وإرسال موعد تسليم واضح للعميل خلال 48 ساعة.",
    });
  }
  if (analysis.risks.length > 0 && recs.length < 6) {
    recs.push({
      priority: "medium" as const,
      issue: analysis.risks[0],
      action: "تحويل الخطر إلى قرار متابعة: من المسؤول، ما الإجراء، وما موعد الإغلاق.",
    });
  }
  return recs.slice(0, 6);
}

function AnalysisView({
  analysis,
  history,
  execution,
  clientId,
  activeProjects,
  brief,
  t,
  sentimentLabel,
}: {
  analysis: NonNullable<ClientSatisfactionDetail["analysis"]>;
  history: AnalysisHistoryItem[];
  execution: ClientExecutionSnapshot | null;
  clientId: string;
  activeProjects: ClientSatisfactionDetail["activeProjects"];
  brief: ClientSatisfactionDetail["brief"];
  t: ReturnType<typeof useTranslations>;
  sentimentLabel: (s: string | null) => string;
}) {
  const tone = scoreTone(analysis.satisfactionScore);
  const timeline = analysis.sentimentTimeline ?? [];
  const briefMissing = analysis.briefAdherenceScore === null;
  const [activeTab, setActiveTab] = useState<ExecutiveTab>("critical");
  const [timelineRange, setTimelineRange] = useState<TimelineRange>("7");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const clientEvents = useMemo(
    () => buildClientTimelineEvents(analysis, execution),
    [analysis, execution],
  );
  const criticalEvents = useMemo(
    () => clientEvents.filter((event) => event.critical).slice(0, 8),
    [clientEvents],
  );
  const recommendations = useMemo(
    () => buildFallbackRecommendations(analysis, execution),
    [analysis, execution],
  );
  const visibleTimelineEvents = useMemo(() => {
    const anchorDate = Math.max(
      parseTime(analysis.createdAt),
      ...clientEvents.map((event) => parseTime(event.date)),
    );
    const minDate =
      timelineRange === "all"
        ? null
        : anchorDate - Number(timelineRange) * 86_400_000;
    return clientEvents.filter((event) => {
      if (eventFilter !== "all" && event.category !== eventFilter) return false;
      if (minDate === null) return true;
      return parseTime(event.date) >= minDate;
    });
  }, [analysis.createdAt, clientEvents, eventFilter, timelineRange]);
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
      <Card className="border-cyan/25">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-cyan" /> {t("executive.title")}
              </p>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {analysis.summary}
                {execution && execution.overdueCount > 0
                  ? ` ${t("executive.deliveryRisk", { n: execution.overdueCount })}`
                  : ""}
              </p>
            </div>
            <Explained text={t("metricTooltips.satisfaction_riskBadge")}>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  analysis.satisfactionScore < 55 || analysis.sentiment === "negative"
                    ? "border-cc-red/30 bg-red-dim text-cc-red"
                    : analysis.satisfactionScore < 70 || (execution?.overdueCount ?? 0) > 0
                      ? "border-amber/30 bg-amber/10 text-amber"
                      : "border-cc-green/30 bg-green-dim text-cc-green",
                )}
              >
                {analysis.satisfactionScore < 55 || analysis.sentiment === "negative"
                  ? t("executive.riskHigh")
                  : analysis.satisfactionScore < 70 || (execution?.overdueCount ?? 0) > 0
                    ? t("executive.riskMedium")
                    : t("executive.riskLow")}
              </span>
            </Explained>
          </div>
          <div className="flex flex-wrap items-center gap-6 border-t border-border pt-4">
          <div className="flex items-center gap-3">
            <Ring score={analysis.satisfactionScore} size={84} />
            <div>
              <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("satisfactionScore")}
                <MetricInfo
                  text={t("metricTooltips.satisfaction_score")}
                  label={t("satisfactionScore")}
                />
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
            {briefMissing ? (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed border-amber/50 bg-amber/10 text-amber">
                <FileQuestion className="size-6" />
              </span>
            ) : (
              <Ring score={analysis.briefAdherenceScore} size={64} />
            )}
            <div>
              <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("briefAdherence")}
                <MetricInfo
                  text={t("metricTooltips.satisfaction_briefAdherence")}
                  label={t("briefAdherence")}
                />
              </p>
              {briefMissing ? (
                <p className="mt-1 text-[11px] font-medium text-amber">
                  {t("briefMissingShort")}
                </p>
              ) : (
                brief && <BriefLink brief={brief} />
              )}
            </div>
          </div>
          <p className="min-w-[12rem] flex-1 text-sm leading-relaxed text-muted-foreground">
            {analysis.risks[0] ?? t("executive.noMajorRisk")}
          </p>
          </div>
        </CardContent>
      </Card>

      {briefMissing && (
        <MissingBriefPanel clientId={clientId} activeProjects={activeProjects} t={t} />
      )}

      {/* لماذا هذه الدرجة — per-requirement brief-adherence breakdown */}
      {!briefMissing && analysis.briefAdherence && (
        <BriefAdherencePanel
          breakdown={analysis.briefAdherence}
          score={analysis.briefAdherenceScore}
          t={t}
        />
      )}

      {/* الصورة الكبرى — each source rolled up into one account-health verdict */}
      <BigPicturePanel bigPicture={analysis.bigPicture} contract={analysis.contractContext} t={t} />

      {/* المؤشرات — the risk/operational taxonomy */}
      <IndicatorsPanel indicators={analysis.indicators} t={t} />

      {/* per-source signal extraction */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ClientSignalsPanel signals={analysis.clientGroupSignals} t={t} />
        <TechnicalSignalsPanel signals={analysis.technicalGroupSignals} t={t} />
      </div>

      {/* أسباب المشاكل */}
      <CausesPanel causes={analysis.causes} t={t} />

      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
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
            {tab === "critical" ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <History className="size-3.5" />
            )}
            {t(`executive.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === "critical" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <CriticalEventsPanel events={criticalEvents} t={t} />
          <RecommendationsPanel recommendations={recommendations} t={t} />
        </div>
      ) : (
        <ClientTimelinePanel
          events={visibleTimelineEvents}
          range={timelineRange}
          filter={eventFilter}
          onRangeChange={setTimelineRange}
          onFilterChange={setEventFilter}
          sentimentTimeline={timeline}
          t={t}
        />
      )}

      {/* past analyses — click to view an earlier snapshot */}
      <HistoryList history={history} clientId={clientId} shownId={analysis.id} t={t} />
    </div>
  );
}

function EventSourceBadge({
  source,
  t,
}: {
  source: ClientTimelineEvent["source"];
  t: ReturnType<typeof useTranslations>;
}) {
  const tone =
    source === "client"
      ? "border-cyan/25 bg-cyan/10 text-cyan"
      : source === "technical"
        ? "border-amber/25 bg-amber/10 text-amber"
        : "border-border bg-soft-2 text-muted-foreground";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", tone)}>
      {t(`executive.source.${source}`)}
    </span>
  );
}

function EventCategoryBadge({
  category,
  t,
}: {
  category: ClientTimelineEvent["category"];
  t: ReturnType<typeof useTranslations>;
}) {
  const tone: Record<ClientTimelineEvent["category"], string> = {
    complaint: "bg-red-dim text-cc-red",
    approval: "bg-green-dim text-cc-green",
    delay: "bg-amber/10 text-amber",
    internal: "bg-soft-2 text-muted-foreground",
    decision: "bg-cyan/10 text-cyan",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", tone[category])}>
      {t(`executive.category.${category}`)}
    </span>
  );
}

function EventRow({
  event,
  t,
}: {
  event: ClientTimelineEvent;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug">
          {event.critical && <span className="me-1 text-amber">⚠️</span>}
          {event.title}
        </p>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatEventDate(event.date)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <EventSourceBadge source={event.source} t={t} />
        <EventCategoryBadge category={event.category} t={t} />
      </div>
    </li>
  );
}

function CriticalEventsPanel({
  events,
  t,
}: {
  events: ClientTimelineEvent[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="border-amber/25">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-amber" /> {t("executive.criticalTitle")}
          </p>
          <span className="text-[11px] text-muted-foreground">{t("executive.latestFirst")}</span>
        </div>
        {events.length > 0 ? (
          <ul className="space-y-2">
            {events.map((event) => (
              <EventRow key={event.id} event={event} t={t} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-border bg-soft-1 px-3 py-6 text-center text-sm text-muted-foreground">
            {t("executive.noCriticalEvents")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationsPanel({
  recommendations,
  t,
}: {
  recommendations: NonNullable<ClientSatisfactionDetail["analysis"]>["recommendations"];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="border-cyan/30">
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="size-4 text-cyan" /> {t("executive.recommendationsTitle")}
        </p>
        {recommendations.length > 0 ? (
          <ul className="space-y-3">
            {[...recommendations]
              .sort((a, b) => REC_PRIORITY_RANK[a.priority] - REC_PRIORITY_RANK[b.priority])
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
        ) : (
          <p className="rounded-lg border border-border bg-soft-1 px-3 py-6 text-center text-sm text-muted-foreground">
            {t("executive.noRecommendations")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Rich analysis panels (indicators / big picture / signals / causes) ----

type Analysis = NonNullable<ClientSatisfactionDetail["analysis"]>;

const ACCOUNT_HEALTH_TONE: Record<string, string> = {
  healthy: "border-cc-green/30 bg-green-dim text-cc-green",
  watch: "border-amber/30 bg-amber/10 text-amber",
  at_risk: "border-cc-red/30 bg-red-dim text-cc-red",
  critical: "border-cc-red/50 bg-red-dim text-cc-red",
};

const CONTRACT_TARGET_TONE: Record<string, string> = {
  "On-Target": "border-cc-green/30 bg-green-dim text-cc-green",
  Renewed: "border-cyan/30 bg-cyan/10 text-cyan",
  Overdue: "border-amber/30 bg-amber/10 text-amber",
  Lost: "border-cc-red/30 bg-red-dim text-cc-red",
};

// The rolled-up verdict: account-health badge + the three composing dimensions.
function BigPicturePanel({
  bigPicture,
  contract,
  t,
}: {
  bigPicture: Analysis["bigPicture"];
  contract: Analysis["contractContext"];
  t: ReturnType<typeof useTranslations>;
}) {
  const dims = [
    { key: "relationship", score: bigPicture.relationshipScore },
    { key: "execution", score: bigPicture.executionScore },
    { key: "commercial", score: bigPicture.commercialScore },
  ] as const;
  return (
    <Card className="border-cyan/25">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-cyan" /> {t("bigPicture.title")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {contract && (
              <Explained text={t("metricTooltips.satisfaction_contractTarget")}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                    CONTRACT_TARGET_TONE[contract.target] ?? "border-border bg-soft-2 text-muted-foreground",
                  )}
                >
                  <FileSignature className="size-3" />
                  {t(`contractTarget.${contract.target}`)}
                </span>
              </Explained>
            )}
            <Explained text={t("metricTooltips.satisfaction_accountHealth")}>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  ACCOUNT_HEALTH_TONE[bigPicture.accountHealth] ?? ACCOUNT_HEALTH_TONE.watch,
                )}
              >
                {t(`accountHealth.${bigPicture.accountHealth}`)}
              </span>
            </Explained>
          </div>
        </div>
        {bigPicture.headline && (
          <p className="text-sm leading-relaxed text-muted-foreground">{bigPicture.headline}</p>
        )}
        <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
          {dims.map((d) => (
            <div key={d.key} className="flex flex-col items-center gap-1.5 text-center">
              <Ring score={d.score} size={64} />
              <p className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                {t(`bigPicture.${d.key}`)}
                <MetricInfo
                  text={t(`metricTooltips.satisfaction_dim_${d.key}`)}
                  label={t(`bigPicture.${d.key}`)}
                />
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// One tier's list of indicator chips (declared at module scope so it keeps its
// own identity across renders).
function IndicatorGroup({
  items,
  severity,
  t,
}: {
  items: Analysis["indicators"];
  severity: "red" | "yellow";
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <ul className="space-y-2">
      {items.map((ind, i) => (
        <li
          key={`${ind.code}-${i}`}
          className={cn(
            "rounded-lg border bg-soft-1 p-2.5",
            severity === "red" ? "border-cc-red/25" : "border-amber/25",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[12px] font-semibold",
                severity === "red" ? "text-cc-red" : "text-amber",
              )}
            >
              <span aria-hidden>{severity === "red" ? "🔴" : "🟡"}</span>
              {t(`indicator.${ind.code}`)}
            </span>
            {ind.date && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{ind.date}</span>
            )}
          </div>
          {ind.evidence && (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{ind.evidence}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// The detected indicators, split into 🔴 risk and 🟡 operational groups.
function IndicatorsPanel({
  indicators,
  t,
}: {
  indicators: Analysis["indicators"];
  t: ReturnType<typeof useTranslations>;
}) {
  const red = indicators.filter((i) => i.severity === "red");
  const yellow = indicators.filter((i) => i.severity === "yellow");
  return (
    <Card className="border-cc-red/20">
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4 text-cc-red" /> {t("indicators.title")}
          <MetricInfo
            text={t("metricTooltips.satisfaction_indicatorCounts")}
            label={t("indicators.title")}
          />
        </p>
        {indicators.length === 0 ? (
          <p className="rounded-lg border border-border bg-soft-1 px-3 py-6 text-center text-sm text-muted-foreground">
            {t("indicators.none")}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-cc-red">
                {t("indicators.risk")} {red.length > 0 && `(${red.length})`}
              </p>
              {red.length > 0 ? (
                <IndicatorGroup items={red} severity="red" t={t} />
              ) : (
                <p className="text-[12px] text-muted-foreground">{t("indicators.noneRisk")}</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber">
                {t("indicators.operational")} {yellow.length > 0 && `(${yellow.length})`}
              </p>
              {yellow.length > 0 ? (
                <IndicatorGroup items={yellow} severity="yellow" t={t} />
              ) : (
                <p className="text-[12px] text-muted-foreground">{t("indicators.noneOperational")}</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Client group 💫: requests breakdown, approvals breakdown, response speed.
function ClientSignalsPanel({
  signals,
  t,
}: {
  signals: Analysis["clientGroupSignals"];
  t: ReturnType<typeof useTranslations>;
}) {
  const reqKeys = ["new", "edit", "complaint", "inquiry", "approval"] as const;
  const apprKeys = ["approved", "rejected", "changesRequested", "noResponse"] as const;
  return (
    <Card className="border-cyan/20">
      <CardContent className="space-y-3 p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <MessagesSquare className="size-4 text-cyan" /> {t("signals.clientTitle")}
        </p>
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("signals.requests")}
            <MetricInfo
              text={t("metricTooltips.satisfaction_reqCounts")}
              label={t("signals.requests")}
            />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {reqKeys.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-soft-1 px-2 py-0.5 text-[11px]"
              >
                {t(`signals.req.${k}`)}
                <span className="font-semibold tabular-nums">{signals.requests[k]}</span>
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("signals.approvals")}
            <MetricInfo
              text={t("metricTooltips.satisfaction_apprCounts")}
              label={t("signals.approvals")}
            />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {apprKeys.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-soft-1 px-2 py-0.5 text-[11px]"
              >
                {t(`signals.appr.${k}`)}
                <span className="font-semibold tabular-nums">{signals.approvals[k]}</span>
              </span>
            ))}
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {t("signals.responseSpeed")}:{" "}
          <Explained text={t("metricTooltips.satisfaction_responseSpeed")}>
            <span className="font-semibold text-foreground">
              {t(`responseSpeed.${signals.responseSpeed}`)}
            </span>
          </Explained>
        </p>
      </CardContent>
    </Card>
  );
}

// Technical group 📍: internal blockers, delay-cause attribution, account eval.
function TechnicalSignalsPanel({
  signals,
  t,
}: {
  signals: Analysis["technicalGroupSignals"];
  t: ReturnType<typeof useTranslations>;
}) {
  const empty =
    signals.blockers.length === 0 &&
    signals.delayCauses.length === 0 &&
    signals.accountEvaluation.length === 0;
  return (
    <Card className="border-amber/20">
      <CardContent className="space-y-3 p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <Wrench className="size-4 text-amber" /> {t("signals.technicalTitle")}
        </p>
        {empty ? (
          <p className="rounded-lg border border-border bg-soft-1 px-3 py-4 text-center text-[12px] text-muted-foreground">
            {t("signals.technicalNone")}
          </p>
        ) : (
          <>
            {signals.blockers.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("signals.blockers")}
                </p>
                <ul className="space-y-1">
                  {signals.blockers.map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {signals.delayCauses.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("signals.delayCauses")}
                </p>
                <ul className="space-y-1">
                  {signals.delayCauses.map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-muted-foreground">{d.cause}</span>
                      <span className="shrink-0 rounded border border-border bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium">
                        {t(`owner.${d.attributedTo}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {signals.accountEvaluation.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("signals.accountEvaluation")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {signals.accountEvaluation.map((e, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-border bg-soft-1 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// أسباب المشاكل: problem → root cause → owner.
// Brief-adherence breakdown — explains WHY the score is what it is by listing
// each documented brief requirement and whether it was delivered. Renders only
// when the analysis carried a brief (briefAdherence non-null).
const BRIEF_STATUS_META = {
  delivered: { icon: CheckCircle2, cls: "text-cc-green", badge: "border-cc-green/25 bg-cc-green/[0.07] text-cc-green" },
  partial: { icon: MinusCircle, cls: "text-amber", badge: "border-amber/30 bg-amber/10 text-amber" },
  not_delivered: { icon: XCircle, cls: "text-cc-red", badge: "border-cc-red/25 bg-red-dim/40 text-cc-red" },
  no_evidence: { icon: HelpCircle, cls: "text-muted-foreground", badge: "border-border bg-soft-2 text-muted-foreground" },
} as const;

function BriefAdherencePanel({
  breakdown,
  score,
  t,
}: {
  breakdown: NonNullable<Analysis["briefAdherence"]>;
  score: number | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const items = breakdown.items ?? [];
  // Order: problems first (not_delivered, partial), then delivered, then no_evidence.
  const rank = { not_delivered: 0, partial: 1, delivered: 2, no_evidence: 3 } as const;
  const sorted = [...items].sort((a, b) => rank[a.status] - rank[b.status]);
  const counts = items.reduce(
    (m, it) => ((m[it.status] = (m[it.status] ?? 0) + 1), m),
    {} as Record<string, number>,
  );
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4 text-muted-foreground" /> {t("briefBreakdown.title")}
            {score !== null && (
              <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                {score}%
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["delivered", "partial", "not_delivered", "no_evidence"] as const).map((s) =>
              counts[s] ? (
                <span
                  key={s}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                    BRIEF_STATUS_META[s].badge,
                  )}
                >
                  {counts[s]} {t(`briefBreakdown.status.${s}`)}
                </span>
              ) : null,
            )}
          </div>
        </div>
        {breakdown.reason && (
          <p className="mb-3 rounded-lg border border-border bg-soft-1 p-3 text-[13px] leading-relaxed">
            {breakdown.reason}
          </p>
        )}
        {sorted.length > 0 ? (
          <ul className="space-y-2">
            {sorted.map((it, i) => {
              const meta = BRIEF_STATUS_META[it.status];
              const Icon = meta.icon;
              return (
                <li key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-soft-1 p-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", meta.cls)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium leading-snug">{it.requirement}</span>
                      <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", meta.badge)}>
                        {t(`briefBreakdown.status.${it.status}`)}
                      </span>
                    </div>
                    {it.note && (
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{it.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">{t("briefBreakdown.empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function CausesPanel({
  causes,
  t,
}: {
  causes: Analysis["causes"];
  t: ReturnType<typeof useTranslations>;
}) {
  if (causes.length === 0) return null;
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="size-4 text-muted-foreground" /> {t("causes.title")}
        </p>
        <ul className="space-y-2">
          {causes.map((c, i) => (
            <li key={i} className="rounded-lg border border-border bg-soft-1 p-3">
              <div className="mb-1 flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium leading-snug">{c.problem}</span>
                <span className="shrink-0 rounded border border-border bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium">
                  {t(`owner.${c.owner}`)}
                </span>
              </div>
              <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                <ArrowRightCircle className="mt-0.5 size-3.5 shrink-0" />
                {c.rootCause}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ClientTimelinePanel({
  events,
  range,
  filter,
  onRangeChange,
  onFilterChange,
  sentimentTimeline,
  t,
}: {
  events: ClientTimelineEvent[];
  range: TimelineRange;
  filter: EventFilter;
  onRangeChange: (range: TimelineRange) => void;
  onFilterChange: (filter: EventFilter) => void;
  sentimentTimeline: NonNullable<ClientSatisfactionDetail["analysis"]>["sentimentTimeline"];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-cyan" /> {t("executive.timelineTitle")}
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {(["7", "30", "90", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onRangeChange(value)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    range === value ? "bg-soft-2 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`executive.range.${value}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["all", "complaint", "approval", "delay", "internal", "decision"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === value
                  ? "border-cyan/35 bg-cyan/10 text-cyan"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`executive.filter.${value}`)}
            </button>
          ))}
        </div>

        {sentimentTimeline.length > 0 && (
          <div className="rounded-lg border border-border bg-soft-1 p-3">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="size-3.5 text-cyan" /> {t("timeline")}
              <MetricInfo
                text={t("metricTooltips.satisfaction_sentimentTimeline")}
                label={t("timeline")}
              />
            </p>
            <div className="flex items-end gap-2" style={{ height: 96 }}>
              {sentimentTimeline.map((pt, i) => {
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
                    <span className="text-[9px] text-muted-foreground">{pt.period.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {events.length > 0 ? (
          <ul className="space-y-2">
            {events.map((event) => (
              <EventRow key={event.id} event={event} t={t} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-border bg-soft-1 px-3 py-6 text-center text-sm text-muted-foreground">
            {t("executive.noTimelineEvents")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// A reachable link to the brief the analysis was scored against — Google Doc/
// Sheet open in a new tab, uploaded files download via a short-lived signed URL.
function BriefLink({
  brief,
}: {
  brief: NonNullable<ClientSatisfactionDetail["brief"]>;
}) {
  const Icon = brief.kind === "google_sheet" ? TableProperties : FileText;
  return (
    <a
      href={brief.href}
      target="_blank"
      rel="noopener noreferrer"
      title={brief.filename}
      className="mt-1 inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-cyan transition-colors hover:border-cyan/40"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{brief.filename}</span>
      <ExternalLink className="size-3 shrink-0 opacity-70" />
    </a>
  );
}

function MissingBriefPanel({
  clientId,
  activeProjects,
  t,
}: {
  clientId: string;
  activeProjects: ClientSatisfactionDetail["activeProjects"];
  t: ReturnType<typeof useTranslations>;
}) {
  const [url, setUrl] = useState("");
  const [projectId, setProjectId] = useState(activeProjects[0]?.id ?? "");
  const [busy, setBusy] = useState<"link" | "file" | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After a save/upload we DON'T auto re-analyze — show a prompt instead.
  const [saved, setSaved] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const noProject = activeProjects.length === 0;

  const saveLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy("link");
    try {
      const res = await attachClientBriefLinkAction({ clientId, projectId: projectId || undefined, url });
      if (res.error) setError(res.error);
      else {
        setUrl("");
        setSaved(t("briefLinkSaved"));
      }
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy("file");
    try {
      const fd = new FormData();
      fd.set("clientId", clientId);
      if (projectId) fd.set("projectId", projectId);
      fd.set("file", file);
      const res = await uploadClientBriefFileAction(fd);
      if (res.error) setError(res.error);
      else {
        if (fileRef.current) fileRef.current.value = "";
        setFileName(null);
        setSaved(t("briefFileSaved", { name: res.filename ?? file.name }));
      }
    } finally {
      setBusy(null);
    }
  };

  const reanalyze = async () => {
    setError(null);
    setReanalyzing(true);
    try {
      const res = await fetch("/api/satisfaction/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, windowKind: "week" }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? t("analyzeFailed"));
      else router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReanalyzing(false);
    }
  };

  return (
    <Card className="border-amber/30 bg-amber/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber">
              <FileQuestion className="size-4" /> {t("briefMissingTitle")}
            </p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {t("briefMissingDescription")}
            </p>
          </div>
          {activeProjects[0] && (
            <Link
              href={`/projects/${activeProjects[0].id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-cyan hover:border-cyan/40"
            >
              {t("openProject")}
              <ArrowRight className="size-3.5 ltr:rotate-0 rtl:rotate-180" />
            </Link>
          )}
        </div>

        {saved ? (
          // Success prompt — explicit "re-analyze now" vs "later" (no auto run).
          <div className="rounded-lg border border-cc-green/30 bg-green-dim/40 p-3">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-cc-green">
              <CheckCircle2 className="size-4" /> {saved}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("briefSavedPrompt")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" onClick={reanalyze} disabled={reanalyzing}>
                {reanalyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {t("reanalyzeNow")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSaved(null);
                  router.refresh();
                }}
                disabled={reanalyzing}
              >
                {t("later")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Project picker (shared by both inputs) */}
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={activeProjects.length <= 1}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none transition-colors focus:border-cyan/50 md:max-w-xs"
            >
              {noProject ? (
                <option value="">{t("noActiveProject")}</option>
              ) : (
                activeProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))
              )}
            </select>

            {/* Option A — paste a Google Doc / Sheet link */}
            <form onSubmit={saveLink} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                dir="ltr"
                placeholder={t("briefLinkPlaceholder")}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-cyan/50"
              />
              <Button type="submit" disabled={busy !== null || noProject || !url.trim()}>
                {busy === "link" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t("saveBriefLink")}
              </Button>
            </form>

            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground/60">
              <span className="h-px flex-1 bg-border" />
              {t("or")}
              <span className="h-px flex-1 bg-border" />
            </div>

            {/* Option B — upload a local file (txt / csv / xlsx) */}
            <form onSubmit={uploadFile} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.csv,.tsv,.xlsx,.xls,text/plain,text/csv"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                className="h-9 rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground outline-none transition-colors file:me-2 file:rounded file:border-0 file:bg-soft-2 file:px-2 file:py-1 file:text-xs file:text-foreground focus:border-cyan/50"
              />
              <Button type="submit" variant="outline" disabled={busy !== null || noProject || !fileName}>
                {busy === "file" ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                {t("uploadBriefFile")}
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground/70">{t("briefFileHint")}</p>
          </>
        )}

        {error && <p className="text-xs text-cc-red">{error}</p>}
      </CardContent>
    </Card>
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
          <MetricInfo
            text={t("metricTooltips.satisfaction_historyScore")}
            label={t("history.title")}
          />
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
