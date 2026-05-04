import Link from "next/link";
import {
  Wallet, TrendingUp, TrendingDown, ReceiptText,
  CircleCheck, RefreshCw, PauseCircle, Users, Sparkles,
  XCircle, Award, ArrowDown, ArrowUp,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getCeoDashboardData, currentMonthIso,
  CONTRACT_TYPE_LABEL, type ContractTypeKey,
} from "@/lib/data/ceo-dashboard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MonthSelector } from "./month-selector";

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(n);

// Headline tile (small, count-only)
function StatTile({
  label, value, hint, tone = "default", icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "info" | "purple";
  icon?: React.ReactNode;
}) {
  const accent = {
    default: "border-white/[0.08] bg-card/60",
    success: "border-cc-green/30 bg-green-dim/30",
    warning: "border-amber/30 bg-amber-dim/30",
    destructive: "border-cc-red/30 bg-red-dim/30",
    info: "border-cc-blue/30 bg-blue-dim/30",
    purple: "border-cc-purple/30 bg-purple-dim/30",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3.5", accent)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <div className="text-muted-foreground/60 shrink-0">{icon}</div>
        )}
      </div>
    </div>
  );
}

// Money row inside the account/sales sub-tables
function MoneyRow({
  label, value, tone = "default", isHeader, isBig,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "destructive";
  isHeader?: boolean;
  isBig?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        isHeader && "border-b border-white/[0.08] pb-2 mb-1",
      )}
    >
      <span
        className={cn(
          "text-xs",
          isHeader ? "font-semibold uppercase tracking-wider" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          isBig ? "text-base font-bold" : "text-sm font-semibold",
          tone === "success" && "text-cc-green",
          tone === "warning" && "text-amber",
          tone === "destructive" && "text-cc-red",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requirePagePermission("contract.view");
  const sp = await searchParams;
  const monthIso = sp.month && /^\d{4}-\d{2}$/.test(sp.month)
    ? sp.month
    : currentMonthIso();

  const data = await getCeoDashboardData(session.orgId, monthIso);
  const { today, movement, income, account, sales, window } = data;

  const movementOrder: { key: ContractTypeKey; tone: Parameters<typeof StatTile>[0]["tone"]; icon: React.ReactNode }[] = [
    { key: "New", tone: "info", icon: <Sparkles className="size-4" /> },
    { key: "Renew", tone: "success", icon: <RefreshCw className="size-4" /> },
    { key: "Lost", tone: "destructive", icon: <XCircle className="size-4" /> },
    { key: "UPSELL", tone: "purple", icon: <Award className="size-4" /> },
    { key: "WinBack", tone: "warning", icon: <ArrowUp className="size-4" /> },
    { key: "Hold", tone: "default", icon: <PauseCircle className="size-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة المدير التنفيذي — مالية"
        description="نظرة شاملة على حركة العقود، الإيرادات المتوقعة والفعلية، وأداء قسمي الأكاونت والمبيعات."
        actions={
          <Link
            href="/finance/expenses"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-card/60 px-3 text-xs font-medium hover:bg-white/[0.06] transition-colors"
          >
            <ReceiptText className="size-4" />
            المصروفات
          </Link>
        }
      />

      {/* ============ Section 1: Today's Client Status ============ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">حالة العملاء — اليوم</h2>
            <p className="text-xs text-muted-foreground">إجمالي العقود النشطة في كل فئة</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile
            label="عقود جديدة"
            value={today.newContracts}
            tone="info"
            icon={<Sparkles className="size-4" />}
          />
          <StatTile
            label="عملاء يتجدّدون"
            value={today.renewing}
            tone="success"
            icon={<RefreshCw className="size-4" />}
          />
          <StatTile
            label="معلّقون (Hold)"
            value={today.hold}
            tone="warning"
            icon={<PauseCircle className="size-4" />}
          />
          <StatTile
            label="إجمالي العملاء"
            value={today.totalClients}
            tone="default"
            icon={<Users className="size-4" />}
          />
          <StatTile
            label="عقود رفع باقة"
            value={today.upsell}
            tone="purple"
            icon={<Award className="size-4" />}
          />
          <StatTile
            label="استرجاع عميل"
            value={today.winBack}
            tone="warning"
            icon={<ArrowUp className="size-4" />}
          />
        </div>
      </section>

      {/* ============ Section 2: Monthly Snapshot ============ */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold">حركة الشهر — {window.monthLabel}</h2>
            <p className="text-xs text-muted-foreground">العقود التي بدأت أو أُغلقت خلال هذا الشهر فقط</p>
          </div>
          <MonthSelector monthIso={monthIso} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {movementOrder.map(({ key, tone, icon }) => (
            <StatTile
              key={key}
              label={CONTRACT_TYPE_LABEL[key]}
              value={movement.byType[key].count}
              hint={movement.byType[key].value > 0 ? sar(movement.byType[key].value) + " ر.س" : undefined}
              tone={tone}
              icon={icon}
            />
          ))}
        </div>
      </section>

      {/* ============ Section 3: Company Income ============ */}
      <section>
        <h2 className="mb-3 text-base font-semibold">
          إيرادات الشركة (NEW + RENEWAL) — {window.monthLabel}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="border-cyan/20">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    الإيراد المتوقع
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-cyan">
                    {sar(income.expected)} <span className="text-base text-muted-foreground">ر.س</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {income.expectedCount} عقد جديد + تجديد
                  </p>
                </div>
                <TrendingUp className="size-6 text-cyan" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-cc-green/20">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    الإيراد الفعلي
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-cc-green">
                    {sar(income.actual)} <span className="text-base text-muted-foreground">ر.س</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {income.actualCount} دفعة مستلمة
                  </p>
                </div>
                <Wallet className="size-6 text-cc-green" />
              </div>
              {income.expected > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-cc-green to-cyan"
                      style={{
                        width: `${Math.min(100, (income.actual / income.expected) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                    {Math.round((income.actual / income.expected) * 100)}% من المتوقع
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============ Section 4: Account Department ============ */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold">قسم الأكاونت — {window.monthLabel}</h2>
          <p className="text-xs text-muted-foreground">
            متابعة عملاء الأكاونت: المتوقع، المتأخر، والفعلي المُحقق
          </p>
        </div>

        {/* Target overview row */}
        <Card className="mb-3">
          <CardContent className="p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              نظرة على عدد العقود
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatTile label="ودائع المبيعات" value={account.salesDeposit} />
              <StatTile label="على الموعد" value={account.onTarget} tone="success" />
              <StatTile label="متأخر" value={account.overdue} tone="destructive" />
              <StatTile
                label="المتوقع (الكل)"
                value={account.expectedOnPlusOverdue}
                hint="على الموعد + متأخر"
              />
              <StatTile
                label="بعد طرح المتجدّدين"
                value={account.expectedRemovingRenewed}
                hint="ما يحتاج متابعة"
                tone="warning"
              />
              <StatTile
                label="المُحقَّق فعلياً"
                value={account.actualAchievedThisMonth}
                tone="success"
                icon={<CircleCheck className="size-4" />}
              />
            </div>
          </CardContent>
        </Card>

        {/* Money breakdown — Expected vs Actual */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label="المُتوقّع" value="" isHeader />
              <MoneyRow
                label="دفعات متأخرة مضافة للتراكن"
                value={`${sar(account.overdueInstallmentsAmount)} ر.س`}
              />
              <MoneyRow
                label="دفعات هذا الشهر"
                value={`${sar(account.installmentsAmount)} ر.س`}
              />
              <MoneyRow
                label="عملاء على الموعد"
                value={`${sar(account.onTargetClientsAmount)} ر.س`}
              />
              <MoneyRow
                label="عملاء متأخرون"
                value={`${sar(account.overdueClientsAmount)} ر.س`}
              />
              <MoneyRow
                label="إجمالي المتوقع"
                value={`${sar(account.totalExpected)} ر.س`}
                isBig
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label="الفعلي المُحصَّل" value="" isHeader />
              <MoneyRow
                label="دفعات متأخرة محصَّلة"
                value={`${sar(account.actualOverdueInstallments)} ر.س`}
                tone="success"
              />
              <MoneyRow
                label="دفعات هذا الشهر"
                value={`${sar(account.actualInstallments)} ر.س`}
                tone="success"
              />
              <MoneyRow
                label="رفع باقة"
                value={`${sar(account.upsellAcc)} ر.س`}
                tone="success"
              />
              <MoneyRow
                label="استرجاع عميل"
                value={`${sar(account.winBackAcc)} ر.س`}
                tone="success"
              />
              <MoneyRow
                label="إجمالي إيراد الأكاونت"
                value={`${sar(account.totalIncomeFromAccount)} ر.س`}
                isBig
                tone="success"
              />
              <div className="pt-2 mt-2 border-t border-white/[0.08]">
                <MoneyRow
                  label="نسبة التحقّق"
                  value={
                    account.revenueAchievementPct === null
                      ? "—"
                      : `${account.revenueAchievementPct}%`
                  }
                  tone={
                    account.revenueAchievementPct === null
                      ? "default"
                      : account.revenueAchievementPct >= 80
                        ? "success"
                        : account.revenueAchievementPct >= 50
                          ? "warning"
                          : "destructive"
                  }
                />
                <MoneyRow
                  label="فجوة الإيراد"
                  value={`${sar(account.revenueGap)} ر.س`}
                  tone={account.revenueGap > 0 ? "warning" : "default"}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============ Section 5: Sales Department ============ */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold">قسم المبيعات — {window.monthLabel}</h2>
          <p className="text-xs text-muted-foreground">
            متابعة دفعات عملاء المبيعات الجدد + الإيراد الكلي من المبيعات
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label="المُتوقّع" value="" isHeader />
              <MoneyRow
                label="دفعات متأخرة"
                value={`${sar(sales.overdueInstallments)} ر.س`}
                tone="warning"
              />
              <MoneyRow
                label="دفعات هذا الشهر"
                value={`${sar(sales.expectedInstallments)} ر.س`}
              />
              <MoneyRow
                label="إجمالي المتوقع من الدفعات"
                value={`${sar(sales.totalExpectedFromInstallments)} ر.س`}
                isBig
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label="الفعلي" value="" isHeader />
              <MoneyRow
                label="دفعات مُحصَّلة"
                value={`${sar(sales.actualInstallments)} ر.س`}
                tone="success"
              />
              <MoneyRow
                label="إيراد من عملاء جدد"
                value={`${sar(sales.actualIncomeFromNewClients)} ر.س`}
                tone="success"
              />
              <MoneyRow
                label="إجمالي إيراد المبيعات"
                value={`${sar(sales.totalIncomeFromSales)} ر.س`}
                isBig
                tone="success"
              />
              <div className="pt-2 mt-2 border-t border-white/[0.08]">
                <MoneyRow
                  label="نسبة تحصيل الدفعات"
                  value={
                    sales.installmentsAchievementPct === null
                      ? "—"
                      : `${sales.installmentsAchievementPct}%`
                  }
                  tone={
                    sales.installmentsAchievementPct === null
                      ? "default"
                      : sales.installmentsAchievementPct >= 80
                        ? "success"
                        : sales.installmentsAchievementPct >= 50
                          ? "warning"
                          : "destructive"
                  }
                />
                <MoneyRow
                  label="الفجوة"
                  value={`${sar(sales.gap)} ر.س`}
                  tone={sales.gap > 0 ? "warning" : "default"}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Help banner */}
      <Card className="border-cyan/20 bg-cyan-dim/10">
        <CardContent className="p-4 flex items-start gap-3">
          <Sparkles className="size-5 text-cyan shrink-0 mt-0.5" />
          <div className="text-xs text-foreground/90 leading-relaxed">
            <p className="font-semibold mb-1">كيف تُحسب هذه الأرقام؟</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>حالة العملاء اليوم: عدّ العقود النشطة في كل فئة (مستقل عن الشهر).</li>
              <li>حركة الشهر: العقود التي بدأت أو أُغلقت في الشهر المختار من الزر أعلاه.</li>
              <li>الإيراد الفعلي: مجموع الدفعات (installments) الفعلية المُسجَّلة بتاريخ هذا الشهر.</li>
              <li>قسم الأكاونت = العقود التي حقلها <code>target</code> ليس &quot;Sales Deposit&quot;. قسم المبيعات = العقود ذات <code>target=Sales Deposit</code>.</li>
            </ul>
            <p className="mt-2 text-[11px]">
              <Link href="/contracts" className="text-cyan hover:underline">إدارة العقود</Link>
              {" · "}
              <Link href="/finance/expenses" className="text-cyan hover:underline">المصروفات والمصاريف التشغيلية</Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
