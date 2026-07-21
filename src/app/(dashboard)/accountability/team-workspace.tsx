"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ExplainBlock } from "@/components/metric-info";
import { cn } from "@/lib/utils";
import {
  SEVERITY_META,
  STREAM_META,
  LedgerStrip,
  AdvicePanel,
  CaseEvidence,
  ProblemStatusRollup,
  rollupProblems,
  type ProblemRollup,
} from "./cases-workspace";
import type { PersistedProblemMeta } from "@/lib/data/accountability-problems-store";
import { getAccountabilityEvidenceAction, getEmployeeMetricDrillAction } from "./_actions";
import { DrillNumber, TaskDrillSheet, type DrillView } from "./task-drill-modal";
import { EmployeeEvidence } from "./employee-evidence";
import { ReviewerRigorSection } from "./reviewer-rigor-section";
import { ClientEditsSection } from "./client-edits-section";
import { AccountabilityRangePicker } from "./accountability-range-picker";
import { AccountabilityPeriodTrend } from "./accountability-period-trend";
import type {
  AccountabilityEvidence,
  AccountabilityOverview,
  ClientEditsRow,
  DrillTask,
  EmployeeMetric,
} from "@/lib/data/accountability";
import { daySpan, type DashboardRange } from "@/lib/dashboard-range";
import type {
  AccountabilityRoster,
  DepartmentSummary,
  RosterEmployee,
} from "@/lib/data/accountability-roster";
import type {
  AccountabilityCase,
  CaseSeverity,
} from "@/lib/data/accountability-cases";

const PAGE_SIZE = 12;
type TeamSortKey = "onTime" | "overdue" | "trend" | "name";

// Per-value hover explanations. الحالة = strength of the evidence (severity).
const SEVERITY_HINT: Record<CaseSeverity, string> = {
  critical: "حرجة — المصدران مترابطان: نفس المهمة/القضية تظهر في التنفيذ وشكوى العميل معًا. أخطر مستوى.",
  proven: "مثبتة — مصدران متفقان (مثلاً تأخير في التنفيذ + شكوى عميل يشيران للمشكلة نفسها).",
  signal: "إشارة — مصدر واحد فقط يرصد المشكلة (غير مؤكَّدة بعد). أضعف مستوى.",
};
const SEVERITY_CLEAN_HINT = "سليم — لا توجد قضية مفتوحة على هذا الموظف.";

// The tasks behind a team-table number (على مكتبه / معلّقة متأخرة live, إجمالي
// المراحل / مراحل متأخرة period) — reuses the same drill-down sheet as the
// reviewer/edits sections so the figure can be reconciled against Rwasem.
function metricDrillView(
  metric: EmployeeMetric,
  name: string,
  tasks: DrillTask[],
): Omit<DrillView, "loading" | "error"> {
  switch (metric) {
    case "open":
      return { title: `المهام على المكتب — ${name}`, subtitle: "المهام المفتوحة التي يملك الموظف مرحلتها الحالية — نفس قائمة نبض الفريق (لايف)", valueKind: "flag", flagLabel: "تجاوزت SLA", tasks };
    case "overdue":
      return { title: `المهام المعلّقة المتأخرة — ${name}`, subtitle: "المهام على مكتبه التي تجاوزت مهلة المرحلة الحالية (SLA) — نفس قائمة نبض الفريق (لايف)", valueKind: "none", tasks };
    case "totalStages":
      return { title: `إجمالي المراحل — ${name}`, subtitle: "المراحل التي كان مسؤولاً عنها في الفترة ولها مهلة SLA — كل مرحلة على حدة", valueKind: "minutes", flagLabel: "تجاوزت المهلة", tasks };
    case "lateStages":
      return { title: `مراحل متأخرة — ${name}`, subtitle: "مراحل تجاوز فيها مهلة المرحلة (SLA) وهو مسؤول عنها — لا علاقة لها بموعد تسليم المهمة", valueKind: "minutes", tasks };
  }
}

export function TeamWorkspace({
  roster,
  cases,
  problemMeta,
  reviewers,
  clientEdits,
  reviewerRange,
}: {
  roster: AccountabilityRoster;
  cases: AccountabilityCase[];
  problemMeta: Record<string, PersistedProblemMeta>;
  reviewers: AccountabilityOverview["reviewers"];
  clientEdits: ClientEditsRow[];
  reviewerRange: DashboardRange;
}) {
  const [dept, setDept] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TeamSortKey>("onTime");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  // Number drill-down (على مكتبه / معلّقة متأخرة / إجمالي المراحل / مراحل متأخرة → the tasks).
  const [metricDrill, setMetricDrill] = useState<{
    employeeId: string;
    employeeName: string;
    metric: EmployeeMetric;
  } | null>(null);
  const [drillTasks, setDrillTasks] = useState<DrillTask[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillAttempt, setDrillAttempt] = useState(0);

  useEffect(() => {
    if (!metricDrill) return;
    let active = true;
    setDrillLoading(true);
    setDrillError(null);
    getEmployeeMetricDrillAction(metricDrill.employeeId, metricDrill.metric, reviewerRange.from, reviewerRange.to)
      .then((res) => {
        if (!active) return;
        if (res.ok) setDrillTasks(res.tasks);
        else {
          setDrillTasks([]);
          setDrillError(res.error);
        }
        setDrillLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setDrillTasks([]);
        setDrillError("failed");
        setDrillLoading(false);
      });
    return () => {
      active = false;
    };
  }, [metricDrill?.employeeId, metricDrill?.metric, reviewerRange.from, reviewerRange.to, drillAttempt]);

  const drillView: DrillView | null = metricDrill
    ? { ...metricDrillView(metricDrill.metric, metricDrill.employeeName, drillTasks), loading: drillLoading, error: drillError }
    : null;
  const openMetricDrill = (e: RosterEmployee, metric: EmployeeMetric) =>
    setMetricDrill({ employeeId: e.id, employeeName: e.name, metric });

  const caseByEmp = useMemo(() => {
    const m = new Map<string, AccountabilityCase>();
    for (const c of cases) if (c.employeeId) m.set(c.employeeId, c);
    return m;
  }, [cases]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = roster.employees.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (q && !e.name.toLowerCase().includes(q) && !(e.role ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
    return [...matches].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "ar");
      if (sortKey === "overdue") return b.overdueOwned - a.overdueOwned;
      if (sortKey === "trend") {
        return (a.periodTrend.difference ?? 999) - (b.periodTrend.difference ?? 999);
      }
      return (a.periodTrend.currentRate ?? 999) - (b.periodTrend.currentRate ?? 999);
    });
  }, [roster.employees, dept, query, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount - 1);
  const rows = filtered.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  const totals = useMemo(() => {
    const withCases = roster.employees.filter((e) => e.hasCase).length;
    const critical = roster.employees.filter((e) => e.severity === "critical").length;
    return { total: roster.employees.length, withCases, critical, depts: roster.departments.length };
  }, [roster]);

  // Team median of period-scoped actions, so the modal's "vs الفريق" delta
  // compares like with like. The ledger's own peerMedianActions is a fixed
  // 30-day figure — pairing it with a 7-day count would invent a shortfall.
  const peerMedianActionsPeriod = useMemo(() => {
    const vals = roster.employees
      .map((e) => e.silence.actionsInPeriod)
      .sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid]! : Math.round((vals[mid - 1]! + vals[mid]!) / 2);
  }, [roster.employees]);

  const openEmp = openId ? roster.employees.find((e) => e.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      <AccountabilityRangePicker range={reviewerRange} />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard icon={Building2} tone="text-foreground" value={totals.depts} label="أقسام" />
        <SummaryCard icon={Users} tone="text-foreground" value={totals.total} label="موظفون" />
        <SummaryCard icon={Users} tone="text-amber" value={totals.withCases} label="لديهم قضايا" />
        <SummaryCard icon={Users} tone="text-cc-red" value={totals.critical} label="قضايا حرجة" />
      </div>

      {/* Department grid */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          الأقسام
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {roster.departments.map((d) => (
            <DepartmentCard
              key={d.name}
              d={d}
              active={dept === d.name}
              onClick={() => {
                setDept((cur) => (cur === d.name ? null : d.name));
                setPage(0);
              }}
            />
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="ابحث بالاسم أو الدور…"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 pe-9 text-sm outline-none transition-colors focus:border-cyan/40"
          />
        </div>
        {(dept || query) && (
          <button
            type="button"
            onClick={() => {
              setDept(null);
              setQuery("");
              setPage(0);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-soft-1"
          >
            <X className="size-3.5" />
            مسح
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">الترتيب</span>
        {([
          ["onTime", "الالتزام"],
          ["overdue", "الأكثر تأخّرًا"],
          ["trend", "الأكثر تراجعًا"],
          ["name", "الاسم"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setSortKey(key);
              setPage(0);
            }}
            aria-pressed={sortKey === key}
            className={cn(
              "rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-medium transition-colors",
              sortKey === key
                ? "border-cyan/40 bg-cyan-dim text-cyan"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Employees table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="لا يوجد موظفون بهذا الفلتر"
          description="غيّر القسم أو نص البحث."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">الموظف</th>
                  <th className="px-3 py-2 text-start font-medium">القسم</th>
                  <th className="px-3 py-2 text-center font-medium" title="المهام المفتوحة التي يملك مرحلتها الحالية — نفس معلّقة في نبض الفريق (لايف)">
                    على مكتبه
                  </th>
                  <th className="px-3 py-2 text-center font-medium" title="المهام على مكتبه التي تجاوزت SLA المرحلة الحالية — نفس متأخر في نبض الفريق (لايف)">
                    معلّقة متأخرة
                  </th>
                  <th className="px-3 py-2 text-center font-medium" title="عدد المراحل ذات المهلة (SLA) التي كان مسؤولاً عنها خلال الفترة — تُحتسب لكل مرحلة على حدة">
                    إجمالي المراحل
                  </th>
                  <th className="px-3 py-2 text-center font-medium" title="المراحل التي تجاوز فيها مهلة المرحلة نفسها (SLA) — وليس موعد تسليم المهمة">
                    مراحل متأخرة
                  </th>
                  <th className="px-3 py-2 text-center font-medium">الالتزام</th>
                  <th className="px-3 py-2 text-center font-medium">مقارنة بالفترة السابقة</th>
                  <th
                    className="px-3 py-2 text-center font-medium"
                    title="قوة الدليل على القضية: سليم = لا قضية · إشارة = مصدر واحد · مثبتة = مصدران متفقان · حرجة = المصدران مترابطان"
                  >
                    الحالة
                  </th>
                  <th
                    className="px-3 py-2 text-center font-medium"
                    title="موضع القضية في المراجعة: جديدة · قيد المراجعة · مبرَّرة · أُنذِر · انتهت"
                  >
                    الوضع
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <EmployeeRow
                    key={e.id}
                    e={e}
                    rollup={rollupProblems(caseByEmp.get(e.id)?.proof ?? [], problemMeta)}
                    onOpen={() => setOpenId(e.id)}
                    onDrill={(metric) => openMetricDrill(e, metric)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              {clamped * PAGE_SIZE + 1}–{Math.min((clamped + 1) * PAGE_SIZE, filtered.length)} من{" "}
              {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={clamped === 0}
                onClick={() => setPage(clamped - 1)}
                className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-soft-1 disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
              <span className="px-2 text-[11px] tabular-nums text-muted-foreground">
                {clamped + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={clamped >= pageCount - 1}
                onClick={() => setPage(clamped + 1)}
                className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-soft-1 disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
          </div>
        </Card>
      )}

      <ReviewerRigorSection
        reviewers={reviewers}
        range={reviewerRange}
        onSelect={setOpenId}
        showRangePicker={false}
      />

      <ClientEditsSection rows={clientEdits} range={reviewerRange} onSelect={setOpenId} />

      {openEmp && (
        <EmployeeModal
          key={openEmp.id}
          e={openEmp}
          kase={caseByEmp.get(openEmp.id) ?? null}
          problemMeta={problemMeta}
          range={reviewerRange}
          peerMedianActionsPeriod={peerMedianActionsPeriod}
          onClose={() => setOpenId(null)}
        />
      )}

      {drillView && (
        <TaskDrillSheet
          view={drillView}
          onClose={() => setMetricDrill(null)}
          onRetry={() => setDrillAttempt((a) => a + 1)}
        />
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: typeof Users;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <Icon className={cn("size-4", tone)} />
        <p className={cn("mt-2 text-2xl font-bold tabular-nums", tone)} dir="ltr">
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function DepartmentCard({
  d,
  active,
  onClick,
}: {
  d: DepartmentSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-3 text-start transition-colors",
        active ? "border-cyan/40 bg-cyan-dim" : "border-border bg-card hover:bg-soft-1",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <Building2 className={cn("size-4", active ? "text-cyan" : "text-muted-foreground")} />
        {d.critical > 0 && (
          <span className="rounded-full bg-cc-red/15 px-1.5 text-[10px] font-bold text-cc-red">
            {d.critical} حرجة
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-[13px] font-semibold" title={d.name}>
        {d.name}
      </p>
      <p className="text-[11px] text-muted-foreground">
        <span className="tabular-nums text-foreground/80">{d.total}</span> موظف ·{" "}
        <span className={cn("tabular-nums", d.withCases > 0 ? "text-amber" : "text-cc-green")}>
          {d.withCases}
        </span>{" "}
        بقضايا
      </p>
    </button>
  );
}

function SeverityPill({ severity }: { severity: CaseSeverity | null }) {
  if (!severity) {
    return (
      <span
        title={SEVERITY_CLEAN_HINT}
        className="inline-flex items-center gap-1 rounded-md border border-cc-green/25 bg-green-dim px-1.5 py-0.5 text-[10px] font-semibold text-cc-green"
      >
        <ShieldCheck className="size-3" />
        سليم
      </span>
    );
  }
  const m = SEVERITY_META[severity];
  const Icon = m.icon;
  return (
    <span
      title={SEVERITY_HINT[severity]}
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold", m.badge)}
    >
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}

function EmployeeRow({
  e,
  rollup,
  onOpen,
  onDrill,
}: {
  e: RosterEmployee;
  rollup: ProblemRollup;
  onOpen: () => void;
  onDrill: (metric: EmployeeMetric) => void;
}) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-soft-1"
    >
      <td className="px-3 py-2.5">
        <p className="font-semibold text-foreground">{e.name}</p>
        <p className="text-[11px] text-muted-foreground">{e.role ?? "—"}</p>
      </td>
      <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{e.department}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
        <DrillNumber value={e.openTasks} onClick={() => onDrill("open")} />
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-center tabular-nums",
          e.overdueOwned > 0 ? "font-semibold text-cc-red" : "text-muted-foreground",
        )}
        dir="ltr"
      >
        <DrillNumber value={e.overdueOwned} onClick={() => onDrill("overdue")} />
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground" dir="ltr">
        <DrillNumber value={e.totalStages} onClick={() => onDrill("totalStages")} />
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-center tabular-nums",
          e.lateStages > 0 ? "font-semibold text-amber" : "text-muted-foreground",
        )}
        dir="ltr"
      >
        <DrillNumber value={e.lateStages} onClick={() => onDrill("lateStages")} />
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground" dir="ltr">
        {e.periodTrend.currentRate === null ? "—" : `${e.periodTrend.currentRate}%`}
      </td>
      <td className="px-3 py-2.5 text-center">
        <AccountabilityPeriodTrend trend={e.periodTrend} showRates />
      </td>
      <td className="px-3 py-2.5 text-center">
        <SeverityPill severity={e.severity} />
      </td>
      <td className="px-3 py-2.5 text-center">
        {e.hasCase && rollup.total > 0 ? (
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center justify-center gap-1"
            title="افتح الملف لاتّخاذ قرار على كل مشكلة على حدة"
          >
            <ProblemStatusRollup rollup={rollup} />
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">—</span>
        )}
      </td>
    </tr>
  );
}

// ---- Employee modal — all of one person's accountability data --------------
function EmployeeModal({
  e,
  kase,
  problemMeta,
  range,
  peerMedianActionsPeriod,
  onClose,
}: {
  e: RosterEmployee;
  kase: AccountabilityCase | null;
  problemMeta: Record<string, PersistedProblemMeta>;
  range: DashboardRange;
  peerMedianActionsPeriod: number;
  onClose: () => void;
}) {
  const [showAdvice, setShowAdvice] = useState(false);
  const rollup = kase ? rollupProblems(kase.proof, problemMeta) : null;
  // Period stage الأدلة (range window, archived-inclusive).
  const [evidence, setEvidence] = useState<AccountabilityEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceAttempt, setEvidenceAttempt] = useState(0);
  // Live stage الأدلة (default last-30-days, live tasks only) — the لايف tab.
  const [liveEvidence, setLiveEvidence] = useState<AccountabilityEvidence | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveAttempt, setLiveAttempt] = useState(0);
  // الدليل is split into two tabs: LIVE (current board) and الفترة المحددة
  // (range window). Both tabs also carry the case problems (تنفيذ/صوت العميل).
  const [evTab, setEvTab] = useState<"live" | "period">("live");

  useEffect(() => {
    let active = true;
    getAccountabilityEvidenceAction(e.id, range.from, range.to)
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          setEvidence(res.evidence);
        } else {
          setEvidence(null);
          setEvidenceError(res.error);
        }
        setEvidenceLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setEvidence(null);
        setEvidenceError("failed");
        setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [e.id, range.from, range.to, evidenceAttempt]);

  useEffect(() => {
    let active = true;
    // No range → the loader's default last-30-days live window.
    getAccountabilityEvidenceAction(e.id)
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          setLiveEvidence(res.evidence);
        } else {
          setLiveEvidence(null);
          setLiveError(res.error);
        }
        setLiveLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLiveEvidence(null);
        setLiveError("failed");
        setLiveLoading(false);
      });
    return () => {
      active = false;
    };
  }, [e.id, liveAttempt]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{e.name}</h2>
              <SeverityPill severity={e.severity} />
              {/* Status + «عادت بعد إغلاقها» are per-problem now — this is the
                  roll-up; each problem carries its own decision + reopen badge in
                  the الدليل list below. */}
              {rollup && <ProblemStatusRollup rollup={rollup} />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {e.role ?? "—"} · {e.department}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-soft-1"
              aria-label="إغلاق"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {/* Scorecard metrics — always shown. Hover any card for how it's derived. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-center sm:grid-cols-3">
            <Metric
              label="المهام المفتوحة (لايف)"
              value={e.generalOpenTasks}
              explain="كل المهام المفتوحة التي تقع مرحلتها الحالية تحت مسؤولية الموظف، بغضّ النظر عن مهلة المرحلة (SLA)."
            />
            <Metric
              label="المهام المتأخرة (لايف)"
              value={e.generalOverdueTasks}
              tone={e.generalOverdueTasks > 0 ? "text-cc-red" : undefined}
              explain={`من مهامه المفتوحة (${e.generalOpenTasks})، التي تجاوزت موعد التسليم المخطط. هذا الرقم عام ولا يعتمد على SLA المرحلة.`}
            />
            <Metric
              label="الالتزام في الفترة"
              value={e.periodTrend.currentRate === null ? "—" : `${e.periodTrend.currentRate}%`}
              explain={
                e.periodTrend.currentSampleSize > 0
                  ? `مراحل الـSLA المُنجزة داخل حدّها ÷ المراحل القابلة للقياس خلال الفترة = ${e.periodTrend.currentWithinSla}/${e.periodTrend.currentSampleSize}.`
                  : "لا توجد مراحل قابلة لقياس الـSLA في هذه الفترة."
              }
            />
            <Metric
              label="إجمالي المراحل"
              value={e.totalStages}
              explain="عدد المراحل التي كان مسؤولاً عنها (حسب مالك المرحلة في القالب) ودخلها خلال الفترة ولها مهلة SLA مُعرّفة — كل مرحلة تُحتسب على حدة، وتشمل المهام المؤرشفة التي وصلت «تم». المراحل بلا مهلة (جديد / قيد التنفيذ) لا يمكن الحكم عليها فلا تدخل هنا ولا في الالتزام."
            />
            <Metric
              label="مراحل متأخرة"
              value={e.lateStages}
              tone={e.lateStages > 0 ? "text-amber" : undefined}
              explain={`من إجمالي ${e.totalStages} مرحلة في الفترة، التي تجاوز فيها مهلة المرحلة نفسها (SLA بدقائق العمل) وهو مسؤول عنها${
                e.totalStages > 0 ? ` (${Math.round((e.lateStages / e.totalStages) * 100)}%)` : ""
              }. هذا قياس تاريخي داخل الفترة، أما «معلّقة متأخرة» في الشريط أدناه فتقيس وضع مكتبه الحالي لايف.`}
            />
            <ExplainBlock
              className="bg-card px-2 py-2.5"
              text={
                e.periodTrend.difference === null
                  ? "لا توجد عينة قابلة للمقارنة في الفترتين."
                  : `التزام الفترة الحالية ${e.periodTrend.currentRate}% (${e.periodTrend.currentSampleSize} حدث) مقابل ${e.periodTrend.previousRate}% (${e.periodTrend.previousSampleSize} حدث) في الفترة السابقة — فرق ${e.periodTrend.difference} نقطة.`
              }
            >
              <AccountabilityPeriodTrend trend={e.periodTrend} prominent />
              <p className="mt-0.5 text-[10px] text-muted-foreground">مقارنة بالفترة السابقة</p>
            </ExplainBlock>
          </div>

          {/* Case summary — streams/tags, ledger, advice, decision (always live) */}
          {kase && (
            <>
              {/* Streams + tags */}
              <div className="flex flex-wrap items-center gap-1.5">
                {kase.streams.map((st) => {
                  const m = STREAM_META[st];
                  const SIcon = m.icon;
                  return (
                    <span key={st} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", m.tone)}>
                      <SIcon className="size-3" />
                      {m.label}
                    </span>
                  );
                })}
                <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
                {kase.problemTags.map((tag) => (
                  <span key={tag} className="rounded-md bg-soft-1 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Ledger + activity heatmap. Silence, heatmap and the action
                  count all follow the selected period via the roster. */}
              {kase.ledger && (
                <LedgerStrip
                  led={kase.ledger}
                  silence={e.silence}
                  peerMedianActionsPeriod={peerMedianActionsPeriod}
                />
              )}

              {/* Advice (opt-in) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvice((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/25 bg-cyan/5 px-2.5 py-1.5 text-[11px] font-semibold text-cyan transition-colors hover:bg-cyan/10"
                >
                  {showAdvice ? "إخفاء النصيحة" : "توليد نصيحة"}
                </button>
                {showAdvice && <AdvicePanel employeeId={e.id} />}
              </div>
            </>
          )}

          {/* الدليل — two tabs: LIVE (current-state case proof: تنفيذ/صوت العميل)
              vs الفترة المحددة (stage evidence windowed to the range picker,
              archived-inclusive). */}
          <div className="space-y-2">
            <div className="inline-flex rounded-lg border border-border bg-soft-1/50 p-0.5 text-[11px] font-medium">
              {/* The two tabs are different WINDOWS, not nested sets — لايف is a
                  fixed last-30-days view of live tasks, so a 7-day الفترة
                  المحددة legitimately shows fewer rows. The labels say the
                  window out loud, otherwise it reads as missing evidence. */}
              {([
                ["live", "لايف · آخر ٣٠ يومًا", "المهام الحيّة فقط خلال آخر ٣٠ يومًا — نافذة ثابتة لا تتأثّر بالفلتر أعلى الصفحة."],
                [
                  "period",
                  `الفترة المحددة · ${daySpan(range.from, range.to)}ي`,
                  "كل مرحلة كان مسؤولاً عنها خلال الفترة المحددة، بما فيها المهام المؤرشفة التي سُلِّمت. نافذة أقصر من «لايف» تعني عددًا أقل من الأدلة — هذا متوقَّع.",
                ],
              ] as const).map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  title={hint}
                  onClick={() => setEvTab(key)}
                  aria-pressed={evTab === key}
                  className={cn(
                    "rounded-md px-3 py-1 transition-colors",
                    evTab === key
                      ? "bg-cyan-dim text-cyan"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* The problems (تنفيذ / صوت العميل) — the escalation itself. Shown in
                BOTH tabs so «الفترة المحددة» is the problems PLUS the windowed
                stage evidence, not a bare list. */}
            {kase ? (
              <CaseEvidence c={kase} cap={99} problemMeta={problemMeta} />
            ) : (
              <div className="rounded-xl border border-cc-green/20 bg-green-dim/40 p-4 text-center">
                <ShieldCheck className="mx-auto size-6 text-cc-green" />
                <p className="mt-2 text-sm font-semibold text-cc-green">لا توجد قضايا مساءلة حالية</p>
                <p className="text-[11px] text-muted-foreground">
                  لا مهام على مكتبه تجاوزت SLA مرحلتها، ولا شكاوى منسوبة إليه، ولا صمت تشغيلي مرصود.
                </p>
              </div>
            )}

            {/* Stage-level الأدلة: LIVE (current board / last 30d) vs الفترة
                المحددة (range window, archived-inclusive). */}
            {evTab === "period" && (
              <EmployeeEvidence
                evidence={evidence}
                loading={evidenceLoading}
                error={evidenceError}
                onRetry={() => {
                  setEvidenceLoading(true);
                  setEvidenceError(null);
                  setEvidenceAttempt((attempt) => attempt + 1);
                }}
              />
            )}
            {evTab === "live" && (
              <EmployeeEvidence
                evidence={liveEvidence}
                loading={liveLoading}
                error={liveError}
                onRetry={() => {
                  setLiveLoading(true);
                  setLiveError(null);
                  setLiveAttempt((attempt) => attempt + 1);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  explain,
}: {
  label: string;
  value: string | number;
  tone?: string;
  explain?: ReactNode;
}) {
  return (
    <ExplainBlock text={explain} className="bg-card px-2 py-2.5">
      <p className={cn("text-base font-bold tabular-nums", tone ?? "text-foreground")} dir="ltr">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </ExplainBlock>
  );
}
