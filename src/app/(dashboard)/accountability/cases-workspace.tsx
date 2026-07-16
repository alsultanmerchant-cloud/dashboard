"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Link2,
  Quote,
  RefreshCw,
  Repeat,
  Scale,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { refreshAccountabilityScorecardAction, setCaseStatusAction } from "./_actions";
import { Card, CardContent } from "@/components/ui/card";
import { CaseOverview } from "./case-overview";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FilterChip } from "@/components/filter-chip";
import { cn } from "@/lib/utils";
import { CaseAdviceSchema } from "@/lib/accountability/advice-schema";
import {
  CASE_STATUSES,
  CASE_STATUS_LABEL,
  type CaseStatus,
  type PersistedCaseMeta,
} from "@/lib/accountability/case-status";
import type { CaseBrief } from "@/lib/data/accountability-case-brief";
import type {
  AccountabilityCase,
  AccountabilityCasesResult,
  CaseLedger,
  CaseProof,
  CaseSeverity,
  CaseStream,
} from "@/lib/data/accountability-cases";

const PAGE = 10;

export const SEVERITY_META: Record<
  CaseSeverity,
  { label: string; badge: string; accent: string; icon: typeof AlertOctagon }
> = {
  critical: { label: "حرجة", badge: "border-cc-red/30 bg-red-dim text-cc-red", accent: "border-s-cc-red", icon: AlertOctagon },
  proven: { label: "مثبتة", badge: "border-amber/30 bg-amber-dim text-amber", accent: "border-s-amber", icon: AlertTriangle },
  signal: { label: "إشارة", badge: "border-cyan/25 bg-cyan/10 text-cyan", accent: "border-s-cyan/50", icon: Info },
};

export const STREAM_META: Record<CaseStream, { label: string; icon: typeof Wrench; tone: string }> = {
  execution: { label: "تنفيذ", icon: Wrench, tone: "border-border bg-soft-1 text-foreground/80" },
  client: { label: "صوت العميل", icon: Quote, tone: "border-cyan/25 bg-cyan/10 text-cyan" },
  commercial: { label: "تجاري", icon: Scale, tone: "border-amber/25 bg-amber-dim text-amber" },
};

const STATUS_TONE: Record<CaseStatus, string> = {
  open: "border-border bg-soft-1 text-muted-foreground",
  under_review: "border-cyan/25 bg-cyan/10 text-cyan",
  excused: "border-cc-green/25 bg-green-dim text-cc-green",
  warned: "border-amber/30 bg-amber-dim text-amber",
  resolved: "border-border bg-soft-1 text-muted-foreground/60",
};

export function CasesWorkspace({
  data,
  caseMeta,
  brief,
}: {
  data: AccountabilityCasesResult;
  caseMeta: Record<string, PersistedCaseMeta>;
  brief: CaseBrief;
}) {
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<CaseSeverity | "all">("all");
  const [stream, setStream] = useState<CaseStream | "all">("all");
  const [visible, setVisible] = useState(PAGE);

  const handleRefresh = () =>
    startRefresh(async () => {
      const res = await refreshAccountabilityScorecardAction();
      if (res.ok) {
        toast.success("تم تحديث البيانات");
        window.location.reload();
      } else {
        toast.error(res.error ?? "تعذّر التحديث");
      }
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.cases.filter((c) => {
      if (severity !== "all" && c.severity !== severity) return false;
      if (stream !== "all" && !c.streams.includes(stream)) return false;
      if (q && !c.employeeName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.cases, query, severity, stream]);

  const shown = filtered.slice(0, visible);
  const canLoadMore = shown.length < filtered.length;

  const severityChips: { key: CaseSeverity | "all"; label: string; count: number }[] = [
    { key: "all", label: "الكل", count: data.cases.length },
    { key: "critical", label: "حرجة", count: data.meta.critical },
    { key: "proven", label: "مثبتة", count: data.meta.proven },
    { key: "signal", label: "إشارة", count: data.meta.signal },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <MethodologyNote streams={data.meta.streamsAvailable} unmatched={data.meta.unmatchedNames} />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-soft-1 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "جارٍ التحديث…" : "تحديث البيانات"}
        </button>
      </div>

      <CaseOverview brief={brief} />

      <FilterBar
        className="mb-0"
        search={{ value: query, onChange: setQuery, placeholder: "ابحث عن موظف…" }}
        hasActiveFilters={query.trim() !== "" || severity !== "all" || stream !== "all"}
        onClear={() => {
          setQuery("");
          setSeverity("all");
          setStream("all");
        }}
      >
        {severityChips.map((c) => (
          <FilterChip key={c.key} as="button" active={severity === c.key} count={c.count} onClick={() => setSeverity(c.key)}>
            {c.label}
          </FilterChip>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 self-center bg-border" aria-hidden />
        {data.meta.streamsAvailable.map((st) => (
          <FilterChip key={st} as="button" active={stream === st} onClick={() => setStream(stream === st ? "all" : st)}>
            {STREAM_META[st].label}
          </FilterChip>
        ))}
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Scale className="size-6" />}
          title="لا توجد قضايا في هذا الفلتر"
          description="غيّر الفلتر، أو حدّث البيانات لالتقاط أحدث سجل المراحل وتحليلات الرضا."
        />
      ) : (
        <div className="space-y-3">
          {shown.map((c) => (
            <CaseCard
              key={c.employeeId ?? c.employeeName}
              c={c}
              meta={c.employeeId ? caseMeta[c.employeeId] ?? null : null}
            />
          ))}
        </div>
      )}

      {canLoadMore && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-soft-1/40 px-4 py-3">
          <p className="text-[11px] text-muted-foreground">
            عرض {shown.length} من {filtered.length} قضية
          </p>
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE)}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan/20 bg-cyan/10 px-3 py-1.5 text-xs font-semibold text-cyan transition-colors hover:bg-cyan/15"
          >
            عرض المزيد
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}

      <p className="text-end text-[11px] text-muted-foreground/60">
        احتُسب في{" "}
        <span dir="ltr" className="tabular-nums">
          {data.generatedAt.slice(0, 16).replace("T", " ")}
        </span>
      </p>
    </div>
  );
}

function MethodologyNote({ streams, unmatched }: { streams: CaseStream[]; unmatched: string[] }) {
  const [open, setOpen] = useState(false);
  const streamLabels = streams.map((s) => STREAM_META[s].label).join(" + ");
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-cyan/20 bg-cyan/5 px-3 py-2 text-xs text-muted-foreground">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-start" aria-expanded={open}>
        <Info className="size-3.5 shrink-0 text-cyan" />
        <span className="font-medium text-foreground/80">كيف تُبنى القضايا وتُرتّب؟</span>
        <ChevronDown className={cn("ms-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <p>
            كل قضية = <b className="text-foreground/80">مَن + ماذا + الدليل</b>، مبنية على مصادر
            مستقلة تُقاس آليًا: <span className="text-foreground/80">{streamLabels}</span>. كل رقم
            محسوب من البيانات؛ إسهام الذكاء الاصطناعي محصور في اقتباس نص العميل (مُعلَّم)، والنصيحة
            لا تُولَّد إلا عند الطلب.
          </p>
          <p>
            الترتيب بالتقاطع: <span className="text-cc-red">حرجة</span> = شكوى عميل تسمّي مهمة عالقة
            فعلًا في مرحلته، <span className="text-amber">مثبتة</span> = مصدران متفقان،{" "}
            <span className="text-cyan">إشارة</span> = مصدر واحد.
          </p>
          {unmatched.length > 0 && (
            <p className="text-[11px] text-muted-foreground/80">
              أسماء وردت في الشكاوى ولم تُطابَق بموظف (تظهر كنص فقط): {unmatched.join("، ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Proof, grouped by stream (shared by the card + the employee modal) ----
export function CaseEvidence({ c, cap = 4 }: { c: AccountabilityCase; cap?: number }) {
  const [expanded, setExpanded] = useState(false);
  const groups: { stream: CaseStream; proof: CaseProof[] }[] = (
    [
      { stream: "execution", proof: c.proof.filter((p) => p.stream === "execution") },
      { stream: "client", proof: c.proof.filter((p) => p.stream === "client") },
      { stream: "commercial", proof: c.proof.filter((p) => p.stream === "commercial") },
    ] as { stream: CaseStream; proof: CaseProof[] }[]
  ).filter((g) => g.proof.length > 0);
  const totalProof = c.proof.length;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">الدليل</p>
      {groups.map((g) => {
        const m = STREAM_META[g.stream];
        const SIcon = m.icon;
        const list = expanded ? g.proof : g.proof.slice(0, cap);
        return (
          <div key={g.stream}>
            <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
              <SIcon className="size-3.5 text-cyan" />
              {m.label}
            </p>
            <ul className="space-y-1.5">
              {list.map((p, i) => (
                <ProofLine key={`${g.stream}-${i}`} p={p} />
              ))}
            </ul>
          </div>
        );
      })}
      {totalProof > cap && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan hover:underline">
          {expanded ? "طيّ الأدلة" : `عرض كل الأدلة (${totalProof})`}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

// ---- Case card -------------------------------------------------------------
function CaseCard({ c, meta }: { c: AccountabilityCase; meta: PersistedCaseMeta | null }) {
  const [showAdvice, setShowAdvice] = useState(false);
  const sev = SEVERITY_META[c.severity];
  const SevIcon = sev.icon;

  return (
    <Card className={cn("overflow-hidden border-s-2", sev.accent)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold", sev.badge)}>
                <SevIcon className="size-3.5" />
                {sev.label}
              </span>
              {c.employeeId ? (
                <Link href={`/accountability?emp=${c.employeeId}&view=scorecard`} className="text-base font-bold hover:text-cyan">
                  {c.employeeName}
                </Link>
              ) : (
                <span className="text-base font-bold">{c.employeeName}</span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {c.role ?? "—"}
                {c.department ? ` · ${c.department}` : ""}
              </span>
              {meta && meta.timesSeen > 1 && (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-amber/25 bg-amber-dim px-1.5 py-0.5 text-[10px] font-semibold text-amber"
                  title={`أول رصد ${meta.firstSeenAt.slice(0, 10)}`}
                >
                  <Repeat className="size-3" />
                  تكرّرت {meta.timesSeen}×
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.streams.map((st) => {
                const m = STREAM_META[st];
                const SIcon = m.icon;
                return (
                  <span key={st} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", m.tone)}>
                    <SIcon className="size-3" />
                    {m.label}
                  </span>
                );
              })}
              {c.proof.some((p) => p.crossLinked) && (
                <span className="inline-flex items-center gap-1 rounded-md border border-cc-red/30 bg-red-dim px-1.5 py-0.5 text-[10px] font-semibold text-cc-red">
                  <Link2 className="size-3" />
                  دليل متقاطع
                </span>
              )}
              <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
              {c.problemTags.map((tag) => (
                <span key={tag} className="rounded-md bg-soft-1 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {c.employeeId && <StatusControl employeeId={c.employeeId} meta={meta} />}
            <button
              type="button"
              onClick={() => setShowAdvice((v) => !v)}
              disabled={!c.employeeId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/25 bg-cyan/5 px-2.5 py-1.5 text-[11px] font-semibold text-cyan transition-colors hover:bg-cyan/10 disabled:opacity-50"
            >
              <Sparkles className="size-3.5" />
              {showAdvice ? "إخفاء النصيحة" : "توليد نصيحة"}
            </button>
          </div>
        </div>

        {/* Ledger + heatmap */}
        {c.ledger && <LedgerStrip led={c.ledger} />}

        {/* Advice panel (opt-in) */}
        {showAdvice && c.employeeId && <AdvicePanel employeeId={c.employeeId} />}

        {/* Manager decision note */}
        {meta?.decisionNote && (
          <p className="mt-3 rounded-md border border-border bg-soft-1/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            قرار المدير{meta.decidedByName ? ` (${meta.decidedByName})` : ""}: {meta.decisionNote}
          </p>
        )}

        {/* Proof */}
        <CaseEvidence c={c} />
      </CardContent>
    </Card>
  );
}

// ---- Status control (manager decision loop) --------------------------------
export function StatusControl({ employeeId, meta }: { employeeId: string; meta: PersistedCaseMeta | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const current: CaseStatus = meta?.status ?? "open";

  const setStatus = (status: CaseStatus) => {
    setOpen(false);
    if (status === current) return;
    let note: string | null = null;
    if (status === "excused" || status === "warned") {
      note = window.prompt(status === "excused" ? "سبب اعتبارها مبرَّرة (اختياري):" : "ملاحظة الإنذار/الإجراء (اختياري):", "");
    }
    startSave(async () => {
      const res = await setCaseStatusAction({ employeeId, status, note: note ?? undefined });
      if (res.ok) {
        toast.success("تم تحديث حالة القضية");
        router.refresh();
      } else {
        toast.error(res.error ?? "تعذّر التحديث");
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60", STATUS_TONE[current])}
      >
        {saving ? <RefreshCw className="size-3 animate-spin" /> : null}
        {CASE_STATUS_LABEL[current]}
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            {CASE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-start text-[11px] transition-colors hover:bg-soft-1",
                  s === current && "bg-soft-1 font-semibold",
                )}
              >
                {CASE_STATUS_LABEL[s]}
                {s === current && <Check className="size-3 text-cyan" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Advice panel (streamed, opt-in) ---------------------------------------
export function AdvicePanel({ employeeId }: { employeeId: string }) {
  const { submit, isLoading, object, stop } = useObject({
    api: `/api/accountability/advice/${employeeId}`,
    schema: CaseAdviceSchema,
  });
  const [started, setStarted] = useState(false);

  const run = () => {
    setStarted(true);
    submit({});
  };

  const steps = (object?.steps ?? []).filter(Boolean) as string[];
  const watchFor = (object?.watchFor ?? []).filter(Boolean) as string[];

  return (
    <div className="mt-3 rounded-xl border border-cyan/20 bg-cyan/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-cyan">
          <Sparkles className="size-3.5" />
          نصيحة للمدير — عند الطلب
        </span>
        <button
          type="button"
          onClick={isLoading ? stop : run}
          className="inline-flex items-center gap-1 rounded-lg border border-cyan/30 px-2.5 py-1 text-[11px] font-medium text-cyan transition-colors hover:bg-cyan/10"
        >
          <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
          {isLoading ? "يحلّل…" : started ? "توليد من جديد" : "توليد النصيحة"}
        </button>
      </div>

      {/* Finished but produced nothing (error, or the AI gateway returned no
          object) — always give the user feedback instead of a blank panel. */}
      {started && !isLoading && !object?.headline && (
        <p className="mt-2 text-[11px] text-cc-red">
          تعذّر توليد النصيحة الآن — أعد المحاولة، وإن تكرّر فقد تكون خدمة الذكاء الاصطناعي غير متاحة
          مؤقتًا.
        </p>
      )}

      {!started && !isLoading && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          اضغط «توليد النصيحة» للحصول على تشخيص وخطوات عملية للتعامل مع هذه القضية. لا يُستدعى النموذج
          إلا عند طلبك.
        </p>
      )}

      {started && (object?.headline || isLoading) && (
        <div className="mt-2 space-y-2 text-[13px]">
          <p className={cn("font-bold text-foreground/90", isLoading && !object?.headline && "animate-pulse")}>
            {object?.headline || "يحلّل القضية…"}
          </p>
          {object?.diagnosis && <p className="leading-relaxed text-foreground/85">{object.diagnosis}</p>}
          {steps.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">خطوات المدير</p>
              <ul className="mt-1 space-y-1">
                {steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 leading-relaxed text-foreground/85">
                    <Check className="mt-0.5 size-3 shrink-0 text-cc-green" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {object?.coachingNote && (
            <div className="rounded-md border border-border bg-soft-1/70 p-2">
              <p className="text-[11px] font-semibold text-muted-foreground">ملاحظة للموظف</p>
              <p className="mt-0.5 leading-relaxed">{object.coachingNote}</p>
            </div>
          )}
          {watchFor.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              راقب: {watchFor.join(" · ")}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70">نصيحة مولّدة بالذكاء الاصطناعي استنادًا إلى أدلة القضية.</p>
        </div>
      )}
    </div>
  );
}

// ---- Ledger strip + 14-day heatmap -----------------------------------------
export function LedgerStrip({ led }: { led: CaseLedger }) {
  const openDelta = led.openTasks - led.peerMedianOpen;
  const actionDelta = led.actions30d - led.peerMedianActions;
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-center sm:grid-cols-6">
        <LedgerCell label="مفتوحة" value={led.openTasks} sub={peerSub(openDelta)} />
        <LedgerCell label="متأخرة" value={led.overdueOwned} tone={led.overdueOwned > 0 ? "text-cc-red" : undefined} />
        <LedgerCell label="الالتزام" value={led.onTimeRate === null ? "—" : `${led.onTimeRate}%`} />
        <LedgerCell label="إجراءات ٣٠ي" value={led.actions30d} sub={peerSub(actionDelta)} />
        <LedgerCell label="أيام صامتة (١٤ي)" value={led.silentWorkingDays14} tone={led.silentWorkingDays14 >= 5 ? "text-cc-red" : led.silentWorkingDays14 >= 3 ? "text-amber" : undefined} />
        <LedgerCell
          label="آخر إجراء"
          value={led.daysSinceLastAction === null ? "—" : led.daysSinceLastAction === 0 ? "اليوم" : `${led.daysSinceLastAction}ي`}
          tone={led.daysSinceLastAction !== null && led.daysSinceLastAction >= 7 ? "text-cc-red" : undefined}
        />
      </div>
      {led.dailyActivity.length > 0 && <Heatmap daily={led.dailyActivity} />}
    </div>
  );
}

function peerSub(delta: number): string | undefined {
  if (delta === 0) return "= الوسيط";
  return delta > 0 ? `+${delta} عن الوسيط` : `${delta} عن الوسيط`;
}

function LedgerCell({ label, value, tone, sub }: { label: string; value: string | number; tone?: string; sub?: string }) {
  return (
    <div className="bg-card px-2 py-2">
      <p className={cn("text-sm font-bold tabular-nums", tone ?? "text-foreground")} dir="ltr">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{label}</p>
      {sub && <p className="text-[9px] leading-tight text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

// 14-day authored-activity heatmap. Fri/Sat (weekend) shown hollow.
function Heatmap({ daily }: { daily: { date: string; count: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const level = (n: number) => {
    if (n === 0) return "bg-soft-2";
    const r = n / max;
    if (r > 0.66) return "bg-cyan";
    if (r > 0.33) return "bg-cyan/60";
    return "bg-cyan/30";
  };
  const isWeekend = (iso: string) => {
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return dow === 5 || dow === 6;
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground">النشاط ١٤ يومًا</span>
      <div className="flex items-end gap-0.5" dir="ltr">
        {daily.map((d) => (
          <span
            key={d.date}
            title={`${d.date}: ${d.count} إجراء`}
            className={cn(
              "size-3 rounded-[3px]",
              isWeekend(d.date) && d.count === 0 ? "border border-dashed border-border bg-transparent" : level(d.count),
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ProofLine({ p }: { p: CaseProof }) {
  const body = (
    <>
      <span className="flex min-w-0 items-start gap-2">
        {p.crossLinked && (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded border border-cc-red/30 bg-red-dim px-1 py-0.5 text-[9px] font-semibold text-cc-red" title="مهمة تظهر في مصدرين">
            <Link2 className="size-2.5" />
            متقاطع
          </span>
        )}
        <span className="min-w-0 text-[13px] leading-relaxed">{p.text}</span>
      </span>
      {typeof p.ownerActions === "number" && (
        <span
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
            p.ownerActions === 0
              ? "border-cc-red/30 bg-red-dim text-cc-red"
              : p.ownerActions <= 2
                ? "border-amber/30 bg-amber-dim text-amber"
                : "border-border bg-soft-1 text-muted-foreground",
          )}
          title="عدد إجراءات صاحب المهمة عليها منذ دخولها هذه المرحلة"
        >
          <Activity className="size-3" />
          {p.ownerActions === 0 ? "بلا إجراء" : `${p.ownerActions} إجراء`}
          {typeof p.windowDays === "number" ? ` · ${p.windowDays} يوم` : ""}
        </span>
      )}
      {p.quote && (
        <span className="mt-1.5 flex gap-1.5 rounded-md bg-soft-1/70 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          <Quote className="mt-0.5 size-3 shrink-0 text-cc-red" />
          <span className="min-w-0">
            {p.quote}
            <span className="ms-1 rounded bg-cyan/10 px-1 py-0.5 text-[9px] text-cyan">نص العميل · ذكاء اصطناعي</span>
          </span>
        </span>
      )}
    </>
  );
  const cls = "block rounded-lg border border-border bg-card px-2.5 py-2 transition-colors";
  return (
    <li>
      {p.href ? (
        <Link href={p.href} className={cn(cls, "hover:border-cyan/30 hover:bg-soft-1")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
