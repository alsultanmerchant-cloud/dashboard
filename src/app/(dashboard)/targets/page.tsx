import Link from "next/link";
import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import {
  Activity,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarDays,
  FileSpreadsheet,
  Lock,
  Target,
  Users,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMonthYear } from "@/lib/utils-format";
import {
  getAmTargets,
  getMonthTargetBuckets,
  getMonthlyDashboard,
  listDashboardMonths,
  type AmTargetRow,
  type BucketClient,
  type InstallmentDue,
  type MonthBuckets,
  type MonthlyDashboard,
} from "@/lib/data/contracts";
import { EmployeeTargetForm, DepartmentTargetForm } from "./targets-forms";

function firstOfThisMonth(): string {
  const now = new Date();
  const m = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${m}-01`;
}

function normalizeMonth(value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(0, 7)}-01`;
  return null;
}

function formatMoney(value: number, locale: string): string {
  return `${new Intl.NumberFormat(
    locale.startsWith("ar") ? "ar-SA-u-nu-latn" : "en-US",
    { maximumFractionDigits: 0 },
  ).format(Number.isFinite(value) ? value : 0)} SR`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function sumBucket(rows: Array<{ value?: number; expected_amount?: number }>): number {
  return rows.reduce((sum, row) => sum + Number(row.value ?? row.expected_amount ?? 0), 0);
}

function TargetMetric({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const toneClass = {
    neutral: "border-soft-2 bg-card/70 text-foreground",
    good: "border-cc-green/30 bg-green-dim/25 text-cc-green",
    warn: "border-amber/30 bg-amber-dim/25 text-amber",
    bad: "border-cc-red/30 bg-red-dim/25 text-cc-red",
    info: "border-cc-blue/30 bg-blue-dim/25 text-cc-blue",
  }[tone];

  return (
    <div className={cn("rounded-xl border p-4", toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {/* Every TargetMetric on this page holds a revenue figure. */}
          <p data-private="money" className="mt-2 text-2xl font-bold tabular-nums text-foreground">
            {value}
          </p>
          {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="shrink-0 opacity-75">{icon}</div>
      </div>
    </div>
  );
}

function MonthPicker({
  months,
  selectedMonth,
  locale,
}: {
  months: Array<{ month: string; is_frozen: boolean; source: string }>;
  selectedMonth: string;
  locale: string;
}) {
  const merged = months.some((m) => m.month === selectedMonth)
    ? months
    : [{ month: selectedMonth, is_frozen: false, source: "live" }, ...months];

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {merged.slice(0, 10).map((m) => {
        const active = m.month === selectedMonth;
        return (
          <Link
            key={m.month}
            href={`/targets?m=${m.month}`}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
              active
                ? "border-cc-blue/40 bg-blue-dim/35 text-cc-blue"
                : "border-soft-2 bg-card/55 text-muted-foreground hover:bg-soft-2",
            )}
          >
            <CalendarDays className="size-3.5" />
            {formatMonthYear(m.month, locale)}
          </Link>
        );
      })}
    </div>
  );
}

function AccountTargetsTable({
  rows,
  locale,
}: {
  rows: AmTargetRow[];
  locale: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-soft-2 p-8 text-center text-sm text-muted-foreground">
        لا توجد بيانات تارجت محسوبة لهذا الشهر.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-soft-2">
      <Table>
        <TableHeader className="bg-soft-1/80">
          <TableRow>
            <TableHead>الأكونت</TableHead>
            <TableHead className="text-end">Total Expected</TableHead>
            <TableHead className="text-end">Renewals</TableHead>
            <TableHead className="text-end">Installments</TableHead>
            <TableHead className="text-end">Actual Achieved</TableHead>
            <TableHead className="text-end">Achievement</TableHead>
            <TableHead className="min-w-[150px]">Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const progress = Math.min(100, Math.max(0, row.achievement_pct));
            const tone =
              row.achievement_pct >= 80
                ? "bg-cc-green"
                : row.achievement_pct >= 45
                  ? "bg-amber"
                  : "bg-cc-red";
            return (
              <TableRow key={row.account_manager_id}>
                <TableCell className="font-semibold" data-private="person">
                  {row.account_manager_name ?? "غير محدد"}
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums" data-private="money">
                  {formatMoney(row.expected_total, locale)}
                </TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                  {formatMoney(row.breakdown?.expected_renewals ?? 0, locale)}
                </TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                  {formatMoney(row.breakdown?.expected_installments ?? 0, locale)}
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums" data-private="money">
                  {formatMoney(row.achieved_total, locale)}
                </TableCell>
                <TableCell className="text-end">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold tabular-nums",
                      row.achievement_pct >= 80
                        ? "bg-green-dim text-cc-green"
                        : row.achievement_pct >= 45
                          ? "bg-amber-dim text-amber"
                          : "bg-red-dim text-cc-red",
                    )}
                  >
                    {row.achievement_pct >= 100 ? <ArrowUpRight className="size-3" /> : null}
                    {formatPct(row.achievement_pct)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-soft-2">
                    <div className={cn("h-full rounded-full", tone)} style={{ width: `${progress}%` }} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function DepartmentTargetsTable({
  dashboard,
  locale,
}: {
  dashboard: MonthlyDashboard | null;
  locale: string;
}) {
  const accountCollections = Math.max(
    0,
    (dashboard?.acc_actual ?? 0) - (dashboard?.acc_upsell ?? 0) - (dashboard?.acc_winback ?? 0),
  );
  const rows = [
    {
      key: "account",
      section: "Account M. section",
      expected: dashboard?.acc_expected ?? 0,
      overdueInstallments: dashboard?.acc_exp_overdue_inst ?? 0,
      installments: dashboard?.acc_exp_inst ?? 0,
      onTargetClients: dashboard?.acc_exp_ontarget ?? 0,
      overdueClients: dashboard?.acc_exp_overdue_clients ?? 0,
      actual: dashboard?.acc_actual ?? 0,
      achievement: dashboard?.acc_achievement_pct ?? 0,
      actualInstallments: dashboard?.acc_act_inst ?? 0,
      actualOnTarget: dashboard?.acc_act_ontarget ?? 0,
      actualOverdue: dashboard?.acc_act_overdue_clients ?? 0,
      sdRenewed: dashboard?.acc_act_sd_renewed ?? accountCollections,
      upsell: dashboard?.acc_upsell ?? 0,
      winback: dashboard?.acc_winback ?? 0,
      gap: dashboard?.acc_gap ?? 0,
    },
    {
      key: "sales",
      section: "Sales section",
      expected: dashboard?.sales_expected ?? 0,
      overdueInstallments: dashboard?.sales_exp_overdue_inst ?? 0,
      installments: dashboard?.sales_exp_inst ?? 0,
      onTargetClients: 0,
      overdueClients: 0,
      actual: dashboard?.sales_total_income ?? 0,
      achievement: dashboard?.sales_achievement_pct ?? 0,
      actualInstallments: dashboard?.sales_act_inst ?? 0,
      actualOnTarget: 0,
      actualOverdue: 0,
      sdRenewed: dashboard?.sales_new_income ?? 0,
      upsell: dashboard?.sales_upsell ?? 0,
      winback: 0,
      gap: dashboard?.sales_gap ?? 0,
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-soft-2">
      <Table>
        <TableHeader className="bg-soft-1/80">
          <TableRow>
            <TableHead>Section</TableHead>
            <TableHead className="text-end">Total Expected</TableHead>
            <TableHead className="text-end">Overdue Installments</TableHead>
            <TableHead className="text-end">Installments</TableHead>
            <TableHead className="text-end">On Target clients</TableHead>
            <TableHead className="text-end">Overdue clients</TableHead>
            <TableHead className="text-end">Actual Achieved</TableHead>
            <TableHead className="text-end">Achievement %</TableHead>
            <TableHead className="text-end">Actual Installments</TableHead>
            <TableHead className="text-end">Actual On Target</TableHead>
            <TableHead className="text-end">Actual Overdue</TableHead>
            <TableHead className="text-end">S.D & Renewed</TableHead>
            <TableHead className="text-end">Upsell</TableHead>
            <TableHead className="text-end">Win-Back</TableHead>
            <TableHead className="text-end">Gap</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-semibold">{row.section}</TableCell>
              <TableCell className="text-end font-semibold tabular-nums" data-private="money">
                {formatMoney(row.expected, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.overdueInstallments, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.installments, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.onTargetClients, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.overdueClients, locale)}
              </TableCell>
              <TableCell className="text-end font-semibold tabular-nums" data-private="money">
                {formatMoney(row.actual, locale)}
              </TableCell>
              <TableCell className="text-end font-semibold tabular-nums">
                {formatPct(row.achievement)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.actualInstallments, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.actualOnTarget, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.actualOverdue, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.sdRenewed, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.upsell, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground" data-private="money">
                {formatMoney(row.winback, locale)}
              </TableCell>
              <TableCell className="text-end font-semibold tabular-nums" data-private="money">
                {formatMoney(row.gap, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BucketList({
  title,
  rows,
  locale,
  tone,
}: {
  title: string;
  rows: BucketClient[];
  locale: string;
  tone: "good" | "warn" | "bad" | "info";
}) {
  const toneClass = {
    good: "border-cc-green/25",
    warn: "border-amber/25",
    bad: "border-cc-red/25",
    info: "border-cc-blue/25",
  }[tone];

  return (
    <div className={cn("rounded-xl border bg-card/70", toneClass)}>
      <div className="flex items-center justify-between border-b border-soft-2 px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {rows.length} عميل
        </span>
      </div>
      <div className="max-h-[300px] overflow-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد سجلات.</p>
        ) : (
          rows.slice(0, 30).map((row) => (
            <div
              key={`${row.contract_id}-${row.client_code ?? row.client_name ?? "client"}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-soft-2 px-4 py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" data-private="client">{row.client_name ?? "عميل غير محدد"}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {row.client_code ?? "بدون كود"} · <span data-private="person">{row.account_manager_name ?? "بدون أكونت"}</span>
                </p>
              </div>
              <div className="text-end text-sm font-bold tabular-nums" data-private="money">
                {formatMoney(row.value, locale)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InstallmentsList({
  rows,
  locale,
}: {
  rows: InstallmentDue[];
  locale: string;
}) {
  return (
    <div className="rounded-xl border border-soft-2 bg-card/70">
      <div className="flex items-center justify-between border-b border-soft-2 px-4 py-3">
        <h3 className="text-sm font-semibold">Clients with Installments</h3>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {rows.length} دفعة
        </span>
      </div>
      <div className="max-h-[300px] overflow-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد دفعات مستحقة.</p>
        ) : (
          rows.slice(0, 30).map((row, index) => (
            <div
              key={`${row.contract_id}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-soft-2 px-4 py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" data-private="client">{row.client_name ?? "عميل غير محدد"}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  <span data-private="person">{row.account_manager_name ?? "بدون أكونت"}</span> · {row.status}
                </p>
              </div>
              <div className="text-end text-sm font-bold tabular-nums" data-private="money">
                {formatMoney(row.expected_amount, locale)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SheetTargetsSection({
  dashboard,
  amTargets,
  buckets,
  months,
  selectedMonth,
  locale,
}: {
  dashboard: MonthlyDashboard | null;
  amTargets: AmTargetRow[];
  buckets: MonthBuckets;
  months: Array<{ month: string; is_frozen: boolean; source: string }>;
  selectedMonth: string;
  locale: string;
}) {
  const accountActual = dashboard?.acc_actual ?? 0;
  const accountExpected = dashboard?.acc_expected ?? 0;
  const salesActual = dashboard?.sales_total_income ?? 0;
  const salesExpected = dashboard?.sales_expected ?? 0;
  const expected = accountExpected + salesExpected;
  const actual = accountActual + salesActual;
  const gap = Math.max(0, (dashboard?.acc_gap ?? 0) + (dashboard?.sales_gap ?? 0));
  const achievementPct = expected > 0 ? (actual / expected) * 100 : 0;

  return (
    <section className="mb-8 space-y-4">
      <div className="rounded-2xl border border-soft-2 bg-card/80 p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-cc-blue/25 bg-blue-dim/25 px-2.5 py-1 text-[11px] font-semibold text-cc-blue">
              <FileSpreadsheet className="size-3.5" />
              Google Sheet Targets
            </div>
            <h2 className="text-xl font-bold">جدول التارجت من الشيت</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Acc_Target_Breakdown و TARGET_CONTRACTS في صفحة واحدة.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dashboard?.is_frozen ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-500/25 bg-zinc-500/10 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                <Lock className="size-3.5" />
                Frozen from sheet
              </span>
            ) : (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cc-green/25 bg-green-dim/25 px-3 text-xs font-semibold text-cc-green">
                <Activity className="size-3.5" />
                Live sync
              </span>
            )}
            <Link
              href="/contracts?view=dashboard"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-soft-2 bg-card/70 px-3 text-xs font-semibold hover:bg-soft-2"
            >
              <ArrowUpRight className="size-3.5" />
              CEO dashboard
            </Link>
          </div>
        </div>

        <MonthPicker months={months} selectedMonth={selectedMonth} locale={locale} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <TargetMetric
          label="Total Expected"
          value={formatMoney(expected, locale)}
          hint={formatMonthYear(selectedMonth, locale)}
          icon={<Target className="size-5" />}
          tone="info"
        />
        <TargetMetric
          label="Actual Achieved"
          value={formatMoney(actual, locale)}
          hint={`Achievement ${formatPct(achievementPct)}`}
          icon={<BadgeDollarSign className="size-5" />}
          tone="good"
        />
        <TargetMetric
          label="Revenue Gap"
          value={formatMoney(gap, locale)}
          hint="المتبقي للوصول للهدف"
          icon={<ArrowUpRight className="size-5" />}
          tone={gap > 0 ? "warn" : "good"}
        />
        <TargetMetric
          label="Target Clients"
          value={(dashboard?.cnt_on_target ?? 0) + (dashboard?.cnt_overdue ?? 0)}
          hint={`${dashboard?.cnt_on_target ?? 0} on target · ${dashboard?.cnt_overdue ?? 0} overdue`}
          icon={<Users className="size-5" />}
          tone="neutral"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold">Sheet target breakdown</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                كل أعمدة التارجت المحفوظة من الشيت لقسمي الأكونت والمبيعات.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-end text-xs sm:flex">
              <span className="rounded-lg border border-soft-2 bg-soft-1 px-3 py-2">
                Account Expected <b className="ms-1 tabular-nums" data-private="money">{formatMoney(accountExpected, locale)}</b>
              </span>
              <span className="rounded-lg border border-soft-2 bg-soft-1 px-3 py-2">
                Account Actual <b className="ms-1 tabular-nums" data-private="money">{formatMoney(accountActual, locale)}</b>
              </span>
            </div>
          </div>
          <DepartmentTargetsTable dashboard={dashboard} locale={locale} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <h3 className="text-base font-bold">Acc_Target_Breakdown by account manager</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              تفصيل الأكونتات: المتوقع، المحقق، الأقساط، ونسبة الإنجاز.
            </p>
          </div>
          <AccountTargetsTable rows={amTargets} locale={locale} />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <TargetMetric
          label="On Target Value"
          value={formatMoney(sumBucket(buckets.on_target), locale)}
          hint={`${buckets.on_target.length} عميل`}
          icon={<Target className="size-5" />}
          tone="good"
        />
        <TargetMetric
          label="Overdue Value"
          value={formatMoney(sumBucket(buckets.overdue), locale)}
          hint={`${buckets.overdue.length} عميل`}
          icon={<Activity className="size-5" />}
          tone="bad"
        />
        <TargetMetric
          label="Renewed from Target"
          value={formatMoney(sumBucket(buckets.renewed), locale)}
          hint={`${buckets.renewed.length} عميل`}
          icon={<ArrowUpRight className="size-5" />}
          tone="good"
        />
        <TargetMetric
          label="Lost from Target"
          value={formatMoney(sumBucket(buckets.lost), locale)}
          hint={`${buckets.lost.length} عميل`}
          icon={<Activity className="size-5" />}
          tone="warn"
        />
        <TargetMetric
          label="Installments Due"
          value={formatMoney(sumBucket(buckets.installments_due), locale)}
          hint={`${buckets.installments_due.length} دفعة`}
          icon={<BadgeDollarSign className="size-5" />}
          tone="info"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <BucketList title="On Target" rows={buckets.on_target} locale={locale} tone="good" />
        <BucketList title="Overdue" rows={buckets.overdue} locale={locale} tone="bad" />
        <BucketList title="RENEWED from target" rows={buckets.renewed} locale={locale} tone="info" />
        <BucketList title="LOST from target" rows={buckets.lost} locale={locale} tone="warn" />
      </div>

      <InstallmentsList rows={buckets.installments_due} locale={locale} />
    </section>
  );
}

export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await requirePagePermission("target.view");
  const defaultMonth = firstOfThisMonth();
  const sp = await searchParams;
  const selectedMonth = normalizeMonth(sp.m) ?? defaultMonth;
  const locale = await getLocale();

  const [{ data: members }, { data: depts }, months, dashboard, amTargets, buckets] = await Promise.all([
    supabaseAdmin
      .from("employee_profiles")
      .select("id, full_name")
      .eq("organization_id", session.orgId)
      .order("full_name", { ascending: true }),
    supabaseAdmin
      .from("departments")
      .select("id, name")
      .eq("organization_id", session.orgId)
      .order("name", { ascending: true }),
    listDashboardMonths(session.orgId),
    getMonthlyDashboard(session.orgId, selectedMonth),
    getAmTargets(session.orgId, selectedMonth),
    getMonthTargetBuckets(session.orgId, selectedMonth),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="الأهداف الشهرية"
        description="جدول التارجت من الشيت مع أهداف التشغيل الداخلية"
        actions={
          <Link
            href="/contracts/import"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-soft-2 bg-card/70 px-3 text-xs font-semibold hover:bg-soft-2"
          >
            <FileSpreadsheet className="size-3.5" />
            تحديث الشيت
          </Link>
        }
      />

      <SheetTargetsSection
        dashboard={dashboard}
        amTargets={amTargets}
        buckets={buckets}
        months={months}
        selectedMonth={selectedMonth}
        locale={locale}
      />

      <section className="mb-8">
        <SectionTitle title="أهداف التشغيل الداخلية" description="الأهداف اليدوية للموظفين والأقسام بعيدا عن جدول التارجت التجاري" />
      </section>

      <section className="mb-8">
        <SectionTitle title="هدف موظف" description="يظهر في تقرير الإقفال الشهري كنسبة إنجاز" />
        <Card>
          <CardContent className="p-4">
            <EmployeeTargetForm members={members ?? []} defaultMonth={defaultMonth} />
          </CardContent>
        </Card>
      </section>

      <section className="mb-8">
        <SectionTitle title="هدف قسم" description="أهداف على مستوى القسم" />
        <Card>
          <CardContent className="p-4">
            <DepartmentTargetForm depts={depts ?? []} defaultMonth={defaultMonth} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
