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
  amTargets,
  buckets,
  clientInsights,
  months,
  selectedMonth,
}: {
  dashboard: MonthlyDashboard;
  amTargets: AmTargetRow[];
  buckets: MonthBuckets;
  clientInsights: CeoClientInsight[];
  months: Array<{ month: string; is_frozen: boolean; source: string }>;
  selectedMonth: string;
}) {
  const t = useTranslations("Dashboard.executive");
  const locale = useLocale();
  const copy = (ar: string, en: string) => (locale.startsWith("ar") ? ar : en);
  const router = useRouter();
  const d = dashboard;
  const achievement = Math.min(100, d.achievement_pct);
  const revenueGap = Math.max(0, d.total_expected - d.total_actual);
  const topClient = clientInsights[0] ?? null;
  const riskClients = clientInsights.filter((c) => c.health_label === "risk");
  const watchClients = clientInsights.filter((c) => c.health_label === "watch");
  const overdueExposure = clientInsights.reduce(
    (sum, c) => sum + c.overdue_installments,
    0,
  );
  const aiLead =
    riskClients[0]?.top_risk ||
    watchClients[0]?.top_risk ||
    (topClient?.satisfaction_summary
      ? topClient.satisfaction_summary
      : revenueGap > 0
        ? t("dashboard.executive.aiFallbackGap")
        : t("dashboard.executive.aiFallbackHealthy"));

  return (
    <div className="space-y-4">
      {/* Month selector + status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-soft bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {copy("الشهر:", "Month:")}
          </span>
          <select
            value={selectedMonth}
            onChange={(e) =>
              router.push(`/contracts?view=dashboard&m=${e.target.value}`)
            }
            className="h-9 rounded-lg border border-input bg-input px-3 text-sm"
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-3 py-1 text-[11px] font-medium text-zinc-300">
            <Lock className="size-3" />
            {d.source === "sheet_import"
              ? copy("مجمد من الشيت", "Frozen from sheet")
              : copy("مجمد", "Frozen")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
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
        aiLead={aiLead}
        revenueGap={revenueGap}
        overdueExposure={overdueExposure}
        achievement={achievement}
        copy={copy}
      />

      {/* Per-AM target breakdown */}
      <div className="rounded-2xl border border-soft bg-card">
        <div className="flex items-center justify-between border-b border-soft px-4 py-3">
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

      {/* Per-client target breakdown (Acc_Target_Breakdown) */}
      {d.is_frozen && (
        <p className="text-[11px] text-amber-300/70">
          {copy(
            "تفصيل العملاء أدناه محسوب مباشرة من الحالة الحالية وقد يختلف قليلا عن الشهر المجمد.",
            "The client drill-down below is live and can differ slightly from frozen month totals.",
          )}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <BucketCard
          title={copy("On Target - قابلة للتجديد", "On Target - renewable")}
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
      <div className="rounded-2xl border border-soft bg-card">
        <div className="flex items-center justify-between border-b border-soft px-4 py-3">
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
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                            : i.status === "overdue"
                              ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                              : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
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
  aiLead,
  revenueGap,
  overdueExposure,
  achievement,
  copy,
}: {
  dashboard: MonthlyDashboard;
  buckets: MonthBuckets;
  clients: CeoClientInsight[];
  monthLabel: string;
  aiLead: string;
  revenueGap: number;
  overdueExposure: number;
  achievement: number;
  copy: (ar: string, en: string) => string;
}) {
  const expectedTargetClients = dashboard.cnt_on_target + dashboard.cnt_overdue;
  const expectedAfterRenewed = Math.max(
    0,
    expectedTargetClients - dashboard.mov_renewed,
  );
  const expectedAfterLost = Math.max(0, expectedAfterRenewed - dashboard.mov_lost);
  const avgHealth = clients.length
    ? clients.reduce((sum, client) => sum + client.health_score, 0) / clients.length
    : null;
  const riskClients = clients.filter((c) => c.health_label === "risk");
  const watchClients = clients.filter((c) => c.health_label === "watch");
  const topClient = clients[0] ?? null;
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
    <section className="space-y-3">
      <div className="rounded-xl border border-soft bg-card p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {copy("لوحة الرئيس الشهرية", "CEO Monthly Dashboard")}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-bold">
            {copy("ملخص الإيراد والعملاء", "Revenue and Client Control Board")} · {monthLabel}
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan/25 bg-cyan-dim px-3 py-1 text-[11px] font-medium text-cyan">
            <Brain className="size-3.5" />
            {copy("مدعوم بتجربة العميل والتحصيل", "client experience and collections connected")}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SheetCell
          label={copy("العقود الجديدة", "New Contracts")}
          value={dashboard.mov_new}
          tone="green"
        />
        <SheetCell
          label={copy("العقود المُجدَّدة الجارية", "Ongoing Renewed")}
          value={dashboard.mov_renewed}
          tone="blue"
        />
        <SheetCell label={copy("معلّق", "Hold")} value={dashboard.mov_hold} tone="amber" />
        <SheetCell
          label={copy("إجمالي العملاء", "Total Clients")}
          value={dashboard.cnt_total_clients}
          tone="gray"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[1.35fr_0.95fr]">
        <div className="rounded-xl border border-soft bg-card p-3 shadow-sm">
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
              label={copy("نسبة تحقيق الإيراد", "Revenue Achievement")}
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

        <div className="rounded-xl border border-soft bg-card p-3 shadow-sm">
          <SectionBand title={copy("قراءة تنفيذية بالذكاء الاصطناعي", "AI Executive Read")} />
          <div className="space-y-3 p-4">
            <div className="flex items-start gap-2 rounded-lg border border-cyan/25 bg-cyan-dim p-3">
              <Brain className="mt-0.5 size-4 shrink-0 text-cyan" />
              <p className="text-sm leading-6">{aiLead}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-[11px] sm:grid-cols-4">
              <SignalCell label={copy("أهم عميل", "Top client")} value={topClient?.client_name ?? "—"} />
              <SignalCell label={copy("الخطر", "Risk")} value={`${riskClients.length}`} />
              <SignalCell label={copy("المراقبة", "Watch")} value={`${watchClients.length}`} />
              <SignalCell label={copy("متوسط الصحة", "Avg health")} value={fmtPct(avgHealth)} />
            </div>
          </div>
        </div>
      </div>

      <SectionBand title={copy("قسم الأكونت", "Account Department")} />
      <div className="grid gap-3 md:grid-cols-4">
        <SheetCell label={copy("عربون المبيعات", "Sales Deposit")} value={dashboard.cnt_sales_deposit} tone="green" />
        <SheetCell label={copy("ضمن الهدف", "On Target")} value={dashboard.cnt_on_target} tone="blue" />
        <SheetCell label={copy("متأخر", "Overdue")} value={dashboard.cnt_overdue} tone="red" />
        <SheetCell
          label={copy("المتوقع ضمن الهدف + المتأخر", "Expected on target + overdue")}
          value={expectedTargetClients}
          tone="gray"
        />
        <SheetCell
          label={copy("بعد التجديد", "After renewed")}
          value={expectedAfterRenewed}
          tone="blue"
        />
        <SheetCell
          label={copy("بعد الفقد", "After lost")}
          value={expectedAfterLost}
          tone="green"
        />
        <SheetCell
          label={copy("المجدد فعليًا هذا الشهر", "Actual Renewed This Month")}
          value={dashboard.mov_renewed}
          tone="greenStrong"
        />
        <SheetCell
          label={copy("فجوة التجديد", "Renewal Gap")}
          value={Math.max(0, expectedTargetClients - dashboard.mov_renewed)}
          tone="red"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-xl border border-soft bg-card p-3 shadow-sm">
          <SectionBand
            title={copy(
              "تارجت مدير الحساب والإنجاز",
              "Account manager target and achievement",
            )}
          />
          <div className="grid gap-2 md:grid-cols-4">
            <SheetCell
              label={copy("الدفعات", "Installments")}
              value={fmtSR(dashboard.expected_installments)}
              tone="orange"
            />
            <SheetCell
              label={copy("عملاء ضمن الهدف / المتأخرين", "On/Overdue clients")}
              value={fmtSR(dashboard.expected_renewals)}
              tone="blue"
            />
            <SheetCell
              label={copy("المحقق الفعلي", "Actual Achieved")}
              value={fmtSR(dashboard.total_actual)}
              tone="green"
            />
            <SheetCell
              label={copy("الفجوة", "Gap")}
              value={fmtSR(revenueGap)}
              tone={revenueGap > 0 ? "red" : "green"}
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <SheetCell
              label={copy("ترقية - أكونت", "Upsell - Account")}
              value={dashboard.mov_upsell}
              tone="magenta"
            />
            <SheetCell
              label={copy("استرجاع", "Win-Back")}
              value={dashboard.mov_winback}
              tone="orange"
            />
          </div>
        </div>

        <div className="rounded-xl border border-soft bg-card p-3 shadow-sm">
          <SectionBand title={copy("قسم المبيعات", "Sales Section")} />
          <div className="grid gap-2 md:grid-cols-2">
            <SheetCell
              label={copy("الدفعات المتوقعة", "Expected Installments")}
              value={fmtSR(dashboard.expected_installments)}
              tone="orange"
            />
            <SheetCell
              label={copy("الدفعات الفعلية", "Actual Installments")}
              value={fmtSR(dashboard.actual_installments)}
              tone="green"
            />
            <SheetCell
              label={copy("قيمة التأخير", "Overdue Exposure")}
              value={fmtSR(overdueExposure)}
              tone={overdueExposure > 0 ? "red" : "green"}
            />
            <SheetCell
              label={copy("الدفعات المستحقة", "Due installments")}
              value={buckets.installments_due.length}
              tone={riskClients.length > 0 ? "red" : "amber"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-xl border border-soft bg-card p-4 shadow-sm">
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
        <div className="rounded-xl border border-soft bg-card p-4 shadow-sm">
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

function SectionBand({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 border-b border-soft pb-2">
      <h3 className="text-sm font-bold">{title}</h3>
      <span className="h-1.5 w-10 rounded-full bg-cyan" />
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
    green: "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-200",
    greenStrong: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
    blue: "border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
    orange: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-200",
    red: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200",
    magenta: "border-pink/30 bg-pink/10 text-pink",
    gray: "border-soft bg-soft-1/50 text-foreground",
    dark: "border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200",
  }[tone];
  return (
    <div className={cn("min-h-[78px] rounded-lg border p-3", toneCls, compact && "min-h-[68px] p-2")}>
      <div className="text-[11px] font-semibold leading-4 text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-black tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function SignalCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-soft bg-card px-2 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-semibold">{value}</div>
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
    <div className="rounded-2xl border border-soft bg-card">
      <div className="flex items-center justify-between border-b border-soft px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2 rounded-full", dot)} />
          {title}
          <span className="text-muted-foreground font-normal">({clients.length})</span>
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
    <section className="bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-soft px-4 py-3">
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
