"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo, useRef, useEffect, useTransition } from "react";
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
  Trash2,
  Pencil,
  Users,
  ChevronDown,
  Scale,
  RefreshCw,
} from "lucide-react";
import {
  attachClientBriefLinkAction,
  uploadClientBriefFileAction,
  deleteClientBriefAction,
  setClientArchivedAction,
  setRecommendationStatusAction,
} from "./_actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ClientFinanceBadges } from "@/components/client-finance-badges";
import { MetricInfo, Explained } from "@/components/metric-info";
import type {
  ClientFinanceBadge,
  ClientFinanceMap,
} from "@/lib/data/client-finance";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  AccountabilityLiveState,
  AnalysisHistoryItem,
  ClientExecutionSnapshot,
  ClientMediaExchange,
  ClientSatisfactionDetail,
  SatisfactionRow,
} from "@/lib/data/satisfaction";
import type { RefreshSummary } from "@/lib/satisfaction-refresh";
import type {
  RecommendationLiveStatus,
  RecommendationResolutionReason,
} from "@/lib/satisfaction-recommendation-status";

interface Props {
  canManageClients: boolean;
  options: { value: string; label: string; keywords?: string | null }[];
  rows: SatisfactionRow[];
  detail: ClientSatisfactionDetail | null;
  execution: ClientExecutionSnapshot | null;
  selectedId: string | null;
  selectedAnalysisId: string | null;
  financeMap: ClientFinanceMap;
  // When true (linked from the dashboard at-risk stat), the overview opens
  // pre-filtered to at-risk clients only.
  initialRisk?: boolean;
}

function scoreTone(score: number | null) {
  if (score === null)
    return { text: "text-muted-foreground", ring: "text-muted-foreground/40" };
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
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className={cn("-rotate-90", tone.ring)}
        width={size}
        height={size}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="6"
          className="stroke-border"
        />
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
  canManageClients,
  options,
  rows,
  detail,
  execution,
  selectedId,
  selectedAnalysisId,
  financeMap,
  initialRisk = false,
}: Props) {
  const t = useTranslations("SatisfactionPage");
  const tStages = useTranslations("TaskLabels.stage");
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState<"week" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<RefreshSummary | null>(
    null,
  );

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
  const analyzeClient = async (
    clientId: string,
    windowKind: "week" | "all" = "week",
  ): Promise<string | null> => {
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
    let data: { error?: string; analysisId?: string } = {};
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
    return data.analysisId ?? null;
  };

  const analyze = async (windowKind: "week" | "all") => {
    if (!selectedId) return;
    setError(null);
    setAnalyzing(windowKind);
    try {
      const newId = await analyzeClient(selectedId, windowKind);
      // Show the freshly stored result. A weekly run is is_current, so the
      // default view picks it up on refresh. An all-time run is NOT current —
      // navigate straight to its snapshot id so the operator actually sees it
      // (otherwise the board keeps showing the older current-week analysis).
      if (windowKind === "all" && newId) {
        router.push(`/satisfaction?client=${selectedId}&analysis=${newId}`);
      } else if (selectedAnalysisId) {
        router.push(`/satisfaction?client=${selectedId}`);
      } else {
        router.refresh();
      }
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

  // "تحديث" — status refresh, not a re-analysis: the server sends the still-open
  // findings of the SHOWN analysis + the messages that arrived since it ran +
  // the live task table to the model, which closes whatever now has resolution
  // evidence. Closures land in the same overlay the manual confirm button
  // writes, so the page reflects them after router.refresh().
  const refreshStatuses = async () => {
    if (!selectedId || !detail?.analysis) return;
    setError(null);
    setRefreshSummary(null);
    setRefreshing(true);
    try {
      const res = await fetch("/api/satisfaction/refresh-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedId,
          analysisId: detail.analysis.id,
        }),
      });
      const raw = await res.text();
      let data: { error?: string; summary?: RefreshSummary } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        /* non-JSON body (timeout / gateway error) */
      }
      if (!res.ok)
        throw new Error(data.error ?? `تعذر التحديث (${res.status})`);
      setRefreshSummary(data.summary ?? null);
      if (data.summary?.resolved.length) router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const sentimentLabel = (s: string | null) => (s ? t(`sentiment.${s}`) : "—");

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
        <SatisfactionOverview
          rows={rows}
          options={options}
          financeMap={financeMap}
          onSelect={select}
          onAnalyze={async (id) => {
            await analyzeClient(id);
            router.refresh();
          }}
          canManageClients={canManageClients}
          initialRisk={initialRisk}
          t={t}
        />
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

          {detail.analysis && detail.hasNewMessagesSinceAnalysis === false && (
            <div className="flex items-start gap-2 rounded-xl border border-amber/35 bg-amber/10 px-4 py-3 text-sm text-amber">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">
                  {t("freshness.noNewBeforeTitle")}
                </p>
                <p className="mt-0.5 text-xs leading-6 text-foreground/70">
                  {t("freshness.noNewBeforeBody", {
                    date: detail.latestMessageAt
                      ? detail.latestMessageAt.slice(0, 16).replace("T", " ")
                      : t("freshness.unknownDate"),
                  })}
                </p>
              </div>
            </div>
          )}

          {/* Analyze — two windows. Current week feeds the board; all time is
              an on-demand full-history snapshot. */}
          <div className="flex flex-wrap items-center gap-3">
            {(() => {
              const hasTranscript =
                !!detail.imports.client ||
                !!detail.imports.technical ||
                detail.hasMessages;
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
                  {detail.analysis && (
                    <Button
                      variant="outline"
                      onClick={refreshStatuses}
                      disabled={busy || refreshing}
                      title={t("refresh.hint")}
                    >
                      {refreshing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      {t("refresh.button")}
                    </Button>
                  )}
                  {!hasTranscript && (
                    <span className="text-xs text-muted-foreground">
                      {t("uploadFirst")}
                    </span>
                  )}
                </>
              );
            })()}
            {detail.analysis && (
              <div className="text-xs leading-5 text-muted-foreground">
                <span>
                  {t("freshness.analysisRunAt")}:{" "}
                  {detail.analysis.createdAt.slice(0, 16).replace("T", " ")}
                </span>
                <span className="mx-1.5">·</span>
                <span>
                  {t("freshness.lastMessageAt")}:{" "}
                  {detail.latestMessageAt
                    ? detail.latestMessageAt.slice(0, 16).replace("T", " ")
                    : t("freshness.unknownDate")}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleArchive}
              disabled={archiving}
              className="ms-auto text-muted-foreground hover:text-foreground"
              title={
                selRow?.manuallyArchived ? t("restoreHint") : t("archiveHint")
              }
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

          {/* Status-refresh outcome — what the model closed and on what evidence */}
          {refreshSummary && (
            <div
              className={cn(
                "rounded-xl border px-4 py-3 text-sm",
                refreshSummary.resolved.length > 0
                  ? "border-cc-green/35 bg-green-dim/40"
                  : "border-border bg-soft-1",
              )}
            >
              <p className="flex items-center gap-2 text-xs font-semibold">
                <RefreshCw className="size-3.5 text-cyan" />
                {refreshSummary.checked === 0
                  ? t("refresh.nothingToCheck")
                  : refreshSummary.resolved.length > 0
                    ? t("refresh.resolvedCount", {
                        n: refreshSummary.resolved.length,
                      })
                    : t("refresh.noneResolved", { n: refreshSummary.checked })}
                {!refreshSummary.hadNewMessages &&
                  refreshSummary.checked > 0 && (
                    <span className="font-normal text-muted-foreground">
                      · {t("refresh.noNewMessages")}
                    </span>
                  )}
              </p>
              {refreshSummary.resolved.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {refreshSummary.resolved.map((entry, i) => (
                    <li key={i} className="text-[12px] leading-5">
                      <span className="font-medium text-cc-green">
                        ✓ {entry.issue}
                      </span>
                      {entry.evidence && (
                        <span className="block text-[11px] text-muted-foreground">
                          {entry.evidence}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
              recommendationStatuses={detail.recommendationStatuses}
              manualResolvedIssues={detail.manualResolvedIssues}
              accountabilityStates={detail.accountabilityStates}
              canManageClients={canManageClients}
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
          {execution && (
            <ExecutionPanel snapshot={execution} t={t} tStages={tStages} />
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
  {
    key: "healthy",
    accent: "text-cc-green",
    bar: "bg-cc-green",
    dot: "bg-cc-green",
  },
  {
    key: "pending",
    accent: "text-muted-foreground",
    bar: "bg-border",
    dot: "bg-muted-foreground/40",
  },
];

function bucketOf(r: SatisfactionRow): BucketKey {
  if (!r.analyzedAt || r.satisfactionScore === null) return "pending";
  if (r.sentiment === "negative" || r.satisfactionScore < 55) return "atRisk";
  if (r.satisfactionScore < 70) return "watch";
  return "healthy";
}

function SatisfactionOverview({
  rows,
  options,
  financeMap,
  onSelect,
  onAnalyze,
  canManageClients,
  initialRisk = false,
  t,
}: {
  rows: SatisfactionRow[];
  options: Props["options"];
  financeMap: ClientFinanceMap;
  onSelect: (id: string) => void;
  onAnalyze: (id: string) => Promise<void>;
  canManageClients: boolean;
  initialRisk?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "table">("board");
  const [query, setQuery] = useState("");
  // Bulk "تحديث الكل": run the status-refresh pass for every analyzed client in
  // the current scope, a few at a time. Each client is one bounded model call
  // through the same /refresh-status route, so failures are per-client and the
  // rest of the sweep continues.
  const [bulk, setBulk] = useState<{
    running: boolean;
    done: number;
    total: number;
    closed: number;
    failed: number;
  } | null>(null);
  // Active clients (≥1 non-archived project) vs lost/archived relationships.
  // Always defaults to "active" — including the dashboard deep-link. The
  // "عملاء معرضون للفقد" pill counts ACTIVE at-risk clients only (an already-lost
  // client can't be "at risk of loss"), so the drill-down must open the active
  // scope to show the SAME number; opening "all" here showed 61 vs the pill's 22.
  const [relation, setRelation] = useState<"active" | "lost" | "all">("active");
  // At-risk-only filter — toggled on when deep-linked from the dashboard
  // "عملاء معرضون للفقد" stat. Matches isClientAtRisk: negative sentiment OR score < 55.
  const [riskOnly, setRiskOnly] = useState(initialRisk);
  // The picker already carries the searchable aliases. Reuse that one
  // representation for the board instead of serializing every keyword twice.
  const searchKeywords = useMemo(
    () =>
      new Map(
        options.map((option) => [
          option.value,
          option.keywords?.toLowerCase() ?? "",
        ]),
      ),
    [options],
  );

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.hasActiveProject).length,
      lost: rows.filter((r) => !r.hasActiveProject).length,
      all: rows.length,
      // At-risk count within the CURRENT relation scope, so the badge always
      // matches what the risk filter actually shows. In the default "active"
      // scope this equals the dashboard "عملاء معرضون للفقد" pill (22) — both use
      // active + isClientAtRisk. A lost client can't be "at risk of loss".
      risk: rows.filter(
        (r) =>
          bucketOf(r) === "atRisk" &&
          (relation === "all" ||
            r.hasActiveProject === (relation === "active")),
      ).length,
    }),
    [rows, relation],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (riskOnly && bucketOf(r) !== "atRisk") return false;
      if (relation === "active" && !r.hasActiveProject) return false;
      if (relation === "lost" && r.hasActiveProject) return false;
      if (q) {
        // Match the client name OR any linked identifier (project / group /
        // contract names + codes), mirroring the top picker.
        const kw = searchKeywords.get(r.clientId) ?? "";
        if (!r.clientName.toLowerCase().includes(q) && !kw.includes(q))
          return false;
      }
      return true;
    });
  }, [rows, query, relation, riskOnly, searchKeywords]);

  // Only clients that HAVE an analysis can be refreshed (the pass reconciles an
  // existing snapshot; it never creates one). Scoped to the visible filter so
  // "update all" means "update everything I'm looking at".
  const refreshableIds = useMemo(
    () => filtered.filter((r) => r.analyzedAt).map((r) => r.clientId),
    [filtered],
  );

  const refreshAll = async () => {
    if (bulk?.running || refreshableIds.length === 0) return;
    const ids = [...refreshableIds];
    const total = ids.length;
    setBulk({ running: true, done: 0, total, closed: 0, failed: 0 });
    // 3 concurrent workers — enough to finish a 50-client board in a few
    // minutes without hammering the AI gateway.
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const clientId = ids[cursor++];
        try {
          const res = await fetch("/api/satisfaction/refresh-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            summary?: { resolved?: unknown[] };
          };
          if (!res.ok) throw new Error("failed");
          const closedHere = data.summary?.resolved?.length ?? 0;
          setBulk((b) =>
            b ? { ...b, done: b.done + 1, closed: b.closed + closedHere } : b,
          );
        } catch {
          setBulk((b) =>
            b ? { ...b, done: b.done + 1, failed: b.failed + 1 } : b,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
    setBulk((b) => (b ? { ...b, running: false } : b));
    router.refresh();
  };

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
          <button
            type="button"
            onClick={() => setRiskOnly((v) => !v)}
            aria-pressed={riskOnly}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              riskOnly
                ? "border-cc-red/40 bg-cc-red/10 text-cc-red"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldAlert className="size-3.5" />
            {t("riskFilter")}
            <span className="rounded-full bg-soft-1 px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {counts.risk}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {canManageClients && (
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={bulk?.running || refreshableIds.length === 0}
              title={t("refresh.bulkHint")}
              className="h-9"
            >
              {bulk?.running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {bulk?.running
                ? t("refresh.bulkProgress", {
                    done: bulk.done,
                    total: bulk.total,
                  })
                : t("refresh.bulkButton", { n: refreshableIds.length })}
            </Button>
          )}
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
                view === "board"
                  ? "bg-soft-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
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
                view === "table"
                  ? "bg-soft-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <TableProperties className="size-3.5" />
              {t("viewTable")}
            </button>
          </div>
        </div>
      </div>

      {/* Bulk-refresh outcome — kept visible after the sweep so the operator
          sees how many findings were closed across the whole board. */}
      {bulk && !bulk.running && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs",
            bulk.closed > 0
              ? "border-cc-green/35 bg-green-dim/40"
              : "border-border bg-soft-1",
          )}
        >
          <RefreshCw className="size-3.5 shrink-0 text-cyan" />
          <span className="font-semibold">
            {t("refresh.bulkDone", {
              closed: bulk.closed,
              clients: bulk.done - bulk.failed,
            })}
          </span>
          {bulk.failed > 0 && (
            <span className="text-muted-foreground">
              · {t("refresh.bulkFailed", { n: bulk.failed })}
            </span>
          )}
        </div>
      )}

      {view === "board" ? (
        <SatisfactionBoard
          rows={filtered}
          financeMap={financeMap}
          onSelect={onSelect}
          onAnalyze={onAnalyze}
          t={t}
        />
      ) : (
        <OverviewTable
          rows={filtered}
          financeMap={financeMap}
          onSelect={onSelect}
          t={t}
        />
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
                <span className="text-sm font-semibold">
                  {t(`board.${b.key}`)}
                </span>
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
        <p
          className={cn(
            "text-[11px] font-medium",
            err ? "text-cc-red" : accent,
          )}
        >
          {row.sentiment
            ? t(`sentiment.${row.sentiment}`)
            : t("board.noGroups")}
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
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
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
                <th className="p-3 text-start font-medium">
                  {t("col.client")}
                </th>
                <th className="p-3 text-center font-medium">
                  {t("col.groups")}
                </th>
                <th className="p-3 text-center font-medium">
                  <span className="inline-flex items-center justify-center gap-1">
                    {t("col.satisfaction")}
                    <MetricInfo
                      text={t("help.satisfaction")}
                      label={t("col.satisfaction")}
                    />
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
                    <MetricInfo
                      text={t("help.sentiment")}
                      label={t("col.sentiment")}
                    />
                  </span>
                </th>
                <th className="p-3 text-center font-medium">
                  {t("col.analyzed")}
                </th>
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
                      <ClientFinanceBadges
                        badge={financeMap[r.clientId]}
                        className="ms-1.5"
                      />
                    </td>
                    <td className="p-3 text-center">
                      <span className="inline-flex gap-1">
                        <Dot on={r.hasClient} label={t("clientGroup")} />
                        <Dot on={r.hasTechnical} label={t("technicalGroup")} />
                      </span>
                    </td>
                    <td
                      className={cn(
                        "p-3 text-center font-semibold tabular-nums",
                        tone.text,
                      )}
                    >
                      {r.satisfactionScore ?? "—"}
                    </td>
                    <td className="p-3 text-center text-xs tabular-nums text-muted-foreground">
                      {r.analyzedAt && r.briefAdherenceScore === null ? (
                        <span className="rounded bg-amber/10 px-1.5 py-0.5 font-medium text-amber">
                          {t("briefMissingShort")}
                        </span>
                      ) : (
                        (r.briefAdherenceScore ?? "—")
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
            <AlertTriangle className="size-4 text-amber" />{" "}
            {t("execution.title")}
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
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("execution.hint")}
        </p>

        {/* by-stage distribution — shows whether delays cluster in one phase */}
        {snapshot.byStage.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {snapshot.byStage.map((s) => (
              <span
                key={s.stage}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-soft-1 px-2 py-1 text-[11px]"
              >
                <span className="text-muted-foreground">
                  {stageLabel(s.stage)}
                </span>
                <Explained
                  text={t("metricTooltips.satisfaction_execStageCount")}
                >
                  <span className="rounded-full bg-soft-2 px-1.5 font-medium tabular-nums">
                    {s.count}
                  </span>
                </Explained>
              </span>
            ))}
          </div>
        )}

        {/* worst-stuck tasks */}
        <ul className="mt-3 space-y-1.5">
          {snapshot.topTasks.map((task, i) => (
            <li key={task.id ?? i}>
              <Link
                href={`/tasks/${task.id}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-soft-1/60 px-2.5 py-1.5 text-[13px] transition-colors hover:bg-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/40"
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
                    <Explained
                      text={t("metricTooltips.satisfaction_execDaysStuck")}
                    >
                      <span className="tabular-nums text-amber">
                        {t("execution.daysStuck", { n: task.daysStuck })}
                      </span>
                    </Explained>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---- Analysis view -------------------------------------------------------
const REC_PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const REC_PRIORITY_TONE: Record<string, string> = {
  high: "bg-red-dim text-cc-red",
  medium: "bg-soft-2 text-amber",
  low: "bg-soft-2 text-muted-foreground",
};

type ExecutiveTab = "critical" | "timeline";
type TimelineRange = "7" | "30" | "90" | "all";
type EventFilter =
  "all" | "complaint" | "approval" | "delay" | "internal" | "decision";
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

function highlightCategory(
  type: string,
  text: string,
  audience: string,
): ClientTimelineEvent["category"] {
  const body = text.toLowerCase();
  if (audience === "team") return "internal";
  if (type === "complaint" || type === "escalation") return "complaint";
  if (
    type === "milestone" ||
    /اعتماد|اعتمد|وافق|موافقة|approved|approval/.test(body)
  )
    return "approval";
  if (/تأخير|متأخر|اتأخر|تأخر|delay|late|deadline|موعد/.test(body))
    return "delay";
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
      severity:
        h.type === "escalation" ? "critical" : critical ? "high" : "medium",
    });
  });

  if (execution && execution.overdueCount > 0) {
    const newestTaskDate =
      execution.topTasks
        .map(taskEventDate)
        .sort((a, b) => parseTime(b) - parseTime(a))[0] ?? null;
    events.push({
      id: "system-overdue-summary",
      title: `يوجد ${execution.overdueCount} مهام متأخرة في المشروع`,
      date: newestTaskDate ?? analysis.createdAt,
      source: "system",
      category: "delay",
      critical: true,
      severity:
        execution.overdueCount >= 8
          ? "critical"
          : execution.overdueCount >= 4
            ? "high"
            : "medium",
    });

    execution.topTasks.slice(0, 6).forEach((task, index) => {
      events.push({
        id: `task-delay-${index}`,
        title: `${task.taskCode ? `${task.taskCode} · ` : ""}${task.title}`,
        date: taskEventDate(task),
        source: "system",
        category: "delay",
        critical: (task.delayDays ?? 0) >= 3 || (task.daysStuck ?? 0) >= 7,
        severity:
          (task.delayDays ?? 0) >= 5 || (task.daysStuck ?? 0) >= 14
            ? "high"
            : "medium",
      });
    });
  }

  // Contract activity-log events — holds/edits/close/renew as dated timeline
  // entries. Lost/Hold are critical; Renew reads as a positive (approval) beat.
  (analysis.contractContext?.recentActivity ?? [])
    .slice(0, 6)
    .forEach((ev, index) => {
      const isLost = /Lost/i.test(ev.logType);
      const isRenew = /Renew/i.test(ev.logType);
      const isHold = /HOLD/i.test(ev.logType) && !/LIFTED/i.test(ev.logType);
      const critical = isLost || isHold;
      const note = ev.notes
        ? ev.notes.replace(/\s+/g, " ").trim().slice(0, 120)
        : "";
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
  recommendationStatuses: RecommendationLiveStatus[],
  manualResolvedIssues: string[],
) {
  const statusByIndex = new Map(
    recommendationStatuses.map((status) => [
      status.recommendationIndex,
      status,
    ]),
  );
  const resolvedIssues = new Set(manualResolvedIssues);
  const checkedAt = recommendationStatuses[0]?.checkedAt ?? analysis.createdAt;
  const recs = analysis.recommendations.map(
    (recommendation, recommendationIndex) => ({
      ...recommendation,
      liveStatus:
        statusByIndex.get(recommendationIndex) ??
        ({
          recommendationIndex,
          state: "needs_confirmation",
          reason: "unverifiable",
          checkedAt,
          openTaskCount: null,
          liveOverdueCount: null,
          matchedTasks: [],
        } satisfies RecommendationLiveStatus),
    }),
  );
  if (execution && execution.overdueCount > 0 && recs.length < 6) {
    const stage = execution.byStage[0]?.stage;
    recs.push({
      priority:
        execution.overdueCount >= 4 ? ("high" as const) : ("medium" as const),
      issue: `يوجد ${execution.overdueCount} مهام متأخرة${stage ? `، أكثرها في مرحلة ${stage}` : ""}.`,
      action:
        "تحديد مالك لكل مهمة متأخرة وإرسال موعد تسليم واضح للعميل خلال 48 ساعة.",
      liveStatus: {
        recommendationIndex: recs.length,
        state: "open" as const,
        reason: "overdue_tasks_open" as const,
        checkedAt,
        openTaskCount: execution.overdueCount,
        liveOverdueCount: execution.overdueCount,
        matchedTasks: [],
      },
    });
  }
  if (analysis.risks.length > 0 && recs.length < 6) {
    const riskIssue = analysis.risks[0];
    const riskResolved = resolvedIssues.has(riskIssue);
    recs.push({
      priority: "medium" as const,
      issue: riskIssue,
      action:
        "تحويل الخطر إلى قرار متابعة: من المسؤول، ما الإجراء، وما موعد الإغلاق.",
      liveStatus: {
        recommendationIndex: recs.length,
        state: riskResolved
          ? ("resolved" as const)
          : ("needs_confirmation" as const),
        reason: riskResolved
          ? ("manual_confirmed" as const)
          : ("unverifiable" as const),
        checkedAt,
        openTaskCount: null,
        liveOverdueCount: null,
        matchedTasks: [],
      },
    });
  }
  return recs.slice(0, 6);
}

function AnalysisView({
  analysis,
  recommendationStatuses,
  manualResolvedIssues,
  accountabilityStates,
  canManageClients,
  history,
  execution,
  clientId,
  activeProjects,
  brief,
  t,
  sentimentLabel,
}: {
  analysis: NonNullable<ClientSatisfactionDetail["analysis"]>;
  recommendationStatuses: RecommendationLiveStatus[];
  manualResolvedIssues: string[];
  accountabilityStates: AccountabilityLiveState[];
  canManageClients: boolean;
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
    () =>
      buildFallbackRecommendations(
        analysis,
        execution,
        recommendationStatuses,
        manualResolvedIssues,
      ),
    [analysis, execution, recommendationStatuses, manualResolvedIssues],
  );
  // Deep-link scroll: cross-page links (e.g. the accountability cases feed) land
  // on `/satisfaction?client=X#accountability`. The target section only exists
  // once this analysis renders — after data fetch + hydration — so the browser's
  // native hash scroll fires too early and no-ops. Re-run the scroll once the
  // analysis is present so we land on the section the click referred to.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [analysis.id]);
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
      {analysis.hadNewMessages === false && (
        <div className="flex items-start gap-2 rounded-lg border border-amber/35 bg-amber/10 px-3 py-2 text-[13px] text-amber">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">
              {t("freshness.reanalyzedWithoutNew")}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-foreground/70">
              {t("freshness.resultBody", {
                date: analysis.sourceLatestMessageAt
                  ? analysis.sourceLatestMessageAt
                      .slice(0, 16)
                      .replace("T", " ")
                  : t("freshness.unknownDate"),
              })}
            </p>
          </div>
        </div>
      )}
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
            {t("history.backToCurrent")}{" "}
            <ArrowRight className="size-3.5 ltr:rotate-0 rtl:rotate-180" />
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
                  analysis.satisfactionScore < 55 ||
                    analysis.sentiment === "negative"
                    ? "border-cc-red/30 bg-red-dim text-cc-red"
                    : analysis.satisfactionScore < 70 ||
                        (execution?.overdueCount ?? 0) > 0
                      ? "border-amber/30 bg-amber/10 text-amber"
                      : "border-cc-green/30 bg-green-dim text-cc-green",
                )}
              >
                {analysis.satisfactionScore < 55 ||
                analysis.sentiment === "negative"
                  ? t("executive.riskHigh")
                  : analysis.satisfactionScore < 70 ||
                      (execution?.overdueCount ?? 0) > 0
                    ? t("executive.riskMedium")
                    : t("executive.riskLow")}
              </span>
            </Explained>
          </div>
          <div className="flex flex-wrap items-stretch gap-x-6 gap-y-4 border-t border-border pt-4">
            {/* درجة الرضا — score + the one-line "why this score" directly beneath it */}
            <div className="min-w-[16rem] flex-1 space-y-2.5">
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
                    {range(analysis) && (
                      <span className="tabular-nums">· {range(analysis)}</span>
                    )}
                  </p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {analysis.risks[0] ?? t("executive.noMajorRisk")}
              </p>
            </div>
            {/* الالتزام بالبريف — score + its own one-line reason directly beneath it */}
            <div className="min-w-[16rem] flex-1 space-y-2.5 sm:border-s sm:border-border sm:ps-6">
              <div className="flex items-center gap-3">
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
                  {brief ? (
                    <BriefManager
                      brief={brief}
                      clientId={clientId}
                      activeProjects={activeProjects}
                      t={t}
                    />
                  ) : briefMissing ? (
                    <p className="mt-1 text-[11px] font-medium text-amber">
                      {t("briefMissingShort")}
                    </p>
                  ) : null}
                </div>
              </div>
              {!briefMissing && analysis.briefAdherence?.reason && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {analysis.briefAdherence.reason}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {briefMissing && !brief && (
        <MissingBriefPanel
          clientId={clientId}
          activeProjects={activeProjects}
          t={t}
        />
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
      <BigPicturePanel
        bigPicture={analysis.bigPicture}
        contract={analysis.contractContext}
        t={t}
      />

      {/* المؤشرات — the risk/operational taxonomy */}
      <IndicatorsPanel indicators={analysis.indicators} t={t} />

      {/* per-source signal extraction */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ClientSignalsPanel signals={analysis.clientGroupSignals} t={t} />
        <TechnicalSignalsPanel signals={analysis.technicalGroupSignals} t={t} />
      </div>

      {/* المسؤولية — complaint → finding → responsible people + tasks */}
      <AccountabilityPanel
        accountability={analysis.accountability}
        teamContext={analysis.teamContext}
        liveStates={accountabilityStates}
        t={t}
      />

      {/* الفريق على هذا الحساب — factual roster + code-detected gaps */}
      <TeamRosterPanel teamContext={analysis.teamContext} t={t} />

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
          <RecommendationsPanel
            recommendations={recommendations}
            analysisCreatedAt={analysis.createdAt}
            analysisId={analysis.id}
            clientId={clientId}
            canManageClients={canManageClients}
            t={t}
          />
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

      {/* الوسائط والملفات المتبادلة — evidence of what was shared in the chats */}
      <MediaExchangePanel clientId={clientId} t={t} />

      <HistoryList
        history={history}
        clientId={clientId}
        shownId={analysis.id}
        t={t}
      />
    </div>
  );
}

// ---- Media & files exchanged --------------------------------------------
// Evidence surfaced from the chats. We never stored the media BINARY (no
// pixels/bytes), so the panel stays intentionally aggregate-only.
function MediaExchangePanel({
  clientId,
  t,
}: {
  clientId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [media, setMedia] = useState<ClientMediaExchange | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadMedia = async () => {
    if (loading || media) return;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/satisfaction/media?client=${encodeURIComponent(clientId)}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("media request failed");
      const body = (await response.json()) as {
        media?: ClientMediaExchange | null;
      };
      setMedia(body.media ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (!media) {
    return (
      <Card className="border-border">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <FileUp className="size-4 text-muted-foreground" />{" "}
              {t("media.title")}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("media.hintStored")}
            </p>
            {error && (
              <p className="mt-2 text-xs text-cc-red">{t("media.loadError")}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadMedia}
            disabled={loading}
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {loading ? t("media.loading") : t("media.load")}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (media.totalSharedItems === 0) {
    return (
      <Card className="border-border">
        <CardContent className="p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <FileUp className="size-4 text-muted-foreground" />{" "}
            {t("media.title")}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {t("media.empty")}
          </p>
        </CardContent>
      </Card>
    );
  }
  const categories = [
    {
      icon: FileText,
      label: t("media.documents"),
      n: media.documentCount ?? media.documents.length,
    },
    {
      icon: FileQuestion,
      label: t("media.images"),
      n: media.imageCount ?? media.images.length + media.silentImages,
    },
    {
      icon: TrendingUp,
      label: t("media.videos"),
      n: media.videoCount ?? media.videos.length,
    },
    { icon: MessagesSquare, label: t("media.voiceNotes"), n: media.voiceNotes },
    { icon: Link2, label: t("media.links"), n: media.linkCount },
    {
      icon: Link2,
      label: t("media.others"),
      n: media.otherCount ?? media.others.length,
    },
  ].filter((category) => category.n > 0);

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <FileUp className="size-4 text-muted-foreground" />{" "}
            {t("media.title")}
          </p>
          <span className="text-[11px] text-muted-foreground">
            {media.isPartial
              ? t("media.countAtLeast", { n: media.totalSharedItems })
              : t("media.count", { n: media.totalSharedItems })}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("media.hintStored")}
        </p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {categories.map((category) => (
            <li
              key={category.label}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-soft-1 px-2.5 py-1.5 text-[12px]"
            >
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <category.icon className="size-3.5" />
                {category.label}
              </span>
              <span className="rounded-full bg-soft-2 px-2 font-semibold tabular-nums text-foreground">
                {category.n}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---- Past-analyses history ----------------------------------------------
// Team asked to keep this: it's the audit trail of every scored snapshot.
// Default to the 4 most recent (history is newest-first) with a "show more"
// toggle so a client with a long analysis history doesn't flood the panel.
const HISTORY_DEFAULT = 4;
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
  const [expanded, setExpanded] = useState(false);
  if (history.length <= 1) return null;
  const shown = expanded ? history : history.slice(0, HISTORY_DEFAULT);
  const hidden = history.length - shown.length;
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
          {shown.map((h) => {
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
                    <span
                      className={cn(
                        "text-base font-bold tabular-nums",
                        tone.text,
                      )}
                    >
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
        {history.length > HISTORY_DEFAULT && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2.5 w-full rounded-lg border border-border bg-card py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-cyan/30 hover:text-foreground"
          >
            {expanded
              ? t("history.showLess")
              : t("history.showMore", { count: hidden })}
          </button>
        )}
      </CardContent>
    </Card>
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
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone,
      )}
    >
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
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-semibold",
        tone[category],
      )}
    >
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
            <AlertTriangle className="size-4 text-amber" />{" "}
            {t("executive.criticalTitle")}
          </p>
          <span className="text-[11px] text-muted-foreground">
            {t("executive.latestFirst")}
          </span>
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
  analysisCreatedAt,
  analysisId,
  clientId,
  canManageClients,
  t,
}: {
  recommendations: Array<
    NonNullable<
      ClientSatisfactionDetail["analysis"]
    >["recommendations"][number] & {
      liveStatus: RecommendationLiveStatus;
    }
  >;
  analysisCreatedAt: string;
  analysisId: string;
  clientId: string;
  canManageClients: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const sorted = [...recommendations].sort(
    (a, b) => REC_PRIORITY_RANK[a.priority] - REC_PRIORITY_RANK[b.priority],
  );
  const active = sorted.filter(
    (recommendation) => recommendation.liveStatus.state !== "resolved",
  );
  const resolved = sorted.filter(
    (recommendation) => recommendation.liveStatus.state === "resolved",
  );
  const checkedAt =
    recommendations[0]?.liveStatus.checkedAt ?? analysisCreatedAt;

  return (
    <Card className="border-cyan/30">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="size-4 text-cyan" />{" "}
              {t("executive.recommendationsTitle")}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {t("executive.recommendationStatus.liveHint")}
            </p>
          </div>
          <div className="text-end text-[10px] leading-5 text-muted-foreground">
            <p>
              {t("executive.recommendationStatus.snapshotAt", {
                date: analysisCreatedAt.slice(0, 10),
              })}
            </p>
            <p>
              {t("executive.recommendationStatus.checkedAt", {
                date: checkedAt.slice(0, 10),
              })}
            </p>
          </div>
        </div>
        {recommendations.length > 0 ? (
          <div className="space-y-3">
            {active.length > 0 ? (
              <ul className="space-y-3">
                {active.map((recommendation) => (
                  <RecommendationItem
                    key={`${recommendation.liveStatus.recommendationIndex}-${recommendation.issue}`}
                    recommendation={recommendation}
                    analysisId={analysisId}
                    clientId={clientId}
                    canManageClients={canManageClients}
                    t={t}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-cc-green/30 bg-green-dim px-3 py-2.5 text-[13px] text-cc-green">
                <CheckCircle2 className="size-4 shrink-0" />
                {t("executive.recommendationStatus.noActive")}
              </div>
            )}

            {resolved.length > 0 && (
              <details className="group rounded-lg border border-cc-green/25 bg-green-dim/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[12px] font-semibold text-cc-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-green/40">
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    {t("executive.recommendationStatus.resolvedGroup", {
                      n: resolved.length,
                    })}
                  </span>
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="space-y-2 border-t border-cc-green/20 p-2">
                  {resolved.map((recommendation) => (
                    <RecommendationItem
                      key={`${recommendation.liveStatus.recommendationIndex}-${recommendation.issue}`}
                      recommendation={recommendation}
                      analysisId={analysisId}
                      clientId={clientId}
                      canManageClients={canManageClients}
                      t={t}
                    />
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-soft-1 px-3 py-6 text-center text-sm text-muted-foreground">
            {t("executive.noRecommendations")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function recommendationReasonText(
  reason: RecommendationResolutionReason,
  status: RecommendationLiveStatus,
  t: ReturnType<typeof useTranslations>,
) {
  switch (reason) {
    case "linked_tasks_open":
      return t("executive.recommendationStatus.reason.linkedTasksOpen", {
        n: status.openTaskCount ?? 0,
      });
    case "linked_tasks_resolved":
      return t("executive.recommendationStatus.reason.linkedTasksResolved", {
        n: status.matchedTasks.length,
      });
    case "linked_tasks_unverifiable":
      return t("executive.recommendationStatus.reason.linkedTasksUnverifiable");
    case "overdue_tasks_open":
      return t("executive.recommendationStatus.reason.overdueTasksOpen", {
        n: status.liveOverdueCount ?? 0,
      });
    case "overdue_tasks_resolved":
      return t("executive.recommendationStatus.reason.overdueTasksResolved");
    case "brief_missing":
      return t("executive.recommendationStatus.reason.briefMissing");
    case "brief_attached":
      return t("executive.recommendationStatus.reason.briefAttached");
    case "manual_confirmed":
      return t("executive.recommendationStatus.reason.manualConfirmed");
    default:
      return t("executive.recommendationStatus.reason.unverifiable");
  }
}

function RecommendationItem({
  recommendation,
  analysisId,
  clientId,
  canManageClients,
  t,
}: {
  recommendation: NonNullable<
    ClientSatisfactionDetail["analysis"]
  >["recommendations"][number] & { liveStatus: RecommendationLiveStatus };
  analysisId: string;
  clientId: string;
  canManageClients: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);
  const status = recommendation.liveStatus;
  const resolved = status.state === "resolved";
  const statusTone =
    status.state === "resolved"
      ? "border-cc-green/35 bg-green-dim text-cc-green"
      : status.state === "open"
        ? "border-amber/35 bg-amber-dim text-amber"
        : "border-border bg-soft-2 text-muted-foreground";
  const StatusIcon =
    status.state === "resolved"
      ? CheckCircle2
      : status.state === "open"
        ? AlertTriangle
        : HelpCircle;
  const canConfirm = canManageClients && status.state === "needs_confirmation";
  const canClearConfirmation =
    canManageClients && status.reason === "manual_confirmed";

  const updateManualStatus = (state: "resolved" | "cleared") => {
    setStatusError(null);
    startTransition(async () => {
      const result = await setRecommendationStatusAction({
        clientId,
        analysisId,
        recommendationIndex: status.recommendationIndex,
        issue: recommendation.issue,
        state,
      });
      if (result.error) {
        setStatusError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        resolved ? "border-cc-green/25 bg-card/70" : "border-border bg-soft-1",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
            REC_PRIORITY_TONE[recommendation.priority],
          )}
        >
          {t(`recPriority.${recommendation.priority}`)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold",
            statusTone,
          )}
        >
          <StatusIcon className="size-3" />
          {status.reason === "manual_confirmed"
            ? t("executive.recommendationStatus.state.manually_resolved")
            : t(`executive.recommendationStatus.state.${status.state}`)}
        </span>
      </div>
      <p
        className={cn(
          "text-[13px] font-medium leading-snug",
          resolved && "text-foreground/75",
        )}
      >
        {recommendation.issue}
      </p>
      <p
        className={cn(
          "mt-1.5 flex items-start gap-1.5 text-[13px]",
          resolved ? "text-muted-foreground" : "text-cyan",
        )}
      >
        <ArrowRightCircle className="mt-0.5 size-3.5 shrink-0" />
        {recommendation.action}
      </p>
      <div className="mt-2 border-t border-border/70 pt-2">
        <p className="text-[11px] leading-5 text-muted-foreground">
          {recommendationReasonText(status.reason, status, t)}
        </p>
        {status.matchedTasks.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {status.matchedTasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground/75 transition-colors hover:border-cyan/40 hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40"
              >
                {task.taskCode}
              </Link>
            ))}
          </div>
        )}
        {(canConfirm || canClearConfirmation) && (
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                updateManualStatus(canConfirm ? "resolved" : "cleared")
              }
              className="h-7 gap-1.5 px-2 text-[11px]"
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : canConfirm ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <ArchiveRestore className="size-3" />
              )}
              {canConfirm
                ? t("executive.recommendationStatus.confirmResolved")
                : t("executive.recommendationStatus.clearConfirmation")}
            </Button>
          </div>
        )}
        {statusError && (
          <p className="mt-1.5 text-[11px] text-cc-red">{statusError}</p>
        )}
      </div>
    </li>
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

// Keyed on the raw contracts-sheet `target` strings. The sheet stores
// 'On Target' (space) / 'Sales Deposit' / 'Closed'; the hyphenated 'On-Target'
// and 'Renewed' are kept for legacy/derived rows. Unknown values fall back to
// the neutral border at the call site.
const CONTRACT_TARGET_TONE: Record<string, string> = {
  "On Target": "border-cc-green/30 bg-green-dim text-cc-green",
  "On-Target": "border-cc-green/30 bg-green-dim text-cc-green",
  "Sales Deposit": "border-cyan/30 bg-cyan/10 text-cyan",
  Renewed: "border-cyan/30 bg-cyan/10 text-cyan",
  Overdue: "border-amber/30 bg-amber/10 text-amber",
  Closed: "border-border bg-soft-2 text-muted-foreground",
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
                    CONTRACT_TARGET_TONE[contract.target] ??
                      "border-border bg-soft-2 text-muted-foreground",
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
                  ACCOUNT_HEALTH_TONE[bigPicture.accountHealth] ??
                    ACCOUNT_HEALTH_TONE.watch,
                )}
              >
                {t(`accountHealth.${bigPicture.accountHealth}`)}
              </span>
            </Explained>
          </div>
        </div>
        {bigPicture.headline && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {bigPicture.headline}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
          {dims.map((d) => (
            <div
              key={d.key}
              className="flex flex-col items-center gap-1.5 text-center"
            >
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
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {ind.date}
              </span>
            )}
          </div>
          {ind.evidence && (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              {ind.evidence}
            </p>
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
                <p className="text-[12px] text-muted-foreground">
                  {t("indicators.noneRisk")}
                </p>
              )}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber">
                {t("indicators.operational")}{" "}
                {yellow.length > 0 && `(${yellow.length})`}
              </p>
              {yellow.length > 0 ? (
                <IndicatorGroup items={yellow} severity="yellow" t={t} />
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {t("indicators.noneOperational")}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// One request/approval count chip. When the analysis carries the underlying
// messages (examples), the chip becomes a button that opens a popover listing
// the actual client quotes behind the number — clicking a count shows WHAT it's
// made of, not just the figure. Older analyses with no examples stay plain.
function SignalCountBadge({
  label,
  count,
  examples,
}: {
  label: string;
  count: number;
  examples: { text: string; date: string | null }[];
}) {
  const hasExamples = examples.length > 0;
  const chipClass =
    "inline-flex items-center gap-1 rounded-md border border-border bg-soft-1 px-2 py-0.5 text-[11px]";
  const inner = (
    <>
      {label}
      <span className="font-semibold tabular-nums">{count}</span>
    </>
  );
  if (!hasExamples) {
    return <span className={chipClass}>{inner}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          chipClass,
          "cursor-pointer transition-colors hover:border-cyan/50 hover:bg-cyan/10",
        )}
      >
        {inner}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2">
        <p className="text-[11px] font-semibold text-foreground">
          {label} · {count}
        </p>
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {examples.map((ex, i) => (
            <li
              key={i}
              className="rounded-md border border-border bg-soft-1 px-2 py-1.5 text-[12px] leading-relaxed text-muted-foreground"
            >
              <span className="text-foreground">{ex.text}</span>
              {ex.date && (
                <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground/70">
                  {ex.date}
                </span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
  const apprKeys = [
    "approved",
    "rejected",
    "changesRequested",
    "noResponse",
  ] as const;
  return (
    <Card className="border-cyan/20">
      <CardContent className="space-y-3 p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <MessagesSquare className="size-4 text-cyan" />{" "}
          {t("signals.clientTitle")}
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
              <SignalCountBadge
                key={k}
                label={t(`signals.req.${k}`)}
                count={signals.requests[k]}
                examples={signals.requestExamples?.[k] ?? []}
              />
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
              <SignalCountBadge
                key={k}
                label={t(`signals.appr.${k}`)}
                count={signals.approvals[k]}
                examples={signals.approvalExamples?.[k] ?? []}
              />
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
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-[12px] text-muted-foreground"
                    >
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
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 text-[12px]"
                    >
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
  delivered: {
    icon: CheckCircle2,
    cls: "text-cc-green",
    badge: "border-cc-green/25 bg-cc-green/[0.07] text-cc-green",
  },
  partial: {
    icon: MinusCircle,
    cls: "text-amber",
    badge: "border-amber/30 bg-amber/10 text-amber",
  },
  not_delivered: {
    icon: XCircle,
    cls: "text-cc-red",
    badge: "border-cc-red/25 bg-red-dim/40 text-cc-red",
  },
  no_evidence: {
    icon: HelpCircle,
    cls: "text-muted-foreground",
    badge: "border-border bg-soft-2 text-muted-foreground",
  },
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
  const rank = {
    not_delivered: 0,
    partial: 1,
    delivered: 2,
    no_evidence: 3,
  } as const;
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
            <ClipboardList className="size-4 text-muted-foreground" />{" "}
            {t("briefBreakdown.title")}
            {score !== null && (
              <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                {score}%
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              ["delivered", "partial", "not_delivered", "no_evidence"] as const
            ).map((s) =>
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
        {/* reason now shown beneath the الالتزام بالبريف ring in the headline card */}
        {sorted.length > 0 ? (
          <ul className="space-y-2">
            {sorted.map((it, i) => {
              const meta = BRIEF_STATUS_META[it.status];
              const Icon = meta.icon;
              return (
                <li
                  key={i}
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-soft-1 p-3"
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", meta.cls)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium leading-snug">
                        {it.requirement}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                          meta.badge,
                        )}
                      >
                        {t(`briefBreakdown.status.${it.status}`)}
                      </span>
                    </div>
                    {it.note && (
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                        {it.note}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {t("briefBreakdown.empty")}
          </p>
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
          <GitBranch className="size-4 text-muted-foreground" />{" "}
          {t("causes.title")}
        </p>
        <ul className="space-y-2">
          {causes.map((c, i) => (
            <li
              key={i}
              className="rounded-lg border border-border bg-soft-1 p-3"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium leading-snug">
                  {c.problem}
                </span>
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

// ---- Accountability: complaint → finding → responsible people + tasks -------
// The audit spine. Names & task codes are already roster-validated server-side,
// so every chip here is a real person / real task. Person chips deep-link to the
// accountability drill-down; task chips to the filtered task list.
const BASIS_TONE: Record<string, string> = {
  stage_owner: "border-amber/40 bg-amber/10 text-amber",
  assignee: "border-cyan/40 bg-cyan/10 text-cyan",
  account_manager: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  team_manager: "border-blue-400/40 bg-blue-400/10 text-blue-300",
  process_gap: "border-cc-red/40 bg-cc-red/10 text-cc-red",
};

function AccountabilityPanel({
  accountability,
  teamContext,
  liveStates,
  t,
}: {
  accountability: Analysis["accountability"];
  teamContext: Analysis["teamContext"];
  liveStates: AccountabilityLiveState[];
  t: ReturnType<typeof useTranslations>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  if (!accountability || accountability.length === 0) return null;
  // name → employeeId, so person chips can deep-link to the accountability page.
  const idByName = new Map<string, string>();
  for (const p of teamContext?.people ?? []) {
    idByName.set(p.name.replace(/\s+/g, " ").trim(), p.employeeId);
  }
  // code → { title, id }: the AI only carries task CODES into accountability rows,
  // but the frozen roster (stuckTasks) holds the human title + task uuid. Every
  // rendered code is guaranteed to exist here (analyze-time validation filters
  // accountability codes to roster codes), so the task NAME always resolves and
  // the chip can deep-link to the real task instead of a code-search that misses.
  const taskByCode = new Map<string, { title: string; id: string | null }>();
  for (const st of teamContext?.stuckTasks ?? []) {
    if (st.taskCode)
      taskByCode.set(st.taskCode, { title: st.title, id: st.taskId ?? null });
  }
  // Live reconciliation: a complaint whose evidence tasks are all done (or that
  // was confirmed resolved) is a CLOSED problem — it sinks into a قسم منفصل
  // instead of shouting forever from the frozen snapshot.
  const stateByIndex = new Map(liveStates.map((s) => [s.index, s]));
  const openRows = accountability
    .map((row, i) => ({ row, i, live: stateByIndex.get(i) }))
    .filter(({ live }) => live?.state !== "resolved");
  const resolvedRows = accountability
    .map((row, i) => ({ row, i, live: stateByIndex.get(i) }))
    .filter(({ live }) => live?.state === "resolved");
  const renderRow = ({
    row,
    i,
    live,
  }: {
    row: Analysis["accountability"][number];
    i: number;
    live: AccountabilityLiveState | undefined;
  }) => {
    const resolved = live?.state === "resolved";
    return (
      <li
        key={i}
        className={cn(
          "rounded-lg border p-3",
          resolved
            ? "border-cc-green/25 bg-card/70 opacity-80"
            : "border-border bg-soft-1",
        )}
      >
        {/* complaint → finding */}
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "text-[13px] font-medium leading-snug",
              resolved && "text-foreground/70",
            )}
          >
            “{row.complaint}”
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {resolved && (
              <span className="inline-flex items-center gap-1 rounded border border-cc-green/35 bg-green-dim px-1.5 py-0.5 text-[10px] font-semibold text-cc-green">
                <CheckCircle2 className="size-3" />
                {live?.reason === "manual_confirmed"
                  ? t("accountability.resolvedConfirmed")
                  : t("accountability.resolvedByTasks")}
              </span>
            )}
            {row.service && (
              <span className="rounded border border-border bg-soft-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {row.service}
              </span>
            )}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                row.confidence === "high"
                  ? "bg-emerald-400/10 text-emerald-300"
                  : row.confidence === "low"
                    ? "bg-soft-2 text-muted-foreground"
                    : "bg-amber/10 text-amber",
              )}
            >
              {t(`accountability.confidence.${row.confidence}`)}
            </span>
          </div>
        </div>
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-foreground/90">
          <ArrowRightCircle className="mt-0.5 size-3.5 shrink-0 text-cc-red" />
          {row.finding}
        </p>

        {/* responsible people */}
        {row.responsible.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("accountability.responsible")}:
            </span>
            {row.responsible.map((p, j) => {
              const empId = idByName.get(p.name.replace(/\s+/g, " ").trim());
              const chip = (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    BASIS_TONE[p.basis] ??
                      "border-border bg-soft-2 text-foreground",
                  )}
                >
                  <Users className="size-3" />
                  {p.name}
                  <span className="opacity-70">
                    · {t(`accountability.basis.${p.basis}`)}
                  </span>
                </span>
              );
              return empId ? (
                <Link key={j} href={`/accountability?employee=${empId}`}>
                  {chip}
                </Link>
              ) : (
                <span key={j}>{chip}</span>
              );
            })}
          </div>
        )}

        {/* evidencing tasks */}
        {row.taskCodes.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("accountability.tasks")}:
            </span>
            {row.taskCodes.map((code) => {
              const task = taskByCode.get(code);
              // Deep-link to the task detail when we know its id; otherwise
              // fall back to the tasks search (RPC now matches task_code).
              const href = task?.id
                ? `/tasks/${task.id}`
                : `/tasks?q=${encodeURIComponent(code)}`;
              return (
                <Link
                  key={code}
                  href={href}
                  title={code}
                  className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-border bg-soft-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <ClipboardList className="size-3 shrink-0" />
                  <span className="truncate">{task?.title ?? code}</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* evidence line */}
        {row.evidence && (
          <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
            {row.evidence}
          </p>
        )}
      </li>
    );
  };
  return (
    <Card id="accountability" className="scroll-mt-24 border-cc-red/25">
      <CardContent className="p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <Scale className="size-4 text-cc-red" /> {t("accountability.title")}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("accountability.hint")}
        </p>
        <ul className="mt-3 space-y-3">{openRows.map(renderRow)}</ul>
        {resolvedRows.length > 0 && (
          <div
            className={cn(
              openRows.length > 0 && "mt-3 border-t border-border/60 pt-3",
            )}
          >
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-cc-green"
            >
              <CheckCircle2 className="size-3.5" />
              {t("accountability.resolvedGroup", { n: resolvedRows.length })}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  showResolved && "rotate-180",
                )}
              />
            </button>
            {showResolved && (
              <ul className="mt-2 space-y-3">{resolvedRows.map(renderRow)}</ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Team roster strip: pure facts from the frozen snapshot. Renders even
// when the AI produced no accountability rows — the CEO still sees who's on the
// account and who's gone quiet. Collapsible to keep the page calm.
function TeamRosterPanel({
  teamContext,
  t,
}: {
  teamContext: Analysis["teamContext"];
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);
  if (!teamContext || !teamContext.hasData || teamContext.people.length === 0)
    return null;
  const fmtDate = (iso: string | null) =>
    iso ? iso.slice(0, 10) : t("team.noActivity");
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-muted-foreground" /> {t("team.title")}
          </span>
          <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            {teamContext.accountManager && (
              <span>
                {t("team.accountManager")}: {teamContext.accountManager}
              </span>
            )}
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {/* services summary */}
            {teamContext.services.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {teamContext.services.map((s) => (
                  <span
                    key={s.service}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-soft-1 px-2 py-1 text-[11px]"
                  >
                    <span className="text-muted-foreground">{s.service}</span>
                    <span className="rounded-full bg-soft-2 px-1.5 font-medium tabular-nums">
                      {s.totalOpen}
                    </span>
                    {s.overdue > 0 && (
                      <span className="rounded-full bg-amber/15 px-1.5 font-medium tabular-nums text-amber">
                        {s.overdue}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* people table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pe-2 text-start font-medium">
                      {t("team.person")}
                    </th>
                    <th className="px-2 text-start font-medium">
                      {t("team.role")}
                    </th>
                    <th className="px-2 text-center font-medium">
                      {t("team.open")}
                    </th>
                    <th className="px-2 text-center font-medium">
                      {t("team.overdue")}
                    </th>
                    <th className="px-2 text-center font-medium">
                      {t("team.actions30d")}
                    </th>
                    <th className="ps-2 text-start font-medium">
                      {t("team.lastAction")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teamContext.people.map((p) => (
                    <tr
                      key={p.employeeId}
                      className="border-b border-border/50 last:border-0"
                    >
                      <td className="py-1.5 pe-2">
                        <Link
                          href={`/accountability?employee=${p.employeeId}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-2 text-muted-foreground">
                        {p.positionLabel}
                      </td>
                      <td className="px-2 text-center tabular-nums">
                        {p.openTasks}
                      </td>
                      <td
                        className={cn(
                          "px-2 text-center tabular-nums",
                          p.overdueTasks > 0 && "font-medium text-amber",
                        )}
                      >
                        {p.overdueTasks || "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2 text-center tabular-nums",
                          p.actions30d === 0 &&
                            p.overdueTasks > 0 &&
                            "font-medium text-cc-red",
                        )}
                      >
                        {p.actions30d}
                      </td>
                      <td className="ps-2 text-muted-foreground tabular-nums">
                        {fmtDate(p.lastActionAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* code-detected gaps */}
            {teamContext.gaps.length > 0 && (
              <div className="rounded-lg border border-cc-red/20 bg-cc-red/5 p-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cc-red">
                  {t("team.gaps")}
                </p>
                <ul className="space-y-1">
                  {teamContext.gaps.map((g, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-[11px] text-foreground/90"
                    >
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-cc-red" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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
  sentimentTimeline: NonNullable<
    ClientSatisfactionDetail["analysis"]
  >["sentimentTimeline"];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-cyan" />{" "}
            {t("executive.timelineTitle")}
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
                    range === value
                      ? "bg-soft-2 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`executive.range.${value}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              "all",
              "complaint",
              "approval",
              "delay",
              "internal",
              "decision",
            ] as const
          ).map((value) => (
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
                  <div
                    key={i}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
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
      className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-cyan transition-colors hover:border-cyan/40"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{brief.filename}</span>
      <ExternalLink className="size-3 shrink-0 opacity-70" />
    </a>
  );
}

// The attached brief + its manage controls: open it, replace it (reveals the
// attach forms), or delete a wrongly-uploaded doc. Replacing first removes the
// old row so a different filename/URL can't leave the wrong brief lingering.
function BriefManager({
  brief,
  clientId,
  activeProjects,
  t,
}: {
  brief: NonNullable<ClientSatisfactionDetail["brief"]>;
  clientId: string;
  activeProjects: ClientSatisfactionDetail["activeProjects"];
  t: ReturnType<typeof useTranslations>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteClientBriefAction({
        clientId,
        attachmentId: brief.attachmentId,
        source: brief.source,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 space-y-1.5">
      <div className="flex items-center gap-1">
        <BriefLink brief={brief} />
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
            setConfirming(false);
          }}
          title={t("replaceBrief")}
          className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-cyan/40 hover:text-cyan"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setEditing(false);
          }}
          title={t("deleteBrief")}
          className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-cc-red/40 hover:text-cc-red"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-cc-red/30 bg-cc-red/5 px-2 py-1.5 text-[11px]">
          <span className="text-cc-red">{t("deleteBriefConfirm")}</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={remove}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {t("deleteBrief")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
        </div>
      )}

      {error && <p className="text-[11px] text-cc-red">{error}</p>}

      {editing && (
        <div className="rounded-lg border border-border bg-soft-1 p-3">
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            {t("replaceBriefHint")}
          </p>
          <BriefAttachForms
            clientId={clientId}
            activeProjects={activeProjects}
            t={t}
          />
        </div>
      )}
    </div>
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
        <BriefAttachForms
          clientId={clientId}
          activeProjects={activeProjects}
          t={t}
        />
      </CardContent>
    </Card>
  );
}

// The shared brief attach UI (project picker + Google link + file upload + the
// post-save "re-analyze now / later" prompt). Used both when no brief exists
// (MissingBriefPanel) and when replacing a wrong one (BriefManager).
function BriefAttachForms({
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
      const res = await attachClientBriefLinkAction({
        clientId,
        projectId: projectId || undefined,
        url,
      });
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
    <div className="space-y-3">
      {saved ? (
        // Success prompt — explicit "re-analyze now" vs "later" (no auto run).
        <div className="rounded-lg border border-cc-green/30 bg-green-dim/40 p-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-cc-green">
            <CheckCircle2 className="size-4" /> {saved}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("briefSavedPrompt")}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={reanalyze} disabled={reanalyzing}>
              {reanalyzing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
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
          <form
            onSubmit={saveLink}
            className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              dir="ltr"
              placeholder={t("briefLinkPlaceholder")}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-cyan/50"
            />
            <Button
              type="submit"
              disabled={busy !== null || noProject || !url.trim()}
            >
              {busy === "link" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {t("saveBriefLink")}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground/60">
            <span className="h-px flex-1 bg-border" />
            {t("or")}
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Option B — upload a local file (txt / csv / xlsx) */}
          <form
            onSubmit={uploadFile}
            className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.csv,.tsv,.xlsx,.xls,text/plain,text/csv"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="h-9 rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground outline-none transition-colors file:me-2 file:rounded file:border-0 file:bg-soft-2 file:px-2 file:py-1 file:text-xs file:text-foreground focus:border-cyan/50"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy !== null || noProject || !fileName}
            >
              {busy === "file" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              {t("uploadBriefFile")}
            </Button>
          </form>
          <p className="text-[11px] text-muted-foreground/70">
            {t("briefFileHint")}
          </p>
        </>
      )}

      {error && <p className="text-xs text-cc-red">{error}</p>}
    </div>
  );
}
