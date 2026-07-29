"use client";

// CEO Monthly Dashboard UI — mirrors the Skylight sheet's CEO_Dashboard tab.
// Top: Month selector + frozen/live badge. Then the income box (Expected vs
// Actual + achievement bar), contracts movement, client-status overview, and
// the per-AM target breakdown table. Colors match the sheet's semantics.

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  ArrowUpRight,
  Brain,
  Lock,
  Wallet,
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
import { GroupedAmTargetsTable } from "./GroupedAmTargetsTable";
import { Explained, MetricInfo } from "@/components/metric-info";
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
  const revenueGap = Math.max(0, d.total_expected - d.total_actual);
  // A frozen month whose per-client lists were never snapshotted falls back to a
  // LIVE recompute that has drifted (contracts renewed → end_date moved forward),
  // so those lists contradict the frozen tiles. Hide them and ask for a fresh
  // sheet pull rather than show numbers that look wrong. Current (live) months are
  // fine — their recompute IS the source of truth.
  const driftedLists = d.is_frozen && !buckets.from_snapshot;

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
        copy={copy}
      />

      {/* Team-leader & department-manager rollups (sheet TEAM_TARGET) */}
      <TeamTargetsCard amTargets={amTargets} copy={copy} />

      {/* Per-AM target breakdown */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <h3 className="text-sm font-semibold">
            {copy("تارجت الأكونت هذا الشهر", "Account manager targets this month")}
          </h3>
        </div>
        <GroupedAmTargetsTable amTargets={amTargets} copy={copy} t={t} MetricInfo={MetricInfo} fmtSR={fmtSR} />
        </div>

      {/* Per-client target breakdown (Acc_Target_Breakdown) */}
      {driftedLists ? (
        // Frozen month with no per-client snapshot: the live recompute has drifted
        // and would contradict the (correct) frozen tiles above. Hide the lists.
        <div className="rounded-[var(--radius-lg)] border border-amber-500/40 bg-amber-500/10 px-4 py-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {copy(
              "قوائم العملاء التفصيلية غير متاحة لهذا الشهر",
              "Per-client lists unavailable for this month",
            )}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-amber-700 dark:text-amber-200/90">
            {copy(
              "الأرقام الإجمالية بالأعلى مجمدة وصحيحة، لكن قوائم العملاء التفصيلية لهذا الشهر لم تُحفَظ بعد — والتقدير المباشر يصبح غير دقيق بعد تجديد العقود. لعرضها: اضبط الشيت على هذا الشهر ثم اضغط «سحب بيانات الشيت».",
              "The totals above are frozen and correct, but this month's per-client lists were never saved — a live estimate becomes inaccurate after contracts renew. To show them: set the sheet to this month, then click «Pull from Sheet».",
            )}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <BucketCard
            title={copy("On Target - ضمن الهدف", "On Target")}
            accent="emerald"
            clients={buckets.on_target}
            info={t("metricTooltips.contracts_bucketOnTarget")}
          />
          <BucketCard
            title={copy("Overdue - متأخرة", "Overdue - delayed")}
            accent="rose"
            clients={buckets.overdue}
            info={t("metricTooltips.contracts_bucketOverdue")}
          />
          <BucketCard
            title={copy("جددت من التارجت", "Renewed from target")}
            accent="sky"
            clients={buckets.renewed}
            hideValue
            info={t("metricTooltips.contracts_bucketRenewed")}
          />
          <BucketCard
            title={copy("فقدت من التارجت", "Lost from target")}
            accent="zinc"
            clients={buckets.lost}
            hideValue
            info={t("metricTooltips.contracts_bucketLost")}
          />
        </div>
      )}

      {/* Installments expected (due) this month, split by collecting department —
          the same two-card shape as the overdue section below. From a snapshot
          month these mirror the sheet's "Clients with Installments" → Expected
          sub-column; on the live month they're derived from this-month installment
          rows (getMonthTargetBuckets). Hidden for a drifted frozen month, and when
          both lists are empty rather than showing two empty cards. */}
      {!driftedLists &&
        buckets.acc_inst_expected.length + buckets.sales_inst_expected.length > 0 && (
        // id: deep-link target of the brief's «حُصِّلت دفعات جديدة» digest row.
        <div id="installments-month" className="scroll-mt-24 space-y-2 target-highlight">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1 text-sm font-semibold">
              {copy("الدفعات المتوقعة هذا الشهر", "Installments due this month")}
              <MetricInfo
                text={t("metricTooltips.contracts_installmentsDue")}
                label={copy("الدفعات المتوقعة هذا الشهر", "Installments due this month")}
              />
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {copy(
                `${buckets.acc_inst_expected.length + buckets.sales_inst_expected.length} عميل`,
                `${buckets.acc_inst_expected.length + buckets.sales_inst_expected.length} clients`,
              )}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <BucketCard
              title={copy("أقساط مستحقة — أكونت", "Due — Account")}
              accent="sky"
              clients={buckets.acc_inst_expected}
              info={t("metricTooltips.contracts_bucketAccInstOverdue")}
            />
            <BucketCard
              title={copy("أقساط مستحقة — سيلز", "Due — Sales")}
              accent="sky"
              clients={buckets.sales_inst_expected}
              hideValue
              info={t("metricTooltips.contracts_bucketSalesInstOverdue")}
            />
          </div>
        </div>
      )}

      {/* Overdue installments, split by collecting department. From a snapshot
          month these mirror the sheet's "Clients with Installments" lists
          (TARGET_CONTRACTS); on the live month they're derived from the overdue
          installment rows (see getMonthTargetBuckets). Still hidden for a frozen
          month whose snapshot is missing (driftedLists ⇒ data has drifted vs the
          sheet), and hidden when both lists are empty rather than showing two
          empty cards. */}
      {!driftedLists &&
        buckets.acc_inst_overdue.length + buckets.sales_inst_overdue.length > 0 && (
        // id: deep-link target of the CEO brief's «دفعات متأخرة التحصيل» row —
        // the brief shows no numbers, this card is where the CEO reads them.
        <div id="overdue-installments" className="scroll-mt-24 space-y-2 target-highlight">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-200">
              {copy("الدفعات المتأخرة", "Overdue installments")}
            </h3>
            {(() => {
              const all = [
                ...buckets.acc_inst_overdue,
                ...buckets.sales_inst_overdue,
              ];
              const collected = all.filter((c) => c.collected).length;
              const outstanding = all.length - collected;
              return (
                <span className="text-[11px] text-muted-foreground">
                  {copy(
                    `${outstanding} عميل متبقّي للتحصيل`,
                    `${outstanding} clients to collect`,
                  )}
                  {collected > 0 && (
                    <span className="ms-1.5 text-emerald-600 dark:text-emerald-300">
                      {copy(`· ${collected} محصّل ✅`, `· ${collected} collected ✅`)}
                    </span>
                  )}
                </span>
              );
            })()}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <BucketCard
              title={copy("أقساط متأخرة — أكونت", "Overdue — Account")}
              accent="rose"
              clients={buckets.acc_inst_overdue}
              info={t("metricTooltips.contracts_bucketAccInstOverdue")}
            />
            <BucketCard
              title={copy("أقساط متأخرة — سيلز", "Overdue — Sales")}
              accent="rose"
              clients={buckets.sales_inst_overdue}
              hideValue
              info={t("metricTooltips.contracts_bucketSalesInstOverdue")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modern sheet-parity board ───────────────────────────────────────────────
function ModernSheetBoard({
  dashboard,
  buckets,
  clients,
  monthLabel,
  revenueGap,
  copy,
}: {
  dashboard: MonthlyDashboard;
  buckets: MonthBuckets;
  clients: CeoClientInsight[];
  monthLabel: string;
  revenueGap: number;
  copy: (ar: string, en: string) => string;
}) {
  const t = useTranslations("ContractsPage");
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

      <div>
        <div className="rounded-[var(--radius-lg)] border border-border/80 bg-card/95 p-4 shadow-[var(--surface-elev)]">
          <SectionBand title={copy("ملخص الشهر", "Monthly Snapshot")} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <SheetCell label={copy("New", "New")} value={dashboard.mov_new} tone="green" compact info={t("metricTooltips.contracts_movNew")} />
            <SheetCell label={copy("مُجدَّد", "Renewed")} value={dashboard.mov_renewed} tone="blue" compact info={t("metricTooltips.contracts_movRenewed")} />
            <SheetCell label={copy("Lost", "Lost")} value={dashboard.mov_lost} tone="red" compact info={t("metricTooltips.contracts_movLost")} />
            <SheetCell label={copy("ترقية", "Upsell")} value={dashboard.mov_upsell} tone="magenta" compact info={t("metricTooltips.contracts_movUpsell")} />
            <SheetCell label={copy("استرجاع", "Win-Back")} value={dashboard.mov_winback} tone="orange" compact info={t("metricTooltips.contracts_movWinback")} />
            <SheetCell label={copy("Closed", "Closed")} value={dashboard.mov_closed} tone="dark" compact info={t("metricTooltips.contracts_movClosed")} />
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
              info={t("metricTooltips.contracts_totalExpected")}
            />
            <SheetCell
              label={copy("إنجاز الأكونت", "Account achievement")}
              value={`${Math.round(dashboard.acc_achievement_pct)}%`}
              tone={dashboard.acc_achievement_pct >= 70 ? "green" : dashboard.acc_achievement_pct >= 35 ? "amber" : "red"}
              info={t("metricTooltips.contracts_achievementPct")}
            />
            <SheetCell
              label={copy("إنجاز المبيعات (أقساط)", "Sales achievement (installments)")}
              value={`${Math.round(dashboard.sales_achievement_pct)}%`}
              tone={dashboard.sales_achievement_pct >= 70 ? "green" : dashboard.sales_achievement_pct >= 35 ? "amber" : "red"}
              info={t("metricTooltips.contracts_achievementPct")}
            />
            <SheetCell
              label={copy("فجوة الإيراد", "Revenue Gap")}
              value={fmtSR(revenueGap)}
              tone={revenueGap > 0 ? "red" : "green"}
              info={t("metricTooltips.contracts_revenueGap")}
            />
          </div>
          <div className="space-y-2.5 px-1 py-3">
            <DeptBar
              label={copy("الأكونت", "Account")}
              pct={dashboard.acc_achievement_pct}
            />
            <DeptBar
              label={copy("المبيعات", "Sales")}
              pct={dashboard.sales_achievement_pct}
            />
            {dashboard.sales_new_income > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {copy(
                  `+ ${fmtSR(dashboard.sales_new_income)} دخل عملاء جدد (توقيعات — بلا هدف تجديد/أقساط، خارج نسبة الإنجاز)`,
                  `+ ${fmtSR(dashboard.sales_new_income)} new-client income (signings — no renewal/installment target, excluded from achievement)`,
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* id: deep-link target of the brief's «عقود على مسار التجديد» digest row. */}
      <div id="renewal-pipeline" className="scroll-mt-24 target-highlight">
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
      </div>

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
              ? (dashboard.sales_act_inst / dashboard.sales_expected) * 100
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
  const t = useTranslations("ContractsPage");
  const pills: Array<{
    label: string;
    value: number;
    tone: "green" | "blue" | "magenta" | "orange" | "amber";
    info: string;
  }> = [
    { label: copy("جديد", "New"), value: roster.cnt_new, tone: "green", info: t("metricTooltips.contracts_rosterNew") },
    { label: copy("تجديد", "Renewal"), value: roster.cnt_renew, tone: "blue", info: t("metricTooltips.contracts_rosterRenew") },
    { label: copy("ترقية", "Upsell"), value: roster.cnt_upsell, tone: "magenta", info: t("metricTooltips.contracts_rosterUpsell") },
    { label: copy("استرجاع", "Win-Back"), value: roster.cnt_winback, tone: "orange", info: t("metricTooltips.contracts_rosterWinback") },
    { label: copy("معلّق", "Hold"), value: roster.cnt_hold, tone: "amber", info: t("metricTooltips.contracts_rosterHold") },
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
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/75">
            <span>{copy("إجمالي العملاء", "Total Clients")}</span>
            <MetricInfo
              text={t("metricTooltips.contracts_rosterTotal")}
              label={copy("إجمالي العملاء", "Total Clients")}
            />
          </div>
          <div className="mt-2 text-4xl font-black tabular-nums leading-none">
            {roster.total}
          </div>
        </div>
        {pills.map((p) => (
          <SheetCell key={p.label} label={p.label} value={p.value} tone={p.tone} compact info={p.info} />
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
  const t = useTranslations("ContractsPage");
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
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{copy("نسبة الإنجاز", "Achievement")}</span>
            <MetricInfo
              text={t("metricTooltips.contracts_deptAchievement")}
              label={copy("نسبة الإنجاز", "Achievement")}
            />
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
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{copy("المحقق", "Actual")}</span>
            <MetricInfo text={t("metricTooltips.contracts_deptActual")} label={copy("المحقق", "Actual")} />
          </div>
          <div className="mt-1 text-lg font-black tabular-nums text-foreground">
            {fmtSR(actual)}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{copy("المتوقع", "Expected")}</span>
            <MetricInfo text={t("metricTooltips.contracts_deptExpected")} label={copy("المتوقع", "Expected")} />
          </div>
          <div className="mt-1 text-lg font-black tabular-nums text-muted-foreground">
            {fmtSR(expected)}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{copy("الفجوة", "Gap")}</span>
            <MetricInfo text={t("metricTooltips.contracts_deptGap")} label={copy("الفجوة", "Gap")} />
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
  const t = useTranslations("ContractsPage");
  const renewalGap = Math.max(0, expected - renewed);
  const ratioPct = expected > 0 ? (renewed / expected) * 100 : 0;
  const barPct = Math.max(0, Math.min(100, ratioPct));
  const palette =
    ratioPct >= 70
      ? { text: "text-emerald-600 dark:text-emerald-300", bar: "bg-cc-green" }
      : ratioPct >= 35
        ? { text: "text-amber-600 dark:text-amber-300", bar: "bg-amber" }
        : { text: "text-rose-600 dark:text-rose-300", bar: "bg-cc-red" };

  const stats: Array<{ label: string; value: number; tone?: "amber" | "rose"; info: string }> = [
    { label: copy("ضمن الهدف", "On Target"), value: onTarget, info: t("metricTooltips.contracts_funnelOnTarget") },
    { label: copy("متأخر", "Overdue"), value: overdue, tone: "amber", info: t("metricTooltips.contracts_funnelOverdue") },
    { label: copy("عربون مبيعات", "Sales Deposit"), value: salesDeposit, info: t("metricTooltips.contracts_funnelSalesDeposit") },
    {
      label: copy("بعد التجديدات", "Excl. renewals"),
      value: targetExclRenewals,
      info: t("metricTooltips.contracts_funnelExclRenewals"),
    },
    { label: copy("بعد الفقد", "Excl. lost"), value: targetExclLost, info: t("metricTooltips.contracts_funnelExclLost") },
    {
      label: copy("فجوة التجديد", "Renewal Gap"),
      value: renewalGap,
      tone: renewalGap > 0 ? "rose" : undefined,
      info: t("metricTooltips.contracts_funnelRenewalGap"),
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
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{copy("مجدّد / متوقع", "Renewed / Expected")}</span>
            <MetricInfo
              text={t("metricTooltips.contracts_funnelRenewedRatio")}
              label={copy("مجدّد / متوقع", "Renewed / Expected")}
            />
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
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{s.label}</span>
              <MetricInfo text={s.info} label={s.label} />
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

function DeptBar({ label, pct }: { label: string; pct: number }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 70 ? "bg-cc-green" : pct >= 35 ? "bg-amber" : "bg-cc-red",
          )}
          style={{ width: `${width}%` }}
        />
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
  info,
}: {
  label: string;
  value: ReactNode;
  tone: "green" | "greenStrong" | "blue" | "amber" | "orange" | "red" | "magenta" | "gray" | "dark";
  compact?: boolean;
  info?: string;
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
      <div className="flex items-center gap-1 text-[11px] font-semibold leading-4 text-muted-foreground">
        <span>{label}</span>
        {info && <MetricInfo text={info} label={label} />}
      </div>
      <div className="mt-2 text-xl font-black tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function BucketCard({
  title,
  accent,
  clients,
  hideValue,
  info,
}: {
  title: string;
  accent: "emerald" | "rose" | "sky" | "zinc";
  clients: BucketClient[];
  hideValue?: boolean;
  info?: string;
}) {
  const t = useTranslations("ContractsPage");
  const dot = {
    emerald: "bg-emerald-400",
    rose: "bg-rose-400",
    sky: "bg-sky-400",
    zinc: "bg-zinc-400",
  }[accent];
  // Collected installments (paid this month) are no longer outstanding: the
  // chase TOTAL and the header count both reflect outstanding only, and the rows
  // are sorted outstanding-first then struck through — mirroring the sheet's
  // strikethrough + "Actual paid clients ✅" treatment.
  const outstanding = clients.filter((c) => !c.collected);
  const collectedCount = clients.length - outstanding.length;
  const total = outstanding.reduce((s, c) => s + c.value, 0);
  const ordered = [...outstanding, ...clients.filter((c) => c.collected)];
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2 rounded-full", dot)} />
          {title}
          <span className="font-normal text-muted-foreground">({outstanding.length})</span>
          {collectedCount > 0 && (
            <span className="font-normal text-emerald-600 dark:text-emerald-300">
              +{collectedCount} ✅
            </span>
          )}
          {info && <MetricInfo text={info} label={title} />}
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
          {ordered.map((c) => (
            <Link
              key={c.contract_id}
              href={`/contracts/${c.contract_id}`}
              className={cn(
                "flex items-center justify-between gap-2 px-4 py-2 text-[12px] hover:bg-soft-1",
                c.collected && "text-muted-foreground line-through decoration-emerald-500/60",
              )}
            >
              <span className="min-w-0 truncate">
                {c.client_code && (
                  <span className="me-1.5 font-mono text-[10px] text-muted-foreground">
                    {c.client_code}
                  </span>
                )}
                {c.client_name ?? "—"}
                {c.collected && (
                  <span className="ms-1.5 align-middle text-[10px] text-emerald-600 no-underline dark:text-emerald-300">
                    ✅
                  </span>
                )}
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

// Renewal-pipeline badge — follows the sheet's `target` column (0191), NOT a
// passed end_date. Overdue = sheet marks the renewal overdue (chase it);
// On Target = renewal on track; null = not in the renewal pipeline (e.g. a new
// Sales-Deposit client, or a held contract). Kept SEPARATE from PaymentStatusBadge
// so a client can read "On target" on renewal while still owing a late payment.
function RenewalStatusBadge({
  status,
  copy,
}: {
  status: "on_target" | "overdue" | null;
  copy: (ar: string, en: string) => string;
}) {
  if (status == null) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "overdue"
          ? "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-200"
          : "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-200",
      )}
    >
      {status === "overdue"
        ? copy("متأخر التجديد", "Overdue renewal")
        : copy("في التارجت", "On target")}
    </span>
  );
}

// Collections badge — a SEPARATE dimension from renewal (0191). 'overdue' = a
// payment is past due; 'due' = a payment falls in the selected month and isn't
// collected yet. This is what made ركن المحرك look like an «overdue renewal»
// when it was really an overdue PAYMENT on an on-target (held) contract.
function PaymentStatusBadge({
  status,
  copy,
}: {
  status: "overdue" | "due" | null;
  copy: (ar: string, en: string) => string;
}) {
  if (status == null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "overdue"
          ? "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-200"
          : "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-200",
      )}
    >
      <Wallet className="size-3" />
      {status === "overdue"
        ? copy("دفعة متأخرة", "Overdue payment")
        : copy("دفعة مستحقة", "Payment due")}
    </span>
  );
}

function TopClientsPanel({
  clients,
  copy,
}: {
  clients: CeoClientInsight[];
  copy: (ar: string, en: string) => string;
}) {
  const t = useTranslations("ContractsPage");
  // Default to the renewal-pipeline view: clients with a renewal due this month
  // (On-Target) or already late (Overdue) who ALSO have a problem signal — the
  // worklist for lifting renewal rates. "All" falls back to the full attention
  // list (general problems regardless of renewal timing).
  const [mode, setMode] = useState<"renewal" | "all">("renewal");
  const renewalClients = clients.filter((c) => c.renewal_status != null);
  const active = mode === "renewal" ? renewalClients : clients;
  const top = active.slice(0, 10);
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">
            {copy("عملاء يحتاجون انتباهك", "Clients needing attention")}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {mode === "renewal"
              ? copy(
                  "تجديدات هذا الشهر والمتأخرة التي لديها مخاطر — لرفع نسب التجديد",
                  "this month's renewals and overdue renewals that carry risk — to lift renewal rates",
                )
              : copy(
                  "مخاطر مفتوحة، دفعات متأخرة، تقييم منخفض، أو تجديد قريب — مرتبة حسب الأولوية",
                  "open risk, overdue installments, low satisfaction, or renewal due soon — ordered by urgency",
                )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-border/70 bg-soft-1 p-0.5 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setMode("renewal")}
              className={cn(
                "rounded-full px-2.5 py-1 transition",
                mode === "renewal"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {copy(`خط التجديد (${renewalClients.length})`, `Renewal (${renewalClients.length})`)}
            </button>
            <button
              type="button"
              onClick={() => setMode("all")}
              className={cn(
                "rounded-full px-2.5 py-1 transition",
                mode === "all"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {copy(`الكل (${clients.length})`, `All (${clients.length})`)}
            </button>
          </div>
        </div>
      </div>
      {top.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {mode === "renewal"
            ? copy(
                "لا يوجد عملاء في خط التجديد لديهم مخاطر هذا الشهر.",
                "No at-risk renewal clients this month.",
              )
            : copy(
                "لا يوجد عملاء يحتاجون انتباهًا خاصًا هذا الشهر.",
                "No clients need special attention this month.",
              )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="bg-soft-1 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">
                  <span className="inline-flex items-center gap-1">
                    {copy("العميل", "Client")}
                    <MetricInfo text={t("metricTooltips.contracts_clientActiveContracts")} label={copy("العميل", "Client")} />
                  </span>
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {copy("التجديد / الدفعات", "Renewal / Payment")}
                </th>
                <th className="px-3 py-2 text-end font-medium">
                  <span className="inline-flex items-center gap-1">
                    {copy("المحصل", "Collected")}
                    <MetricInfo text={t("metricTooltips.contracts_clientCollected")} label={copy("المحصل", "Collected")} />
                  </span>
                </th>
                <th className="px-3 py-2 text-end font-medium">
                  <span className="inline-flex items-center gap-1">
                    {copy("المتوقع", "Expected")}
                    <MetricInfo text={t("metricTooltips.contracts_clientExpected")} label={copy("المتوقع", "Expected")} />
                  </span>
                </th>
                <th className="px-3 py-2 text-center font-medium">
                  <span className="inline-flex items-center gap-1">
                    {copy("التجربة", "Experience")}
                    <MetricInfo text={t("metricTooltips.contracts_clientExperience")} label={copy("التجربة", "Experience")} />
                  </span>
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
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <RenewalStatusBadge status={c.renewal_status} copy={copy} />
                      <PaymentStatusBadge status={c.payment_status} copy={copy} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{fmtSR(c.month_collected)}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                    {fmtSR(c.month_expected)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <ExperiencePill
                      score={c.satisfaction_score}
                      sentiment={c.sentiment}
                      copy={copy}
                    />
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

// Experience pill — reads the AI satisfaction score/sentiment and renders the
// SAME tiers and wording as the رضا العملاء page (satisfaction-workspace
// bucketOf): negative sentiment or score < 55 = at risk, < 70 = needs
// attention, ≥ 70 = healthy, no analysis = not analyzed. Keeping it identical
// is the whole point — the CEO table and the satisfaction board must never
// disagree on a client's standing (e.g. روعة المنزل = 60 / يحتاج متابعة, not a
// separately-derived health number).
function ExperiencePill({
  score,
  sentiment,
  copy,
}: {
  score: number | null;
  sentiment: string | null;
  copy: (ar: string, en: string) => string;
}) {
  const help = copy(
    "يطابق مستويات «رضا العملاء»: يقرأ الذكاء الاصطناعي محادثات واتساب الخاصة بالعميل. أقل من ٥٥ أو نبرة سلبية = في خطر، ٥٥–٦٩ = يحتاج متابعة، ٧٠ فأكثر = ممتاز.",
    "Mirrors the رضا العملاء satisfaction tiers — AI reads the client's WhatsApp chats. Below 55 or a negative tone = At risk; 55–69 = Needs attention; 70+ = Healthy.",
  );
  if (score == null) {
    return (
      <Explained
        text={copy(
          "لا يوجد تحليل واتساب لهذا العميل بعد.",
          "No WhatsApp analysis for this client yet.",
        )}
      >
        <span className="inline-flex rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {copy("لم يُحلَّل", "Not analyzed")}
        </span>
      </Explained>
    );
  }
  const tier =
    sentiment === "negative" || score < 55
      ? "risk"
      : score < 70
        ? "watch"
        : "healthy";
  const cls = {
    healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    watch: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200",
    risk: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  }[tier];
  const label = {
    healthy: copy("ممتاز", "Healthy"),
    watch: copy("يحتاج متابعة", "Needs attention"),
    risk: copy("في خطر", "At risk"),
  }[tier];
  return (
    <Explained text={help}>
      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>
        {label} · {score}
      </span>
    </Explained>
  );
}

// Team-leader & department-manager target rollups, sourced verbatim from the
// sheet's Acc_Target_Breakdown TEAM_TARGET columns. A leader's team = the sum
// of their team members' individual targets; the dept manager's = the whole
// department. Only rows with a team_role render here.
function TeamTargetsCard({
  amTargets,
  copy,
}: {
  amTargets: AmTargetRow[];
  copy: (ar: string, en: string) => string;
}) {
  const t = useTranslations("ContractsPage");
  // Dept manager last (it's the grand total), leaders by team size desc.
  const teamRows = amTargets
    .filter((a) => a.team_role != null)
    .sort((a, b) => {
      if (a.team_role !== b.team_role) return a.team_role === "dept_manager" ? 1 : -1;
      return (b.team_expected ?? 0) - (a.team_expected ?? 0);
    });
  if (teamRows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-card/95 shadow-[var(--surface-elev)]">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <h3 className="text-sm font-semibold">
          {copy("تارجت قادة الفرق والإدارة", "Team-leader & department targets")}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {copy("من الشيت", "from the sheet")}
        </span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {teamRows.map((a) => {
          const exp = a.team_expected ?? 0;
          const ach = a.team_achieved ?? 0;
          const pct = exp > 0 ? (ach / exp) * 100 : 0;
          const barPct = Math.max(0, Math.min(100, pct));
          const palette =
            pct >= 70
              ? { text: "text-emerald-600 dark:text-emerald-300", bar: "bg-cc-green" }
              : pct >= 35
                ? { text: "text-amber-600 dark:text-amber-300", bar: "bg-amber" }
                : { text: "text-rose-600 dark:text-rose-300", bar: "bg-cc-red" };
          const isDept = a.team_role === "dept_manager";
          return (
            <div
              key={a.account_manager_id}
              className={cn(
                "rounded-[var(--radius-md)] border p-4 shadow-sm",
                isDept
                  ? "border-cyan/30 bg-cyan-dim/40 sm:col-span-2 lg:col-span-1"
                  : "border-border/70 bg-soft-1/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {a.account_manager_name ?? "—"}
                  </p>
                  <span
                    className={cn(
                      "mt-0.5 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                      isDept
                        ? "border-cyan/30 bg-cyan-dim text-cyan"
                        : "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200",
                    )}
                  >
                    {isDept
                      ? copy("مديرة القسم", "Dept manager")
                      : copy("قائد فريق", "Team lead")}
                  </span>
                </div>
                <div className="shrink-0 text-end">
                  <div className={cn("text-2xl font-black tabular-nums leading-none", palette.text)}>
                    {fmtPct(pct)}
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>{copy("إنجاز الفريق", "Team achievement")}</span>
                    <MetricInfo
                      text={t("metricTooltips.contracts_teamAchievement")}
                      label={copy("إنجاز الفريق", "Team achievement")}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-soft-1">
                <div className={cn("h-full rounded-full", palette.bar)} style={{ width: `${barPct}%` }} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>{copy("المحقق", "Achieved")}</span>
                    <MetricInfo text={t("metricTooltips.contracts_teamAchieved")} label={copy("المحقق", "Achieved")} />
                  </div>
                  <div className="mt-0.5 font-black tabular-nums text-foreground">{fmtSR(ach)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>{copy("المتوقع", "Expected")}</span>
                    <MetricInfo text={t("metricTooltips.contracts_teamExpected")} label={copy("المتوقع", "Expected")} />
                  </div>
                  <div className="mt-0.5 font-black tabular-nums text-muted-foreground">{fmtSR(exp)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

