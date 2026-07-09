"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import {
  SEVERITY_META,
  STREAM_META,
  StatusControl,
  LedgerStrip,
  AdvicePanel,
  CaseEvidence,
} from "./cases-workspace";
import {
  CASE_STATUS_LABEL,
  type CaseStatus,
  type PersistedCaseMeta,
} from "@/lib/accountability/case-status";
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

const STATUS_TONE: Record<CaseStatus, string> = {
  open: "border-border bg-soft-1 text-muted-foreground",
  under_review: "border-cyan/25 bg-cyan/10 text-cyan",
  excused: "border-cc-green/25 bg-green-dim text-cc-green",
  warned: "border-amber/30 bg-amber-dim text-amber",
  resolved: "border-border bg-soft-1 text-muted-foreground/60",
};

export function TeamWorkspace({
  roster,
  cases,
  caseMeta,
}: {
  roster: AccountabilityRoster;
  cases: AccountabilityCase[];
  caseMeta: Record<string, PersistedCaseMeta>;
}) {
  const [dept, setDept] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const caseByEmp = useMemo(() => {
    const m = new Map<string, AccountabilityCase>();
    for (const c of cases) if (c.employeeId) m.set(c.employeeId, c);
    return m;
  }, [cases]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.employees.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (q && !e.name.toLowerCase().includes(q) && !(e.role ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [roster.employees, dept, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount - 1);
  const rows = filtered.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  const totals = useMemo(() => {
    const withCases = roster.employees.filter((e) => e.hasCase).length;
    const critical = roster.employees.filter((e) => e.severity === "critical").length;
    return { total: roster.employees.length, withCases, critical, depts: roster.departments.length };
  }, [roster]);

  const openEmp = openId ? roster.employees.find((e) => e.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
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
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">الموظف</th>
                  <th className="px-3 py-2 text-start font-medium">القسم</th>
                  <th className="px-3 py-2 text-center font-medium">مفتوحة</th>
                  <th className="px-3 py-2 text-center font-medium">متأخرة</th>
                  <th className="px-3 py-2 text-center font-medium">الالتزام</th>
                  <th className="px-3 py-2 text-center font-medium">الحالة</th>
                  <th className="px-3 py-2 text-center font-medium">الوضع</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <EmployeeRow
                    key={e.id}
                    e={e}
                    status={caseMeta[e.id]?.status ?? null}
                    onOpen={() => setOpenId(e.id)}
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

      {openEmp && (
        <EmployeeModal
          e={openEmp}
          kase={caseByEmp.get(openEmp.id) ?? null}
          meta={caseMeta[openEmp.id] ?? null}
          onClose={() => setOpenId(null)}
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
      <span className="inline-flex items-center gap-1 rounded-md border border-cc-green/25 bg-green-dim px-1.5 py-0.5 text-[10px] font-semibold text-cc-green">
        <ShieldCheck className="size-3" />
        سليم
      </span>
    );
  }
  const m = SEVERITY_META[severity];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold", m.badge)}>
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}

function EmployeeRow({
  e,
  status,
  onOpen,
}: {
  e: RosterEmployee;
  status: CaseStatus | null;
  onOpen: () => void;
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
        {e.openTasks}
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-center tabular-nums",
          e.overdueOwned > 0 ? "font-semibold text-cc-red" : "text-muted-foreground",
        )}
        dir="ltr"
      >
        {e.overdueOwned}
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground" dir="ltr">
        {e.onTimeRate === null ? "—" : `${e.onTimeRate}%`}
      </td>
      <td className="px-3 py-2.5 text-center">
        <SeverityPill severity={e.severity} />
      </td>
      <td className="px-3 py-2.5 text-center">
        {status && e.hasCase ? (
          <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", STATUS_TONE[status])}>
            {CASE_STATUS_LABEL[status]}
          </span>
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
  meta,
  onClose,
}: {
  e: RosterEmployee;
  kase: AccountabilityCase | null;
  meta: PersistedCaseMeta | null;
  onClose: () => void;
}) {
  const [showAdvice, setShowAdvice] = useState(false);

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
              {meta && meta.timesSeen > 1 && (
                <span className="rounded-md border border-amber/25 bg-amber-dim px-1.5 py-0.5 text-[10px] font-semibold text-amber">
                  تكرّرت {meta.timesSeen}×
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {e.role ?? "—"} · {e.department}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {kase && <StatusControl employeeId={e.id} meta={meta} />}
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
          {/* Scorecard metrics — always shown */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-center sm:grid-cols-4">
            <Metric label="مفتوحة" value={e.openTasks} />
            <Metric label="متأخرة" value={e.overdueOwned} tone={e.overdueOwned > 0 ? "text-cc-red" : undefined} />
            <Metric label="الالتزام" value={e.onTimeRate === null ? "—" : `${e.onTimeRate}%`} />
            <Metric label="الدرجة" value={e.score === null ? "—" : e.score} />
          </div>

          {kase ? (
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

              {/* Ledger + 14-day heatmap */}
              {kase.ledger && <LedgerStrip led={kase.ledger} />}

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

              {/* Manager decision note */}
              {meta?.decisionNote && (
                <p className="rounded-md border border-border bg-soft-1/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  قرار المدير{meta.decidedByName ? ` (${meta.decidedByName})` : ""}: {meta.decisionNote}
                </p>
              )}

              {/* Proof */}
              <CaseEvidence c={kase} cap={99} />
            </>
          ) : (
            <div className="rounded-xl border border-cc-green/20 bg-green-dim/40 p-4 text-center">
              <ShieldCheck className="mx-auto size-6 text-cc-green" />
              <p className="mt-2 text-sm font-semibold text-cc-green">لا توجد قضايا مساءلة حالية</p>
              <p className="text-[11px] text-muted-foreground">
                لا مهام متأخرة في مرحلته، ولا شكاوى منسوبة إليه، ولا صمت تشغيلي مرصود.
              </p>
            </div>
          )}

          {/* Deep link to the full stage-level evidence */}
          <Link
            href={`/accountability?emp=${e.id}&view=scorecard`}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-cyan hover:underline"
          >
            <ExternalLink className="size-3.5" />
            عرض السجل الكامل للمراحل والدرجات
          </Link>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-card px-2 py-2.5">
      <p className={cn("text-base font-bold tabular-nums", tone ?? "text-foreground")} dir="ltr">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
