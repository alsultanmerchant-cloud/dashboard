import {
  Banknote, TrendingUp, TrendingDown, Wallet, ReceiptText,
  AlertTriangle, Calendar,
} from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import {
  getFinanceTotals, getMonthlyFinance, monthBoundsIso, ytdBoundsIso,
} from "@/lib/data/finance";
import {
  listExpenses, getExpenseSummary, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL,
} from "@/lib/data/expenses";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { formatArabicShortDate } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import { NewExpenseDialog } from "./new-expense-dialog";

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(n);

const monthLabel = (ym: string) => {
  // YYYY-MM → readable Arabic month + year
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("ar-SA", { month: "short", year: "2-digit" }).format(d);
};

export default async function FinancePage() {
  const session = await requirePagePermission("finance.view");
  const canManage = hasPermission(session, "finance.manage");

  const monthWin = monthBoundsIso();
  const ytdWin = ytdBoundsIso();

  const [monthTotals, ytdTotals, monthly, recentExpenses, ytdExpenseSummary] =
    await Promise.all([
      getFinanceTotals(session.orgId, monthWin),
      getFinanceTotals(session.orgId, ytdWin),
      getMonthlyFinance(session.orgId, 6),
      listExpenses(session.orgId, { limit: 10 }),
      getExpenseSummary(session.orgId, ytdWin),
    ]);

  // Find max bar height for the trend chart
  const maxBar = Math.max(
    ...monthly.flatMap((m) => [m.revenue, m.expenses]),
    1,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="المالية"
        description="نظرة كاملة على الإيرادات (من العقود) والمصروفات وصافي الربح."
        actions={canManage ? <NewExpenseDialog /> : undefined}
      />

      {/* YTD headline */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إيرادات هذه السنة"
          value={sar(ytdTotals.revenue)}
          hint={`${ytdTotals.receivedCount} دفعة مستلمة`}
          icon={<TrendingUp className="size-5" />}
          tone="success"
        />
        <MetricCard
          label="مصروفات هذه السنة"
          value={sar(ytdTotals.expenses)}
          hint={`${ytdTotals.expenseCount} عملية`}
          icon={<TrendingDown className="size-5" />}
          tone={ytdTotals.expenses > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="صافي الربح هذه السنة"
          value={sar(ytdTotals.net)}
          hint={ytdTotals.net >= 0 ? "ربح" : "خسارة"}
          icon={<Wallet className="size-5" />}
          tone={ytdTotals.net >= 0 ? "success" : "destructive"}
        />
        <MetricCard
          label="ذمم مستحقة"
          value={sar(ytdTotals.receivables)}
          hint="أقساط متأخرة أو حالّة"
          icon={<AlertTriangle className="size-5" />}
          tone={ytdTotals.receivables > 0 ? "warning" : "default"}
        />
      </div>

      {/* This month */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-2">
            <Calendar className="size-4 text-cyan" />
            <p className="text-sm font-semibold">أداء الشهر الحالي</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">إيرادات</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-cc-green">
                {sar(monthTotals.revenue)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">مصروفات</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber">
                {sar(monthTotals.expenses)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">صافي</p>
              <p className={cn(
                "mt-1 text-2xl font-bold tabular-nums",
                monthTotals.net >= 0 ? "text-cc-green" : "text-cc-red",
              )}>
                {sar(monthTotals.net)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 6-month trend */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-4 text-sm font-semibold">الإيرادات والمصروفات — آخر 6 أشهر</p>
          <div className="flex items-end justify-between gap-2 h-40">
            {monthly.map((m) => {
              const revH = (m.revenue / maxBar) * 100;
              const expH = (m.expenses / maxBar) * 100;
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full items-end justify-center gap-1 h-32">
                    <div
                      className="w-3 rounded-t bg-cc-green/70 transition-all"
                      style={{ height: `${revH}%` }}
                      title={`إيرادات: ${sar(m.revenue)}`}
                    />
                    <div
                      className="w-3 rounded-t bg-amber/70 transition-all"
                      style={{ height: `${expH}%` }}
                      title={`مصروفات: ${sar(m.expenses)}`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {monthLabel(m.month)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-cc-green/70" /> إيرادات
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-amber/70" /> مصروفات
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Expense category breakdown */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-4 text-sm font-semibold">المصروفات حسب الفئة (هذه السنة)</p>
          {ytdExpenseSummary.totalAmount === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مصروفات مسجّلة هذه السنة بعد.</p>
          ) : (
            <div className="space-y-2">
              {EXPENSE_CATEGORIES
                .map((c) => ({
                  cat: c,
                  ...ytdExpenseSummary.byCategory[c],
                }))
                .filter((r) => r.total > 0)
                .sort((a, b) => b.total - a.total)
                .map((r) => {
                  const pct = (r.total / ytdExpenseSummary.totalAmount) * 100;
                  return (
                    <div key={r.cat} className="flex items-center gap-3">
                      <div className="w-32 shrink-0 text-xs">
                        {EXPENSE_CATEGORY_LABEL[r.cat]}
                      </div>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                        <div
                          className="absolute inset-y-0 right-0 bg-amber/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-24 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                        {sar(r.total)}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent expenses */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <ReceiptText className="size-4" />
          آخر المصروفات
        </h2>
        {recentExpenses.length === 0 ? (
          <EmptyState
            icon={<Banknote className="size-6" />}
            title="لا توجد مصروفات"
            description="ابدأ بتسجيل أول مصروف لتظهر التقارير المالية."
            action={canManage ? <NewExpenseDialog /> : undefined}
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-white/[0.04]">
                {recentExpenses.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {e.vendor || EXPENSE_CATEGORY_LABEL[e.category]}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5">
                          {EXPENSE_CATEGORY_LABEL[e.category]}
                        </span>
                        <span dir="ltr" className="tabular-nums">
                          {formatArabicShortDate(e.expense_date)}
                        </span>
                        {e.description && (
                          <span className="truncate">· {e.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-sm font-semibold tabular-nums text-amber">
                        {sar(Number(e.amount))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
