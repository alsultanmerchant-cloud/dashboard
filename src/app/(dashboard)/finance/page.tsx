"use client";

import { useState, useEffect } from "react";
import type { Deal, Renewal, MonthlyExpense } from "@/types";
import { fetchDeals, fetchRenewals, fetchMonthlyExpenses, createExpense, deleteExpense } from "@/lib/supabase/db";
import { useAuth } from "@/lib/auth-context";
import { useTopbarControls } from "@/components/layout/topbar-context";
import { MONTHS_AR, SOURCE_COLORS } from "@/lib/utils/constants";
import { formatMoney, formatMoneyFull } from "@/lib/utils/format";
import { StatCard } from "@/components/ui/stat-card";
import { DonutChart } from "@/components/ui/donut-chart";
import { BarChart } from "@/components/ui/bar-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Banknote,
  TrendingUp,
  Target,
  BarChart3,
  Plus,
  Trash2,
  Receipt,
} from "lucide-react";

/* CSS variable color → hex for donut chart */
const COLOR_HEX: Record<string, string> = {
  cyan: "#00D4FF",
  "cc-purple": "#8B5CF6",
  "cc-green": "#10B981",
  pink: "#EC4899",
  amber: "#F59E0B",
  "cc-blue": "#3B82F6",
  "muted-foreground": "#64748B",
};

export default function FinancePage() {
  const { activeOrgId: orgId } = useAuth();
  const { activeMonthIndex } = useTopbarControls();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [expenseDialog, setExpenseDialog] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: "", amount: "", description: "", expense_date: "" });
  const [savingExpense, setSavingExpense] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const now = new Date();
  const selectedMonth = activeMonthIndex?.month ?? (now.getMonth() + 1);
  const selectedYear = activeMonthIndex?.year ?? now.getFullYear();

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchDeals(), fetchRenewals(), fetchMonthlyExpenses(selectedMonth, selectedYear)])
      .then(([d, r, e]) => {
        setDeals(d);
        setRenewals(r);
        setExpenses(e);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    setCategoryFilter(null);
  }, [orgId, selectedMonth, selectedYear]);

  async function handleAddExpense() {
    if (!expenseForm.category.trim() || !expenseForm.amount) return;
    setSavingExpense(true);
    try {
      const expDate = expenseForm.expense_date || now.toISOString().split("T")[0];
      const d = new Date(expDate);
      const expMonth = d.getMonth() + 1;
      const expYear = d.getFullYear();
      const created = await createExpense({
        category: expenseForm.category.trim(),
        amount: parseFloat(expenseForm.amount),
        description: expenseForm.description.trim() || undefined,
        expense_date: expDate,
        month: expMonth,
        year: expYear,
      });
      // Only add to current list if it belongs to the selected month
      if (expMonth === selectedMonth && expYear === selectedYear) {
        setExpenses((prev) => [created, ...prev].sort((a, b) => b.amount - a.amount));
      }
      setExpenseForm({ category: "", amount: "", description: "", expense_date: "" });
      setExpenseDialog(false);
    } catch (err) {
      console.error(err);
    }
    setSavingExpense(false);
  }

  async function handleDeleteExpense(id: string) {
    await deleteExpense(id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  /* ─── Helper: match renewal to a month (by month only, ignoring year) ─── */
  function renewalMatchesMonth(r: Renewal, m: number) {
    const rd = new Date(r.renewal_date);
    return rd.getMonth() + 1 === m;
  }

  /* ─── Computed Metrics (filtered by selected month) ─── */
  const monthDeals = deals.filter((d) => d.month === selectedMonth && d.year === selectedYear);
  const closedDeals = monthDeals.filter((d) => d.stage === "مكتملة");
  const salesRevenue = closedDeals.reduce((s, d) => s + d.deal_value, 0);
  const pipelineValue = monthDeals.filter((d) => d.stage !== "مكتملة").reduce((s, d) => s + d.deal_value, 0);

  /* Renewals revenue for the selected month */
  const monthRenewals = renewals.filter((r) => {
    if (r.status !== "مكتمل") return false;
    return renewalMatchesMonth(r, selectedMonth);
  });
  const renewalsRevenue = monthRenewals.reduce((s, r) => s + r.plan_price, 0);

  /* Total revenue = sales + renewals */
  const totalRevenue = salesRevenue + renewalsRevenue;
  const avgDealValue = closedDeals.length > 0 ? Math.round(salesRevenue / closedDeals.length) : 0;

  /* MRR: selected month total revenue */
  const mrr = totalRevenue;
  const arr = mrr * 12;

  /* ─── Monthly Revenue (last 12 months from selected) — sales + renewals ─── */
  const allClosedDeals = deals.filter((d) => d.stage === "مكتملة");
  const completedRenewals = renewals.filter((r) => r.status === "مكتمل");
  const monthlyRevenue = (() => {
    const months: { month: string; salesRev: number; renewalsRev: number; revenue: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(selectedYear, selectedMonth - 1 - i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const sRev = allClosedDeals
        .filter((deal) => deal.month === m && deal.year === y)
        .reduce((s, deal) => s + deal.deal_value, 0);
      const rRev = completedRenewals
        .filter((r) => renewalMatchesMonth(r, m))
        .reduce((s, r) => s + r.plan_price, 0);
      months.push({ month: MONTHS_AR[d.getMonth()], salesRev: sRev, renewalsRev: rRev, revenue: sRev + rRev });
    }
    return months;
  })();

  const maxRevenue = Math.max(...monthlyRevenue.map((m) => m.revenue), 1);
  const useMillions = maxRevenue >= 1_000_000;
  const divisor = useMillions ? 1_000_000 : 1;
  const chartUnit = useMillions ? "مليون ر.س" : "ر.س";

  const barData = monthlyRevenue.map((m) => ({
    label: m.month.slice(0, 3),
    values: [
      { value: m.salesRev / divisor, color: "#00D4FF", label: "مبيعات" },
      { value: m.renewalsRev / divisor, color: "#10B981", label: "تجديدات" },
    ],
  }));

  /* ─── Revenue by Source (donut) — includes renewals as a source ─── */
  const sourceRevenue = (() => {
    const map: Record<string, number> = {};
    closedDeals.forEach((d) => {
      const src = d.source || "اخرى";
      map[src] = (map[src] || 0) + d.deal_value;
    });
    if (renewalsRevenue > 0) {
      map["تجديدات"] = (map["تجديدات"] || 0) + renewalsRevenue;
    }
    return Object.entries(map)
      .map(([source, value]) => ({ source, value }))
      .sort((a, b) => b.value - a.value);
  })();

  const RENEWALS_COLOR = "#10B981";
  const donutSegments = sourceRevenue.map((s) => ({
    label: s.source,
    value: s.value,
    color: s.source === "تجديدات" ? RENEWALS_COLOR : (COLOR_HEX[SOURCE_COLORS[s.source] || "cyan"] || "#00D4FF"),
  }));

  const totalClosedRevenue = sourceRevenue.reduce((s, x) => s + x.value, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-green-dim flex items-center justify-center">
          <Banknote className="w-4 h-4 text-cc-green" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">المالية</h1>
          <p className="text-xs text-muted-foreground">
            مراقبة المؤشرات المالية الرئيسية
          </p>
        </div>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="cc-card rounded-xl p-4">
              <Skeleton className="h-7 w-20 mb-2" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              value={formatMoney(arr)}
              label="ARR السنوي"
              color="cyan"
              icon={<Banknote className="w-4 h-4 text-cyan" />}
            />
            <StatCard
              value={formatMoney(mrr)}
              label="MRR الشهري"
              color="green"
              icon={<TrendingUp className="w-4 h-4 text-cc-green" />}
            />
            <StatCard
              value={formatMoney(totalRevenue)}
              label="إجمالي الإيرادات"
              color="purple"
              icon={<BarChart3 className="w-4 h-4 text-cc-purple" />}
            />
            <StatCard
              value={formatMoney(pipelineValue)}
              label="قيمة خط الأنابيب"
              color="amber"
              icon={<Target className="w-4 h-4 text-amber" />}
            />
          </>
        )}
      </div>

      {/* Two charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly Revenue bar chart */}
        <div className="cc-card rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">
            الإيرادات الشهرية ({chartUnit})
          </h3>
          {loading ? (
            <Skeleton className="h-[280px] w-full rounded-lg" />
          ) : (
            <>
              <BarChart data={barData} height={280} />
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-cyan-dim/30 text-center">
                  <p className="text-lg font-bold text-cyan">
                    {formatMoney(totalRevenue)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    إجمالي الإيرادات
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-green-dim/30 text-center">
                  <p className="text-lg font-bold text-cc-green">
                    {closedDeals.length}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    مبيعات مكتملة
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-purple-dim/30 text-center">
                  <p className="text-lg font-bold text-cc-purple">
                    {formatMoney(avgDealValue)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    متوسط قيمة المبيع
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Revenue by Source donut */}
        <div className="cc-card rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">
            الإيرادات حسب المصدر
          </h3>
          {loading ? (
            <Skeleton className="h-[280px] w-full rounded-lg" />
          ) : donutSegments.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
              لا توجد بيانات
            </div>
          ) : (
            <>
              <DonutChart
                segments={donutSegments}
                centerValue={formatMoney(totalClosedRevenue)}
                centerLabel="إجمالي"
              />
              <div className="mt-4 space-y-2">
                {sourceRevenue.map((s, i) => {
                  const pct = totalClosedRevenue > 0 ? Math.round((s.value / totalClosedRevenue) * 100) : 0;
                  const hex = COLOR_HEX[SOURCE_COLORS[s.source] || "cyan"] || "#00D4FF";
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: hex }}
                        />
                        <span className="text-muted-foreground">{s.source}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">
                          {formatMoney(s.value)}
                        </span>
                        <span className="text-muted-foreground">
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Monthly Expenses Section ─── */}
      <div className="cc-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-cc-red" />
            <h3 className="text-sm font-bold text-foreground">المصاريف الشهرية — {MONTHS_AR[selectedMonth - 1]} {selectedYear}</h3>
          </div>
          <Button size="sm" onClick={() => setExpenseDialog(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> إضافة مصروف
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد مصاريف مسجلة لهذا الشهر</p>
            <p className="text-sm mt-1">أضف أول مصروف لتتبع النفقات</p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
              <div className="p-3 rounded-lg bg-cc-red/10 border border-cc-red/20 text-center">
                <p className="text-xl font-bold text-cc-red">{formatMoney(expenses.reduce((s, e) => s + e.amount, 0))}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">إجمالي المصاريف</p>
              </div>
              <div className="p-3 rounded-lg bg-amber/10 border border-amber/20 text-center">
                <p className="text-xl font-bold text-amber">{expenses.length}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">عدد الأصناف</p>
              </div>
              <div className="p-3 rounded-lg bg-cyan/10 border border-cyan/20 text-center">
                <p className="text-xl font-bold text-cyan">
                  {formatMoney(totalRevenue > 0 ? totalRevenue - expenses.reduce((s, e) => s + e.amount, 0) : 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">صافي الربح</p>
              </div>
            </div>

            {/* Category filter */}
            {(() => {
              const categories = [...new Set(expenses.map((e) => e.category))];
              if (categories.length < 2) return null;
              return (
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      categoryFilter === null
                        ? "bg-cyan/15 text-cyan border-cyan/30"
                        : "bg-white/[0.03] text-muted-foreground border-white/[0.06] hover:border-white/[0.15]"
                    }`}
                  >
                    الكل ({expenses.length})
                  </button>
                  {categories.map((cat) => {
                    const count = expenses.filter((e) => e.category === cat).length;
                    const catTotal = expenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0);
                    return (
                      <button
                        key={cat}
                        onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                          categoryFilter === cat
                            ? "bg-cyan/15 text-cyan border-cyan/30"
                            : "bg-white/[0.03] text-muted-foreground border-white/[0.06] hover:border-white/[0.15]"
                        }`}
                      >
                        {cat} ({count}) — {formatMoney(catTotal)}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Expense items sorted by amount (highest first) */}
            <div className="space-y-2">
              {(() => {
                const filtered = categoryFilter ? expenses.filter((e) => e.category === categoryFilter) : expenses;
                const maxAmount = Math.max(...filtered.map((e) => e.amount), 1);
                const sorted = [...filtered].sort((a, b) => b.amount - a.amount);
                return sorted.map((exp, idx) => {
                  const pct = Math.round((exp.amount / maxAmount) * 100);
                  // Color gradient: top items red → middle amber → bottom green
                  const ratio = sorted.length > 1 ? idx / (sorted.length - 1) : 0;
                  let barColor = "bg-cc-red";
                  let textColor = "text-cc-red";
                  if (ratio > 0.6) {
                    barColor = "bg-cc-green";
                    textColor = "text-cc-green";
                  } else if (ratio > 0.3) {
                    barColor = "bg-amber";
                    textColor = "text-amber";
                  }

                  const totalExp = filtered.reduce((s, e) => s + e.amount, 0);
                  const expPct = totalExp > 0 ? Math.round((exp.amount / totalExp) * 100) : 0;

                  return (
                    <div key={exp.id} className="group relative bg-white/[0.02] rounded-xl p-3 border border-white/[0.06] hover:border-white/[0.1] transition-colors">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`text-xs font-bold ${textColor} w-8 shrink-0`}>#{idx + 1}</span>
                          <span className="text-sm font-semibold text-foreground truncate">{exp.category}</span>
                          {exp.description && (
                            <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">— {exp.description}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground/60 hidden md:inline">{exp.expense_date}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-sm font-bold ${textColor}`}>{formatMoney(exp.amount)}</span>
                          <span className="text-[10px] text-muted-foreground">{expPct}%</span>
                          <button
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-cc-red/10 text-muted-foreground hover:text-cc-red transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Category breakdown donut */}
            {expenses.length >= 2 && (
              <div className="mt-5 pt-5 border-t border-border">
                <h4 className="text-xs font-bold text-muted-foreground mb-3">توزيع المصاريف حسب الصنف</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {(() => {
                    const catMap: Record<string, number> = {};
                    expenses.forEach((e) => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
                    const totalExp = expenses.reduce((s, e) => s + e.amount, 0);
                    const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
                    const catColors = ["#EF4444", "#F59E0B", "#8B5CF6", "#00D4FF", "#10B981", "#EC4899", "#3B82F6"];
                    return cats.map(([cat, val], i) => {
                      const pct = totalExp > 0 ? Math.round((val / totalExp) * 100) : 0;
                      const color = catColors[i % catColors.length];
                      return (
                        <div key={cat} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
                          <div className="w-3 h-3 rounded-full mx-auto mb-1.5" style={{ backgroundColor: color }} />
                          <p className="text-[11px] font-semibold text-foreground truncate">{cat}</p>
                          <p className="text-xs font-bold mt-0.5" style={{ color }}>{formatMoney(val)}</p>
                          <p className="text-[10px] text-muted-foreground">{pct}%</p>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Add Expense Dialog ─── */}
      <Dialog open={expenseDialog} onOpenChange={setExpenseDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة مصروف</DialogTitle>
            <DialogDescription>سجل مصروف جديد وحدد التاريخ</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-1.5">
              <Label>الصنف / الفئة</Label>
              <Input
                value={expenseForm.category}
                onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                placeholder="مثال: رواتب، إيجار، تسويق..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>المبلغ (ر.س)</Label>
              <Input
                type="number"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                placeholder="0"
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>التاريخ</Label>
              <Input
                type="date"
                value={expenseForm.expense_date}
                onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>وصف (اختياري)</Label>
              <Input
                value={expenseForm.description}
                onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                placeholder="تفاصيل إضافية..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseDialog(false)}>إلغاء</Button>
            <Button onClick={handleAddExpense} disabled={savingExpense || !expenseForm.category.trim() || !expenseForm.amount}>
              {savingExpense ? "جاري الحفظ..." : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
