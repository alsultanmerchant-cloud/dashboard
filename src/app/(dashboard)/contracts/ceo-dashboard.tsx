"use client";

// CEO Monthly Dashboard UI — mirrors the Skylight sheet's CEO_Dashboard tab.
// Top: Month selector + frozen/live badge. Then the income box (Expected vs
// Actual + achievement bar), contracts movement, client-status overview, and
// the per-AM target breakdown table. Colors match the sheet's semantics.

import { useRouter } from "next/navigation";
import { Lock, Activity, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MonthlyDashboard, AmTargetRow } from "@/lib/data/contracts";

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function fmtMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${AR_MONTHS[(m ?? 1) - 1]} ${y}`;
}

function fmtSR(n: number): string {
  return (
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " SR"
  );
}

export function CeoDashboard({
  dashboard,
  amTargets,
  months,
  selectedMonth,
}: {
  dashboard: MonthlyDashboard;
  amTargets: AmTargetRow[];
  months: Array<{ month: string; is_frozen: boolean; source: string }>;
  selectedMonth: string;
}) {
  const router = useRouter();
  const d = dashboard;
  const achievement = Math.min(100, d.achievement_pct);

  return (
    <div className="space-y-4">
      {/* Month selector + status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-soft bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">الشهر:</span>
          <select
            value={selectedMonth}
            onChange={(e) =>
              router.push(`/contracts?view=dashboard&m=${e.target.value}`)
            }
            className="h-9 rounded-lg border border-input bg-input px-3 text-sm"
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {fmtMonth(m.month)}
              </option>
            ))}
            {!months.some((m) => m.month === selectedMonth) && (
              <option value={selectedMonth}>{fmtMonth(selectedMonth)}</option>
            )}
          </select>
        </div>
        {d.is_frozen ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-3 py-1 text-[11px] font-medium text-zinc-300">
            <Lock className="size-3" />
            مُجمَّد {d.source === "sheet_import" ? "(من الشيت)" : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
            <Activity className="size-3" />
            مباشر — يُحدَّث تلقائيًا
          </span>
        )}
      </div>

      {/* Income box */}
      <div className="rounded-2xl border border-soft bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">
          💵 دخل الشركة (للشهر المحدد) — جديد + تجديد
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <BigStat
            label="التارجت المتوقع"
            value={fmtSR(d.total_expected)}
            tone="info"
          />
          <BigStat
            label="المُحقَّق الفعلي"
            value={fmtSR(d.total_actual)}
            tone="success"
          />
          <BigStat
            label="نسبة الإنجاز"
            value={`${d.achievement_pct.toFixed(1)}%`}
            tone={
              d.achievement_pct >= 80
                ? "success"
                : d.achievement_pct >= 40
                  ? "warning"
                  : "danger"
            }
          />
        </div>
        {/* Achievement bar */}
        <div className="mt-3">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-soft-1">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                d.achievement_pct >= 80
                  ? "bg-emerald-500"
                  : d.achievement_pct >= 40
                    ? "bg-amber-500"
                    : "bg-rose-500",
              )}
              style={{ width: `${achievement}%` }}
            />
          </div>
        </div>
        {/* Expected split */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
          <SplitRow
            label="تجديدات متوقعة"
            expected={d.expected_renewals}
            actual={d.actual_renewals}
          />
          <SplitRow
            label="دفعات متوقعة"
            expected={d.expected_installments}
            actual={d.actual_installments}
          />
        </div>
      </div>

      {/* Contracts movement */}
      <div className="rounded-2xl border border-soft bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">حركة العقود (هذا الشهر)</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <MoveStat label="جديد" value={d.mov_new} tone="bg-emerald-500/15 text-emerald-300" />
          <MoveStat label="تجديد" value={d.mov_renewed} tone="bg-sky-500/15 text-sky-300" />
          <MoveStat label="مفقود" value={d.mov_lost} tone="bg-rose-500/15 text-rose-300" />
          <MoveStat label="Upsell" value={d.mov_upsell} tone="bg-violet-500/15 text-violet-300" />
          <MoveStat label="Win-Back" value={d.mov_winback} tone="bg-orange-500/15 text-orange-300" />
          <MoveStat label="مُغلق" value={d.mov_closed} tone="bg-zinc-500/15 text-zinc-300" />
          <MoveStat label="Hold" value={d.mov_hold} tone="bg-amber-500/15 text-amber-300" />
        </div>
      </div>

      {/* Client status overview */}
      <div className="rounded-2xl border border-soft bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">نظرة عامة على حالة العملاء</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MoveStat label="إجمالي العملاء" value={d.cnt_total_clients} tone="bg-soft-2 text-foreground" />
          <MoveStat label="On Target" value={d.cnt_on_target} tone="bg-emerald-500/15 text-emerald-300" />
          <MoveStat label="Overdue" value={d.cnt_overdue} tone="bg-rose-500/15 text-rose-300" />
          <MoveStat label="Sales Deposit" value={d.cnt_sales_deposit} tone="bg-amber-500/15 text-amber-300" />
        </div>
      </div>

      {/* Per-AM target breakdown */}
      <div className="rounded-2xl border border-soft bg-card">
        <div className="flex items-center justify-between border-b border-soft px-4 py-3">
          <h3 className="text-sm font-semibold">تارجت الأكونت (هذا الشهر)</h3>
          {d.is_frozen && (
            <span
              className="text-[10px] text-amber-300/80"
              title="إجماليات الشهر مُجمّدة ومطابقة للشيت؛ تفصيل كل أكونت محسوب مباشرة وقد يختلف قليلًا"
            >
              تفصيل تقديري (محسوب مباشرة)
            </span>
          )}
        </div>
        {amTargets.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            لا يوجد تارجت محسوب لهذا الشهر.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-soft-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">الأكونت</th>
                  <th className="px-3 py-2 text-end font-medium">المتوقع</th>
                  <th className="px-3 py-2 text-end font-medium">المُحقَّق</th>
                  <th className="px-3 py-2 text-center font-medium">الإنجاز</th>
                  <th className="px-3 py-2 font-medium">التقدّم</th>
                </tr>
              </thead>
              <tbody>
                {amTargets.map((a) => (
                  <tr key={a.account_manager_id} className="border-t border-soft/60">
                    <td className="px-3 py-2 font-medium">
                      {a.account_manager_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                      {fmtSR(a.expected_total)}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {fmtSR(a.achieved_total)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium",
                          a.achievement_pct >= 80
                            ? "bg-emerald-500/15 text-emerald-300"
                            : a.achievement_pct >= 40
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-rose-500/15 text-rose-300",
                        )}
                      >
                        {a.achievement_pct >= 100 && <ArrowUpRight className="size-3" />}
                        {a.achievement_pct.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 w-[180px]">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-soft-1">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            a.achievement_pct >= 80
                              ? "bg-emerald-500"
                              : a.achievement_pct >= 40
                                ? "bg-amber-500"
                                : "bg-rose-500",
                          )}
                          style={{ width: `${Math.min(100, a.achievement_pct)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "info" | "success" | "warning" | "danger";
}) {
  const toneCls = {
    info: "border-sky-500/30 bg-sky-500/5",
    success: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    danger: "border-rose-500/30 bg-rose-500/5",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3", toneCls)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function SplitRow({
  label,
  expected,
  actual,
}: {
  label: string;
  expected: number;
  actual: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-soft bg-soft-1/40 px-3 py-1.5">
      <span>{label}</span>
      <span className="tabular-nums">
        <span className="text-foreground">{fmtSR(actual)}</span>
        <span className="mx-1 text-muted-foreground/60">/</span>
        <span>{fmtSR(expected)}</span>
      </span>
    </div>
  );
}

function MoveStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-soft bg-soft-1/40 p-2.5 text-center">
      <div
        className={cn(
          "mx-auto mb-1 flex h-9 w-full items-center justify-center rounded-lg text-lg font-bold tabular-nums",
          tone,
        )}
      >
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
