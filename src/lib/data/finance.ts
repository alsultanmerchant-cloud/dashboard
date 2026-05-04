import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Revenue is derived from received installments — the moment money actually
// lands in the agency's account, not when the contract was signed. Pending
// installments are tracked separately as receivables.

export interface FinanceWindow {
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
}

export interface FinanceTotals {
  revenue: number;       // sum of installments where actual_date in window
  expenses: number;      // sum of expenses where expense_date in window
  net: number;           // revenue - expenses
  receivables: number;   // sum of pending installments with expected_date <= today
  receivedCount: number;
  expenseCount: number;
}

export async function getFinanceTotals(
  orgId: string,
  win: FinanceWindow,
): Promise<FinanceTotals> {
  const today = new Date().toISOString().slice(0, 10);

  const [recv, exp, recvAll] = await Promise.all([
    // Received revenue in window
    supabaseAdmin
      .from("installments")
      .select("actual_amount, status")
      .eq("organization_id", orgId)
      .in("status", ["received", "partial"])
      .gte("actual_date", win.from)
      .lte("actual_date", win.to),

    // Expenses in window
    supabaseAdmin
      .from("expenses")
      .select("amount")
      .eq("organization_id", orgId)
      .gte("expense_date", win.from)
      .lte("expense_date", win.to),

    // Outstanding receivables (overdue + currently due)
    supabaseAdmin
      .from("installments")
      .select("expected_amount, actual_amount, status")
      .eq("organization_id", orgId)
      .in("status", ["pending", "overdue", "partial"])
      .lte("expected_date", today),
  ]);

  if (recv.error) throw recv.error;
  if (exp.error) throw exp.error;
  if (recvAll.error) throw recvAll.error;

  let revenue = 0;
  let receivedCount = 0;
  for (const r of recv.data ?? []) {
    revenue += Number(r.actual_amount) || 0;
    receivedCount += 1;
  }

  let expenses = 0;
  let expenseCount = 0;
  for (const r of exp.data ?? []) {
    expenses += Number(r.amount) || 0;
    expenseCount += 1;
  }

  let receivables = 0;
  for (const r of recvAll.data ?? []) {
    const expected = Number(r.expected_amount) || 0;
    const received = Number(r.actual_amount) || 0;
    receivables += Math.max(0, expected - received);
  }

  return {
    revenue,
    expenses,
    net: revenue - expenses,
    receivables,
    receivedCount,
    expenseCount,
  };
}

export interface MonthlyFinance {
  month: string;   // YYYY-MM
  revenue: number;
  expenses: number;
  net: number;
}

export async function getMonthlyFinance(
  orgId: string,
  months = 6,
): Promise<MonthlyFinance[]> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const startIso = start.toISOString().slice(0, 10);

  const [recv, exp] = await Promise.all([
    supabaseAdmin
      .from("installments")
      .select("actual_date, actual_amount")
      .eq("organization_id", orgId)
      .in("status", ["received", "partial"])
      .gte("actual_date", startIso),
    supabaseAdmin
      .from("expenses")
      .select("expense_date, amount")
      .eq("organization_id", orgId)
      .gte("expense_date", startIso),
  ]);
  if (recv.error) throw recv.error;
  if (exp.error) throw exp.error;

  const buckets = new Map<string, { revenue: number; expenses: number }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    buckets.set(d.toISOString().slice(0, 7), { revenue: 0, expenses: 0 });
  }

  for (const r of recv.data ?? []) {
    const m = String(r.actual_date ?? "").slice(0, 7);
    const b = buckets.get(m);
    if (b) b.revenue += Number(r.actual_amount) || 0;
  }
  for (const r of exp.data ?? []) {
    const m = String(r.expense_date ?? "").slice(0, 7);
    const b = buckets.get(m);
    if (b) b.expenses += Number(r.amount) || 0;
  }

  return Array.from(buckets.entries())
    .map(([month, v]) => ({ month, revenue: v.revenue, expenses: v.expenses, net: v.revenue - v.expenses }))
    .reverse();
}

export function monthBoundsIso(ref = new Date()): FinanceWindow {
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

export function ytdBoundsIso(ref = new Date()): FinanceWindow {
  const first = new Date(ref.getFullYear(), 0, 1);
  return {
    from: first.toISOString().slice(0, 10),
    to: ref.toISOString().slice(0, 10),
  };
}
