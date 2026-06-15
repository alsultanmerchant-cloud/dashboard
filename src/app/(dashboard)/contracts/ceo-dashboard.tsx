"use client";

// CEO Monthly Dashboard UI — mirrors the Skylight sheet's CEO_Dashboard tab.
// Top: Month selector + frozen/live badge. Then the income box (Expected vs
// Actual + achievement bar), contracts movement, client-status overview, and
// the per-AM target breakdown table. Colors match the sheet's semantics.

import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  ArrowUpRight,
  Brain,
  Lock,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatMonthYear } from "@/lib/utils-format";
import type {
  MonthlyDashboard,
  ContractsRoster,
  AmTargetRow,
  MonthBuckets,
  BucketClient,
  CeoClientInsight,
} from "@/lib/data/contracts";

function fmtMonth(iso: string, locale: string): string {
  return formatMonthYear(iso, locale);
}

function fmtSR(n: number): string {
  return (
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " SR"
  );
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Number(n).toFixed(0)}%`;
}

export function CeoDashboard({
  dashboard,
  roster,
  amTargets,
  buckets,
  clientInsights,
  months,
  selectedMonth,
}: {
  dashboard: MonthlyDashboard;
  roster: ContractsRoster;
  amTargets: AmTargetRow[];
  buckets: MonthBuckets;
  clientInsights: CeoClientInsight[];
  months: Array<{ month: string; is_frozen: boolean; source: string }>;
  selectedMonth: string;
}) {
  const t = useTranslations("ContractsPage");
  const locale = useLocale();
  const copy = (ar: string, en: string) => (locale.startsWith("ar") ? ar : en);
  const router = useRouter();
  const d = dashboard;
  const achievement = Math.min(100, d.achievement_pct);
  const revenueGap = Math.max(0, d.total_expected - d.total_actual);

  return (
    <div className="space-y-4 pb-8">
      {/* Current client roster — live, NOT tied to the selected month */}
      <CurrentRosterBoard roster={roster} copy={copy} />

      {/* Month selector + status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-3 shadow-[var(--surface-elev)]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {copy("الشهر:", "Month:")}
          </span>
          <select
            value={selectedMonth}
            onChange={(e) =>
              router.push(`/contracts?view=dashboard&m=${e.target.value}`)
            }
            className="h-9 rounded-[var(--radius-md)] border border-input bg-input px-3 text-sm font-medium"
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {fmtMonth(m.month, locale)}
              </option>
            ))}
            {!months.some((m) => m.month === selectedMonth) && (
              <option value={selectedMonth}>{fmtMonth(selectedMonth, locale)}</option>
            )}
          </select>
        </div>
        {d.is_frozen ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-3 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
            <Lock className="size-3" />
            {d.source === "sheet_import"
              ? copy("مجمد من الشيت", "Frozen from sheet")
              : copy("مجمد", "Frozen")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
            <Activity className="size-3" />
            {copy("مباشر - يحدث تلقائيا", "Live - updates automatically")}
          </span>
        )}
      </div>

      <ModernSheetBoard
        dashboard={d}
        buckets={buckets}
        clients={clientInsights}
        monthLabel={fmtMonth(selectedMonth, locale)}
        revenueGap={revenueGap}
        achievement={achievement}
        copy={copy}
      />

      {/* Per-AM target breakdown */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <h3 className="text-sm font-semibold">
            {copy("تارجت الأكونت هذا الشهر", "Account manager targets this month")}
          </h3>
        </div>
        {amTargets.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {copy("لا يوجد تارجت محسوب لهذا الشهر.", "No targets calculated for this month.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-soft-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{copy("الأكونت", "Account")}</th>
                  <th className="px-3 py-2 text-end font-medium">{copy("المتوقع", "Expected")}</th>
                  <th className="px-3 py-2 text-end font-medium">{copy("المحقق", "Actual")}</th>
                  <th className="px-3 py-2 text-center font-medium">{copy("الإنجاز", "Achievement")}</th>
                  <th className="px-3 py-2 font-medium">{copy("التقدم", "Progress")}</th>
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
                          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                          a.achievement_pct >= 80
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                            : a.achievement_pct >= 40
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-200"
                              : "bg-rose-500/15 text-rose-700 dark:text-rose-200",
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

      {/* Per-client target breakdown (Acc_Target_Breakdown) */}
      {d.is_frozen && (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-200">
          {copy(
            "تفصيل العملاء أدناه محسوب مباشرة من الحالة الحالية وقد يختلف قليلا عن الشهر المجمد.",
            "The client drill-down below is live and can differ slightly from frozen month totals.",
          )}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <BucketCard
          title={copy("On Target - ضمن الهدف", "On Target")}
          accent="emerald"
          clients={buckets.on_target}
        />
        <BucketCard title={copy("Overdue - متأخرة", "Overdue - delayed")} accent="rose" clients={buckets.overdue} />
        <BucketCard
          title={copy("جددت من التارجت", "Renewed from target")}
          accent="sky"
          clients={buckets.renewed}
          hideValue
        />
        <BucketCard
          title={copy("فقدت من التارجت", "Lost from target")}
          accent="zinc"
          clients={buckets.lost}
          hideValue
        />
      </div>

      {/* Installments due this month */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <h3 className="text-sm font-semibold">
            {copy("الدفعات المستحقة هذا الشهر", "Installments due this month")}
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {copy(`${buckets.installments_due.length} دفعة`, `${buckets.installments_due.length} installments`)}
          </span>
        </div>
        {buckets.installments_due.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {copy("لا توجد دفعات مستحقة هذا الشهر.", "No installments due this month.")}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-right text-[12px]">
              <thead className="sticky top-0 bg-soft-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{copy("العميل", "Client")}</th>
                  <th className="px-3 py-2 text-start font-medium">{copy("مدير الحساب", "Account manager")}</th>
                  <th className="px-3 py-2 text-end font-medium">{copy("المبلغ", "Amount")}</th>
                  <th className="px-3 py-2 font-medium">{copy("الحالة", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {buckets.installments_due.map((i, idx) => (
                  <tr key={`${i.contract_id}-${idx}`} className="border-t border-soft/60">
                    <td className="px-3 py-1.5">
                      {i.contract_id ? (
                        <Link href={`/contracts/${i.contract_id}`} className="hover:underline">
                          {i.client_name ?? "—"}
                        </Link>
                      ) : (
                        i.client_name ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {i.account_manager_name ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-end tabular-nums">
                      {fmtSR(i.expected_amount)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          i.status === "received"
                            ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-200"
                            : i.status === "overdue"
                              ? "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-200"
                              : "bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-200",
                        )}
                      >
                        {t(`installments.status.${i.status}` as const)}
                      </span>
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

function ModernSheetBoard({
  dashboard,
  buckets,
  clients,
  monthLabel,
  revenueGap,
  achievement,
  copy,
}: {
  dashboard: MonthlyDashboard;
  buckets: MonthBuckets;
  clients: CeoClientInsight[];
  monthLabel: string;
  revenueGap: number;
  achievement: number;
  copy: (ar: string, en: string) => string;
}) {
  // Funnel counts mirror the sheet's "Account M. section" target overview, which
  // counts renewed/lost FROM TARGET this month (the bucket lists), not the
  // global Contracts-Movement tallies. Each "removing …" figure is independent
  // off the expected base (not chained), matching the sheet.
  const renewedFromTarget = buckets.renewed.length;
  const lostFromTarget = buckets.lost.length;
  const expectedTargetClients = dashboard.cnt_on_target + dashboard.cnt_overdue;
  const expectedAfterRenewed = Math.max(
    0,
    expectedTargetClients - renewedFromTarget,
  );
  const expectedAfterLost = Math.max(0, expectedTargetClients - lostFromTarget);
  const riskClients = clients.filter((c) => c.health_label === "risk");
  const watchClients = clients.filter((c) => c.health_label === "watch");
  const topClient = clients[0] ?? null;
  const avgHealth = clients.length
    ? clients.reduce((sum, client) => sum + client.health_score, 0) / clients.length
    : null;
  const revenueChart = [
    {
      name: copy("تجديد", "Renewals"),
      expected: dashboard.expected_renewals,
      actual: dashboard.actual_renewals,
    },
    {
      name: copy("دفعات", "Installments"),
      expected: dashboard.expected_installments,
      actual: dashboard.actual_installments,
    },
  ];
  const movementChart = [
    { name: copy("جديد", "New"), value: dashboard.mov_new },
    { name: copy("تجديد", "Renew"), value: dashboard.mov_renewed },
    { name: copy("مفقود", "Lost"), value: dashboard.mov_lost },
    { name: "Upsell", value: dashboard.mov_upsell },
    { name: "WinBack", value: dashboard.mov_winback },
    { name: "Hold", value: dashboard.mov_hold },
  ];

  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-5 shadow-[var(--surface-elev)]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {copy("لوحة الرئيس الشهرية", "CEO Monthly Dashboard")}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-black tracking-tight">
            {copy("ملخص الإيراد والعملاء", "Revenue and Client Control Board")} · {monthLabel}
          </h2>
          {/* current-roster strip moved above the month filter (CurrentRosterBoard) */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan/25 bg-cyan-dim px-3 py-1 text-[11px] font-semibold text-cyan">
            <Brain className="size-3.5" />
            {copy("مدعوم بتجربة العميل والتحصيل", "client experience and collections connected")}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1.35fr_0.95fr]">
        <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-4 shadow-[var(--surface-elev)]">
          <SectionBand title={copy("ملخص الشهر", "Monthly Snapshot")} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <SheetCell label={copy("New", "New")} value={dashboard.mov_new} tone="green" compact />
            <SheetCell label={copy("مُجدَّد", "Renewed")} value={dashboard.mov_renewed} tone="blue" compact />
            <SheetCell label={copy("Lost", "Lost")} value={dashboard.mov_lost} tone="red" compact />
            <SheetCell label={copy("ترقية", "Upsell")} value={dashboard.mov_upsell} tone="magenta" compact />
            <SheetCell label={copy("استرجاع", "Win-Back")} value={dashboard.mov_winback} tone="orange" compact />
            <SheetCell label={copy("Closed", "Closed")} value={dashboard.mov_closed} tone="dark" compact />
          </div>

          <SectionBand
            title={copy(
              "دخل الشركة للشهر المحدد",
              "Company Income for selected month",
            )}
          />
          <div className="grid gap-2 md:grid-cols-4">
            <SheetCell
              label={copy("إجمالي الدخل المتوقع", "Total Expected income")}
              value={fmtSR(dashboard.total_expected)}
              tone="blue"
            />
            <SheetCell
              label={copy("إجمالي الدخل الفعلي", "Total Actual income")}
              value={fmtSR(dashboard.total_actual)}
              tone="greenStrong"
            />
            <SheetCell
              label={copy("إنجاز الشركة (الكلي)", "Company Achievement (total)")}
              value={`${dashboard.achievement_pct.toFixed(1)}%`}
              tone={dashboard.achievement_pct >= 70 ? "green" : "amber"}
            />
            <SheetCell
              label={copy("فجوة الإيراد", "Revenue Gap")}
              value={fmtSR(revenueGap)}
              tone={revenueGap > 0 ? "red" : "green"}
            />
          </div>
          <div className="px-1 py-3">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  dashboard.achievement_pct >= 70
                    ? "bg-cc-green"
                    : dashboard.achievement_pct >= 35
                      ? "bg-amber"
                      : "bg-cc-red",
                )}
                style={{ width: `${achievement}%` }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-4 shadow-[var(--surface-elev)]">
          <SectionBand title={copy("إشارات تنفيذية", "Executive Signals")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryStat
              label={copy("إنجاز الشركة (الكلي)", "Company achievement (total)")}
              value={`${dashboard.achievement_pct.toFixed(1)}%`}
              tone={dashboard.achievement_pct >= 70 ? "green" : dashboard.achievement_pct >= 35 ? "amber" : "red"}
            />
            <SummaryStat
              label={copy("فجوة الإيراد", "Revenue gap")}
              value={fmtSR(revenueGap)}
              tone={revenueGap > 0 ? "red" : "green"}
            />
            <SummaryStat
              label={copy("عملاء الخطر", "Risk clients")}
              value={riskClients.length}
              tone={riskClients.length > 0 ? "red" : "green"}
            />
            <SummaryStat
              label={copy("متوسط صحة العملاء", "Average health")}
              value={fmtPct(avgHealth)}
              tone={avgHealth != null && avgHealth >= 70 ? "green" : "amber"}
            />
          </div>
          <div className="mt-4 rounded-[var(--radius-md)] border border-soft bg-soft-1 p-3">
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-muted-foreground">
              <span>{copy("أعلى عميل", "Top client")}</span>
              <span className="tabular-nums">{fmtSR(topClient?.month_collected ?? 0)}</span>
            </div>
            <p className="mt-1 truncate text-sm font-bold">
              {topClient?.client_name ?? "—"}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <span className="rounded-full border border-amber/30 bg-amber-dim px-2 py-1 font-semibold text-amber-700 dark:text-amber-200">
                {copy("مراقبة", "Watch")} · {watchClients.length}
              </span>
              <span className="rounded-full border border-cyan/25 bg-cyan-dim px-2 py-1 font-semibold text-cyan-700 dark:text-cyan">
                {copy("دفعات مستحقة", "Due")} · {buckets.installments_due.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <RenewalFunnelStrip
        salesDeposit={dashboard.cnt_sales_deposit}
        onTarget={dashboard.cnt_on_target}
        overdue={dashboard.cnt_overdue}
        expected={expectedTargetClients}
        renewed={renewedFromTarget}
        targetExclRenewals={expectedAfterRenewed}
        targetExclLost={expectedAfterLost}
        copy={copy}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <DepartmentIncomeCard
          subtitle={copy("قسم الأكونت", "Account Department")}
          title={copy("التحصيل والتجديدات", "Renewals & Collections")}
          expected={dashboard.acc_expected}
          actual={dashboard.acc_actual}
          achievementPct={dashboard.acc_achievement_pct}
          gap={dashboard.acc_gap}
          expectedBreakdown={[
            {
              label: copy("عملاء ضمن الهدف", "On-Target clients"),
              value: dashboard.acc_exp_ontarget,
            },
            {
              label: copy("عملاء متأخرين", "Overdue clients"),
              value: dashboard.acc_exp_overdue_clients,
              tone: "amber",
            },
            {
              label: copy("أقساط الشهر", "Installments due"),
              value: dashboard.acc_exp_inst,
            },
            {
              label: copy("أقساط متأخرة", "Overdue installments"),
              value: dashboard.acc_exp_overdue_inst,
              tone: "amber",
            },
          ]}
          actualBreakdown={[
            {
              label: copy("التحصيل (أقساط + تجديدات)", "Collections (installments + renewals)"),
              value: Math.max(
                0,
                dashboard.acc_actual - dashboard.acc_upsell - dashboard.acc_winback,
              ),
            },
            {
              label: copy("ترقية - أكونت", "Upsell - Account"),
              value: dashboard.acc_upsell,
            },
            {
              label: copy("استرجاع", "Win-Back"),
              value: dashboard.acc_winback,
            },
          ]}
          copy={copy}
        />

        <DepartmentIncomeCard
          subtitle={copy("قسم المبيعات", "Sales Section")}
          title={copy("الأقساط ودخل العملاء الجدد", "Installments & New-client Income")}
          expected={dashboard.sales_expected}
          actual={dashboard.sales_total_income}
          achievementPct={
            dashboard.sales_expected > 0
              ? (dashboard.sales_total_income / dashboard.sales_expected) * 100
              : null
          }
          gap={dashboard.sales_gap}
          expectedBreakdown={[
            {
              label: copy("الأقساط المتوقعة", "Expected Installments"),
              value: dashboard.sales_exp_inst,
            },
            {
              label: copy("أقساط متأخرة", "Overdue Installments"),
              value: dashboard.sales_exp_overdue_inst,
              tone: "amber",
            },
          ]}
          actualBreakdown={[
            {
              label: copy("الأقساط الفعلية", "Actual Installments"),
              value: dashboard.sales_act_inst,
            },
            {
              label: copy("دخل العملاء الجدد", "New-client Income"),
              value: dashboard.sales_new_income,
            },
          ]}
          copy={copy}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-4 shadow-[var(--surface-elev)]">
          <h3 className="mb-3 text-sm font-semibold">
            {copy("المتوقع مقابل الفعلي", "Expected vs Actual")}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={42} />
              <Tooltip formatter={(value) => fmtSR(Number(value))} />
              <Bar dataKey="expected" name={copy("المتوقع", "Expected")} fill="var(--accent-amber)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name={copy("الفعلي", "Actual")} fill="var(--accent-green)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-4 shadow-[var(--surface-elev)]">
          <h3 className="mb-3 text-sm font-semibold">
            {copy("حركة العقود", "Contract Movement")}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={movementChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={30} />
              <Tooltip />
              <Bar dataKey="value" name={copy("العقود", "Contracts")} fill="var(--accent-cyan)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <TopClientsPanel clients={clients} copy={copy} />
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone: "green" | "amber" | "red";
}) {
  const toneCls = {
    green: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
    red: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  }[tone];

  return (
    <div className={cn("rounded-[var(--radius-md)] border p-3", toneCls)}>
      <div className="text-[11px] font-semibold leading-4 text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-black tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

// Live snapshot of the current client roster by contract type. NOT tied to the
// month picker — mirrors the sheet's general overview (who we serve right now).
// "Total" counts every contract not closed/lost; Hold is shown as its own pill
// (held contracts carry contract_type='Hold', so they're not re-attributed to
// their base type) and is already contained in the total — not added on top.
function CurrentRosterBoard({
  roster,
  copy,
}: {
  roster: ContractsRoster;
  copy: (ar: string, en: string) => string;
}) {
  const pills: Array<{
    label: string;
    value: number;
    tone: "green" | "blue" | "magenta" | "orange" | "amber";
  }> = [
    { label: copy("جديد", "New"), value: roster.cnt_new, tone: "green" },
    { label: copy("تجديد", "Renewal"), value: roster.cnt_renew, tone: "blue" },
    { label: copy("ترقية", "Upsell"), value: roster.cnt_upsell, tone: "magenta" },
    { label: copy("استرجاع", "Win-Back"), value: roster.cnt_winback, tone: "orange" },
    { label: copy("معلّق", "Hold"), value: roster.cnt_hold, tone: "amber" },
  ];
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-5 shadow-[var(--surface-elev)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("نظرة عامة", "Overview")}
          </p>
          <h2 className="mt-0.5 text-2xl font-black tracking-tight">
            {copy("الوضع الحالي للعملاء", "Current Client Status")}
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
          <Activity className="size-3" />
          {copy("نظرة عامة من الشيت", "Overview from the sheet")}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="rounded-[var(--radius-md)] border border-primary/25 bg-primary p-4 text-primary-foreground shadow-sm sm:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/75">
            {copy("إجمالي العملاء", "Total Clients")}
          </div>
          <div className="mt-2 text-4xl font-black tabular-nums leading-none">
            {roster.total}
          </div>
        </div>
        {pills.map((p) => (
          <SheetCell key={p.label} label={p.label} value={p.value} tone={p.tone} compact />
        ))}
      </div>
    </div>
  );
}

type BreakdownTone = "default" | "amber";

function DepartmentIncomeCard({
  subtitle,
  title,
  expected,
  actual,
  achievementPct,
  gap,
  expectedBreakdown,
  actualBreakdown,
  copy,
}: {
  subtitle: string;
  title: string;
  expected: number;
  actual: number;
  achievementPct: number | null;
  gap: number;
  expectedBreakdown: Array<{ label: string; value: number; tone?: BreakdownTone }>;
  actualBreakdown: Array<{ label: string; value: number; tone?: BreakdownTone }>;
  copy: (ar: string, en: string) => string;
}) {
  const pct = achievementPct ?? 0;
  const barPct = Math.max(0, Math.min(100, pct));
  const palette =
    pct >= 70
      ? { text: "text-emerald-600 dark:text-emerald-300", bar: "bg-cc-green" }
      : pct >= 35
        ? { text: "text-amber-600 dark:text-amber-300", bar: "bg-amber" }
        : { text: "text-rose-600 dark:text-rose-300", bar: "bg-cc-red" };
  const gapTone =
    gap > 0
      ? "text-rose-600 dark:text-rose-300"
      : "text-emerald-600 dark:text-emerald-300";

  return (
    <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-5 shadow-[var(--surface-elev)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {subtitle}
          </p>
          <h3 className="mt-0.5 truncate text-base font-black tracking-tight">
            {title}
          </h3>
        </div>
        <div className="shrink-0 text-end">
          <div
            className={cn(
              "text-4xl font-black tabular-nums leading-none",
              palette.text,
            )}
          >
            {fmtPct(achievementPct)}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("نسبة الإنجاز", "Achievement")}
          </div>
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-soft-1">
        <div
          className={cn("h-full rounded-full", palette.bar)}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-y border-border/60 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("المحقق", "Actual")}
          </div>
          <div className="mt-1 text-lg font-black tabular-nums text-foreground">
            {fmtSR(actual)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("المتوقع", "Expected")}
          </div>
          <div className="mt-1 text-lg font-black tabular-nums text-muted-foreground">
            {fmtSR(expected)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("الفجوة", "Gap")}
          </div>
          <div className={cn("mt-1 text-lg font-black tabular-nums", gapTone)}>
            {fmtSR(gap)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <BreakdownColumn
          dotCls="bg-muted-foreground/60"
          title={copy("مكونات المتوقع", "Expected from")}
          items={expectedBreakdown}
        />
        <BreakdownColumn
          dotCls="bg-cc-green"
          title={copy("مكونات المحقق", "Achieved from")}
          items={actualBreakdown}
        />
      </div>
    </div>
  );
}

function BreakdownColumn({
  dotCls,
  title,
  items,
}: {
  dotCls: string;
  title: string;
  items: Array<{ label: string; value: number; tone?: BreakdownTone }>;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", dotCls)} />
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.label}
            className={cn(
              "flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12px]",
              item.tone === "amber"
                ? "bg-amber-500/[0.06] text-amber-700 dark:text-amber-200"
                : "bg-soft-1/60",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {item.label}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">
              {fmtSR(item.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RenewalFunnelStrip({
  salesDeposit,
  onTarget,
  overdue,
  expected,
  renewed,
  targetExclRenewals,
  targetExclLost,
  copy,
}: {
  salesDeposit: number;
  onTarget: number;
  overdue: number;
  expected: number;
  renewed: number;
  targetExclRenewals: number;
  targetExclLost: number;
  copy: (ar: string, en: string) => string;
}) {
  const renewalGap = Math.max(0, expected - renewed);
  const ratioPct = expected > 0 ? (renewed / expected) * 100 : 0;
  const barPct = Math.max(0, Math.min(100, ratioPct));
  const palette =
    ratioPct >= 70
      ? { text: "text-emerald-600 dark:text-emerald-300", bar: "bg-cc-green" }
      : ratioPct >= 35
        ? { text: "text-amber-600 dark:text-amber-300", bar: "bg-amber" }
        : { text: "text-rose-600 dark:text-rose-300", bar: "bg-cc-red" };

  const stats: Array<{ label: string; value: number; tone?: "amber" | "rose" }> = [
    { label: copy("ضمن الهدف", "On Target"), value: onTarget },
    { label: copy("متأخر", "Overdue"), value: overdue, tone: "amber" },
    { label: copy("عربون مبيعات", "Sales Deposit"), value: salesDeposit },
    {
      label: copy("بعد التجديدات", "Excl. renewals"),
      value: targetExclRenewals,
    },
    { label: copy("بعد الفقد", "Excl. lost"), value: targetExclLost },
    {
      label: copy("فجوة التجديد", "Renewal Gap"),
      value: renewalGap,
      tone: renewalGap > 0 ? "rose" : undefined,
    },
  ];

  return (
    <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-5 shadow-[var(--surface-elev)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("قسم الأكونت", "Account Department")}
          </p>
          <h3 className="mt-0.5 text-base font-black tracking-tight">
            {copy("قمع التجديد للشهر", "Renewal Funnel · this month")}
          </h3>
        </div>
        <div className="text-end">
          <div className={cn("text-4xl font-black tabular-nums leading-none", palette.text)}>
            {renewed}
            <span className="text-base font-semibold text-muted-foreground">
              {" / "}
              {expected}
            </span>
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {copy("مجدّد / متوقع", "Renewed / Expected")}
          </div>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-soft-1">
        <div
          className={cn("h-full rounded-full", palette.bar)}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className={cn(
              "rounded-[var(--radius-md)] border border-border/60 bg-soft-1/40 px-3 py-2.5",
              s.tone === "amber" && "border-amber-500/30 bg-amber-500/[0.06]",
              s.tone === "rose" && "border-rose-500/30 bg-rose-500/[0.06]",
            )}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {s.label}
            </div>
            <div
              className={cn(
                "mt-1 text-xl font-black tabular-nums",
                s.tone === "amber" && "text-amber-700 dark:text-amber-200",
                s.tone === "rose" && "text-rose-700 dark:text-rose-200",
              )}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionBand({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-border/70 pb-2">
      <span className="size-2 rounded-full bg-cyan" />
      <h3 className="text-sm font-black tracking-tight">{title}</h3>
    </div>
  );
}

function SheetCell({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: ReactNode;
  tone: "green" | "greenStrong" | "blue" | "amber" | "orange" | "red" | "magenta" | "gray" | "dark";
  compact?: boolean;
}) {
  const toneCls = {
    green: "border-emerald-500/20 bg-card",
    greenStrong: "border-emerald-500/30 bg-emerald-500/10",
    blue: "border-sky-500/20 bg-card",
    amber: "border-amber-500/25 bg-amber-500/10",
    orange: "border-orange-500/20 bg-card",
    red: "border-rose-500/25 bg-rose-500/10",
    magenta: "border-pink/25 bg-card",
    gray: "border-border/80 bg-soft-1",
    dark: "border-zinc-500/25 bg-zinc-500/10",
  }[tone];
  const accentCls = {
    green: "bg-cc-green",
    greenStrong: "bg-cc-green",
    blue: "bg-cc-blue",
    amber: "bg-amber",
    orange: "bg-orange-500",
    red: "bg-cc-red",
    magenta: "bg-pink",
    gray: "bg-muted-foreground",
    dark: "bg-zinc-500",
  }[tone];
  return (
    <div
      className={cn(
        "relative min-h-[78px] overflow-hidden rounded-[var(--radius-md)] border p-3 shadow-sm",
        toneCls,
        compact && "min-h-[68px] p-2.5",
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-1", accentCls)} />
      <div className="text-[11px] font-semibold leading-4 text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-black tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function BucketCard({
  title,
  accent,
  clients,
  hideValue,
}: {
  title: string;
  accent: "emerald" | "rose" | "sky" | "zinc";
  clients: BucketClient[];
  hideValue?: boolean;
}) {
  const t = useTranslations("ContractsPage");
  const dot = {
    emerald: "bg-emerald-400",
    rose: "bg-rose-400",
    sky: "bg-sky-400",
    zinc: "bg-zinc-400",
  }[accent];
  const total = clients.reduce((s, c) => s + c.value, 0);
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2 rounded-full", dot)} />
          {title}
          <span className="font-normal text-muted-foreground">({clients.length})</span>
        </h3>
        {!hideValue && total > 0 && (
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {fmtSR(total)}
          </span>
        )}
      </div>
      {clients.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-muted-foreground">{t("dashboard.buckets.empty")}</p>
      ) : (
        <div className="max-h-60 overflow-y-auto divide-y divide-soft/50">
          {clients.map((c) => (
            <Link
              key={c.contract_id}
              href={`/contracts/${c.contract_id}`}
              className="flex items-center justify-between gap-2 px-4 py-2 text-[12px] hover:bg-soft-1"
            >
              <span className="min-w-0 truncate">
                {c.client_code && (
                  <span className="me-1.5 font-mono text-[10px] text-muted-foreground">
                    {c.client_code}
                  </span>
                )}
                {c.client_name ?? "—"}
              </span>
              {!hideValue && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmtSR(c.value)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TopClientsPanel({
  clients,
  copy,
}: {
  clients: CeoClientInsight[];
  copy: (ar: string, en: string) => string;
}) {
  const top = clients.slice(0, 8);
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">
            {copy("أهم العملاء: الإيراد وتجربة العميل", "Top clients: revenue and experience")}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {copy(
              "مرتبة حسب التحصيل، قيمة العقود، والمخاطر المفتوحة",
              "ranked by collected revenue, active value, and open exposure",
            )}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {copy(`${clients.length} عميل`, `${clients.length} clients`)}
        </span>
      </div>
      {top.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {copy(
            "لا توجد إيرادات عملاء متصلة لهذا الشهر.",
            "No connected client revenue yet for this month.",
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="bg-soft-1 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">
                  {copy("العميل", "Client")}
                </th>
                <th className="px-3 py-2 text-end font-medium">
                  {copy("المحصل", "Collected")}
                </th>
                <th className="px-3 py-2 text-end font-medium">
                  {copy("المتوقع", "Expected")}
                </th>
                <th className="px-3 py-2 text-center font-medium">
                  {copy("التجربة", "Experience")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {copy("إشارة الخطر", "Risk signal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((c) => (
                <tr key={c.client_id} className="border-t border-soft/70">
                  <td className="px-3 py-2">
                    <Link
                      href={`/clients?search=${encodeURIComponent(c.client_name ?? "")}`}
                      className="font-medium hover:underline"
                    >
                      {c.client_name ?? "—"}
                    </Link>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {c.client_code ?? "—"} · {c.account_manager_name ?? "—"} ·{" "}
                      {copy(`${c.active_contracts} عقد نشط`, `${c.active_contracts} active`)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{fmtSR(c.month_collected)}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                    {fmtSR(c.month_expected)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <HealthPill label={c.health_label} score={c.health_score} />
                  </td>
                  <td className="max-w-[280px] px-3 py-2 text-[12px] text-muted-foreground">
                    <span className="line-clamp-2">
                        {c.top_risk ||
                        c.satisfaction_summary ||
                        (c.overdue_installments > 0
                          ? copy(
                              `دفعات متأخرة بقيمة ${fmtSR(c.overdue_installments)}`,
                              `Overdue installments ${fmtSR(c.overdue_installments)}`,
                            )
                          : c.next_renewal_date
                            ? copy(
                                `التجديد القادم ${c.next_renewal_date}`,
                                `Next renewal ${c.next_renewal_date}`,
                              )
                            : copy("لا توجد إشارة رئيسية", "No major signal"))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HealthPill({
  label,
  score,
}: {
  label: CeoClientInsight["health_label"];
  score: number;
}) {
  const locale = useLocale();
  const cls = {
    healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    watch: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200",
    risk: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  }[label];
  const text = locale.startsWith("ar")
    ? {
        healthy: "صحي",
        watch: "مراقبة",
        risk: "خطر",
      }[label]
    : {
        healthy: "Healthy",
        watch: "Watch",
        risk: "Risk",
      }[label];
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>
      {text} · {fmtPct(score)}
    </span>
  );
}
