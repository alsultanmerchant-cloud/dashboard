"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Upload,
  MessageSquare,
  Wrench,
  Sparkles,
  CheckCircle2,
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
} from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadChatImportAction } from "./_actions";
import type {
  ClientSatisfactionDetail,
  GroupKind,
  ImportInfo,
  SatisfactionRow,
} from "@/lib/data/satisfaction";

interface Props {
  options: { value: string; label: string }[];
  rows: SatisfactionRow[];
  detail: ClientSatisfactionDetail | null;
  selectedId: string | null;
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

export function SatisfactionWorkspace({ options, rows, detail, selectedId }: Props) {
  const t = useTranslations("SatisfactionPage");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = (id: string) => {
    if (id) router.push(`/satisfaction?client=${id}`);
  };

  const analyzeClient = async (clientId: string) => {
    const res = await fetch("/api/satisfaction/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "تعذر التحليل");
    router.refresh();
  };

  const analyze = async () => {
    if (!selectedId) return;
    setError(null);
    setAnalyzing(true);
    try {
      await analyzeClient(selectedId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
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
          {/* Upload zones */}
          <div className="grid gap-4 md:grid-cols-2">
            <UploadCard
              kind="client"
              icon={<MessageSquare className="size-4" />}
              title={t("clientGroup")}
              hint={t("clientGroupHint")}
              info={detail.imports.client}
              clientId={selectedId}
              isPending={isPending}
              startTransition={startTransition}
              onError={setError}
              onDone={() => router.refresh()}
              t={t}
            />
            <UploadCard
              kind="technical"
              icon={<Wrench className="size-4" />}
              title={t("technicalGroup")}
              hint={t("technicalGroupHint")}
              info={detail.imports.technical}
              clientId={selectedId}
              isPending={isPending}
              startTransition={startTransition}
              onError={setError}
              onDone={() => router.refresh()}
              t={t}
            />
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg bg-red-dim px-3 py-2 text-sm text-cc-red">
              <AlertTriangle className="size-4" /> {error}
            </p>
          )}

          {/* Analyze */}
          <div className="flex items-center gap-3">
            <Button
              onClick={analyze}
              disabled={analyzing || (!detail.imports.client && !detail.imports.technical)}
            >
              {analyzing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {detail.analysis ? t("reanalyze") : t("analyze")}
            </Button>
            {!detail.imports.client && !detail.imports.technical && (
              <span className="text-xs text-muted-foreground">{t("uploadFirst")}</span>
            )}
            {detail.analysis && (
              <span className="text-xs text-muted-foreground">
                {t("lastAnalyzed")}: {detail.analysis.createdAt.slice(0, 16).replace("T", " ")}
              </span>
            )}
          </div>

          {/* Results */}
          {detail.analysis && <AnalysisView analysis={detail.analysis} t={t} sentimentLabel={sentimentLabel} />}
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.clientName.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

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
      {/* Toolbar: search + view toggle */}
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
        <SatisfactionBoard rows={filtered} onSelect={onSelect} t={t} />
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
  t,
}: {
  rows: SatisfactionRow[];
  onSelect: (id: string) => void;
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
                  <BoardCard key={r.clientId} row={r} accent={b.accent} onSelect={onSelect} t={t} />
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
  t,
}: {
  row: SatisfactionRow;
  accent: string;
  onSelect: (id: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const analyzed = row.satisfactionScore !== null;
  return (
    <button
      type="button"
      onClick={() => onSelect(row.clientId)}
      className="group flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 text-start transition-colors hover:border-cyan/40 hover:bg-soft-1"
    >
      {analyzed ? (
        <Ring score={row.satisfactionScore} size={44} />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground">
          —
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.clientName}</p>
        <p className={cn("text-[11px] font-medium", accent)}>
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
      <ChevronLeft className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-cyan rtl:rotate-0 ltr:rotate-180" />
    </button>
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
                    <td className="p-3 font-medium">{r.clientName}</td>
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

// ---- Upload card ---------------------------------------------------------
function UploadCard({
  kind,
  icon,
  title,
  hint,
  info,
  clientId,
  isPending,
  startTransition,
  onError,
  onDone,
  t,
}: {
  kind: GroupKind;
  icon: React.ReactNode;
  title: string;
  hint: string;
  info: ImportInfo | null;
  clientId: string;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
  onError: (e: string | null) => void;
  onDone: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    onError(null);
    setBusy(true);
    try {
      const content = await file.text();
      const fd = new FormData();
      fd.set("clientId", clientId);
      fd.set("groupKind", kind);
      fd.set("filename", file.name);
      fd.set("content", content);
      startTransition(async () => {
        const res = await uploadChatImportAction(undefined, fd);
        setBusy(false);
        if (res.error) onError(res.error);
        else onDone();
      });
    } catch (e) {
      setBusy(false);
      onError((e as Error).message);
    }
  };

  return (
    <Card className={cn("border", info ? "border-cc-green/30" : "border-border")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-soft-2 text-cyan">
              {icon}
            </span>
            {title}
          </p>
          {info && <CheckCircle2 className="size-4 text-cc-green" />}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>

        {info && (
          <div className="mt-3 rounded-lg bg-soft-1 p-2.5 text-[11px] text-muted-foreground">
            <p className="truncate font-medium text-foreground">{info.sourceFilename ?? "—"}</p>
            <p className="mt-0.5 tabular-nums">
              {t("messages", { n: info.messageCount })} · {t("participants", { n: info.participantCount })}
            </p>
            {info.firstMessageAt && info.lastMessageAt && (
              <p className="tabular-nums">
                {info.firstMessageAt.slice(0, 10)} → {info.lastMessageAt.slice(0, 10)}
              </p>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          disabled={busy || isPending}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {info ? t("replaceFile") : t("uploadFile")}
        </Button>
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

function AnalysisView({
  analysis,
  t,
  sentimentLabel,
}: {
  analysis: NonNullable<ClientSatisfactionDetail["analysis"]>;
  t: ReturnType<typeof useTranslations>;
  sentimentLabel: (s: string | null) => string;
}) {
  const tone = scoreTone(analysis.satisfactionScore);
  const timeline = analysis.sentimentTimeline ?? [];
  return (
    <div className="space-y-4">
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

      {/* highlights */}
      {analysis.highlights.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <Quote className="size-4 text-cyan" /> {t("highlights")}
            </p>
            <ul className="space-y-2">
              {analysis.highlights.map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-[13px]">
                  <span className="flex items-start gap-2">
                    <span className={cn("mt-0.5 text-xs font-semibold", HL_TONE[h.type] ?? "text-muted-foreground")}>
                      {t(`highlightType.${h.type}`)}
                    </span>
                    <span className="text-muted-foreground">{h.text}</span>
                  </span>
                  {h.date && (
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                      {h.date}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
