import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Wallet, TrendingUp, ReceiptText,
  CircleCheck, RefreshCw, PauseCircle, Users, Sparkles,
  XCircle, Award, ArrowUp,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getCeoDashboardData, currentMonthIso,
  type ContractTypeKey,
} from "@/lib/data/ceo-dashboard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MonthSelector } from "./month-selector";

const formatMoney = (n: number, locale: string) =>
  new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: 0 }).format(n);

function monthLabel(monthIso: string, locale: string) {
  const [year, month] = monthIso.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    month: "long",
    year: "numeric",
  });
}

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
    default: "border-soft-2 bg-card/60",
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
        isHeader && "border-b border-soft-2 pb-2 mb-1",
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
  // Financial P&L (income, targets, expenses) is CEO-tier data: gate on
  // finance.view, not contract.view (which only grants the contracts roster).
  const session = await requirePagePermission("finance.view");
  const t = await getTranslations("FinancePage");
  const locale = await getLocale();
  const sp = await searchParams;
  const monthIso = sp.month && /^\d{4}-\d{2}$/.test(sp.month)
    ? sp.month
    : currentMonthIso();

  const data = await getCeoDashboardData(session.orgId, monthIso);
  const { today, movement, income, account, sales } = data;
  const monthText = monthLabel(monthIso, locale);
  const currency = locale === "ar" ? "ر.س" : "SAR";

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
        title={t("title")}
        description={t("description")}
        actions={
          <Link
            href="/finance/expenses"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-soft-2 bg-card/60 px-3 text-xs font-medium hover:bg-soft-2 transition-colors"
          >
            <ReceiptText className="size-4" />
            {t("expenses")}
          </Link>
        }
      />

      {/* ============ Section 1: Today's Client Status ============ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t("todayStatus.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("todayStatus.description")}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile
            label={t("todayStatus.newContracts")}
            value={today.newContracts}
            tone="info"
            icon={<Sparkles className="size-4" />}
          />
          <StatTile
            label={t("todayStatus.renewing")}
            value={today.renewing}
            tone="success"
            icon={<RefreshCw className="size-4" />}
          />
          <StatTile
            label={t("todayStatus.hold")}
            value={today.hold}
            tone="warning"
            icon={<PauseCircle className="size-4" />}
          />
          <StatTile
            label={t("todayStatus.totalClients")}
            value={today.totalClients}
            tone="default"
            icon={<Users className="size-4" />}
          />
          <StatTile
            label={t("todayStatus.upsell")}
            value={today.upsell}
            tone="purple"
            icon={<Award className="size-4" />}
          />
          <StatTile
            label={t("todayStatus.winBack")}
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
            <h2 className="text-base font-semibold">{t("monthMovement.title", { month: monthText })}</h2>
            <p className="text-xs text-muted-foreground">{t("monthMovement.description")}</p>
          </div>
          <MonthSelector monthIso={monthIso} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {movementOrder.map(({ key, tone, icon }) => (
            <StatTile
              key={key}
              label={t(`contractTypes.${key}`)}
              value={movement.byType[key].count}
              hint={movement.byType[key].value > 0 ? `${formatMoney(movement.byType[key].value, locale)} ${currency}` : undefined}
              tone={tone}
              icon={icon}
            />
          ))}
        </div>
      </section>

      {/* ============ Section 3: Company Income ============ */}
      <section>
        <h2 className="mb-3 text-base font-semibold">
          {t("income.title", { month: monthText })}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="border-cyan/20">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("income.expected")}
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-cyan">
                    {formatMoney(income.expected, locale)} <span className="text-base text-muted-foreground">{currency}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("income.expectedHint", { count: income.expectedCount })}
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
                    {t("income.actual")}
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-cc-green">
                    {formatMoney(income.actual, locale)} <span className="text-base text-muted-foreground">{currency}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("income.actualHint", { count: income.actualCount })}
                  </p>
                </div>
                <Wallet className="size-6 text-cc-green" />
              </div>
              {income.expected > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 w-full rounded-full bg-soft-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-cc-green to-cyan"
                      style={{
                        width: `${Math.min(100, (income.actual / income.expected) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                    {t("income.ofExpected", { count: Math.round((income.actual / income.expected) * 100) })}
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
          <h2 className="text-base font-semibold">{t("account.title", { month: monthText })}</h2>
          <p className="text-xs text-muted-foreground">
            {t("account.description")}
          </p>
        </div>

        {/* Target overview row */}
        <Card className="mb-3">
          <CardContent className="p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("account.countOverview")}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatTile label={t("account.salesDeposit")} value={account.salesDeposit} />
              <StatTile label={t("account.onTarget")} value={account.onTarget} tone="success" />
              <StatTile label={t("account.overdue")} value={account.overdue} tone="destructive" />
              <StatTile
                label={t("account.expectedAll")}
                value={account.expectedOnPlusOverdue}
                hint={t("account.expectedAllHint")}
              />
              <StatTile
                label={t("account.afterRenewed")}
                value={account.expectedRemovingRenewed}
                hint={t("account.afterRenewedHint")}
                tone="warning"
              />
              <StatTile
                label={t("account.actualAchieved")}
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
              <MoneyRow label={t("account.expectedHeader")} value="" isHeader />
              <MoneyRow
                label={t("account.overdueInstallmentsAdded")}
                value={`${formatMoney(account.overdueInstallmentsAmount, locale)} ${currency}`}
              />
              <MoneyRow
                label={t("account.thisMonthInstallments")}
                value={`${formatMoney(account.installmentsAmount, locale)} ${currency}`}
              />
              <MoneyRow
                label={t("account.onTargetClients")}
                value={`${formatMoney(account.onTargetClientsAmount, locale)} ${currency}`}
              />
              <MoneyRow
                label={t("account.overdueClients")}
                value={`${formatMoney(account.overdueClientsAmount, locale)} ${currency}`}
              />
              <MoneyRow
                label={t("account.totalExpected")}
                value={`${formatMoney(account.totalExpected, locale)} ${currency}`}
                isBig
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label={t("account.actualHeader")} value="" isHeader />
              <MoneyRow
                label={t("account.collectedOverdueInstallments")}
                value={`${formatMoney(account.actualOverdueInstallments, locale)} ${currency}`}
                tone="success"
              />
              <MoneyRow
                label={t("account.thisMonthInstallments")}
                value={`${formatMoney(account.actualInstallments, locale)} ${currency}`}
                tone="success"
              />
              <MoneyRow
                label={t("account.upsell")}
                value={`${formatMoney(account.upsellAcc, locale)} ${currency}`}
                tone="success"
              />
              <MoneyRow
                label={t("account.winBack")}
                value={`${formatMoney(account.winBackAcc, locale)} ${currency}`}
                tone="success"
              />
              <MoneyRow
                label={t("account.totalIncome")}
                value={`${formatMoney(account.totalIncomeFromAccount, locale)} ${currency}`}
                isBig
                tone="success"
              />
              <div className="pt-2 mt-2 border-t border-soft-2">
                <MoneyRow
                  label={t("account.achievement")}
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
                  label={t("account.revenueGap")}
                  value={`${formatMoney(account.revenueGap, locale)} ${currency}`}
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
          <h2 className="text-base font-semibold">{t("sales.title", { month: monthText })}</h2>
          <p className="text-xs text-muted-foreground">
            {t("sales.description")}
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label={t("sales.expectedHeader")} value="" isHeader />
              <MoneyRow
                label={t("sales.overdueInstallments")}
                value={`${formatMoney(sales.overdueInstallments, locale)} ${currency}`}
                tone="warning"
              />
              <MoneyRow
                label={t("sales.thisMonthInstallments")}
                value={`${formatMoney(sales.expectedInstallments, locale)} ${currency}`}
              />
              <MoneyRow
                label={t("sales.totalExpected")}
                value={`${formatMoney(sales.totalExpectedFromInstallments, locale)} ${currency}`}
                isBig
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1.5">
              <MoneyRow label={t("sales.actualHeader")} value="" isHeader />
              <MoneyRow
                label={t("sales.collectedInstallments")}
                value={`${formatMoney(sales.actualInstallments, locale)} ${currency}`}
                tone="success"
              />
              <MoneyRow
                label={t("sales.newClientIncome")}
                value={`${formatMoney(sales.actualIncomeFromNewClients, locale)} ${currency}`}
                tone="success"
              />
              <MoneyRow
                label={t("sales.totalIncome")}
                value={`${formatMoney(sales.totalIncomeFromSales, locale)} ${currency}`}
                isBig
                tone="success"
              />
              <div className="pt-2 mt-2 border-t border-soft-2">
                <MoneyRow
                  label={t("sales.collectionRate")}
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
                  label={t("sales.gap")}
                  value={`${formatMoney(sales.gap, locale)} ${currency}`}
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
            <p className="font-semibold mb-1">{t("help.title")}</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>{t("help.items.todayStatus")}</li>
              <li>{t("help.items.monthMovement")}</li>
              <li>{t("help.items.actualIncome")}</li>
              <li>{t("help.items.departments")}</li>
            </ul>
            <p className="mt-2 text-[11px]">
              <Link href="/contracts" className="text-cyan hover:underline">{t("help.contracts")}</Link>
              {" · "}
              <Link href="/finance/expenses" className="text-cyan hover:underline">{t("help.expenses")}</Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
