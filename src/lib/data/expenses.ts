import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "./expense-categories";

// Re-export so existing server-side imports keep working.
export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
} from "./expense-categories";
export type { ExpenseCategory } from "./expense-categories";

export interface ExpenseRow {
  id: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  vendor: string | null;
  description: string | null;
  project_id: string | null;
  created_at: string;
}

export async function listExpenses(
  orgId: string,
  opts: { limit?: number; from?: string; to?: string } = {},
): Promise<ExpenseRow[]> {
  let q = supabaseAdmin
    .from("expenses")
    .select("id, expense_date, category, amount, vendor, description, project_id, created_at")
    .eq("organization_id", orgId)
    .order("expense_date", { ascending: false });

  if (opts.from) q = q.gte("expense_date", opts.from);
  if (opts.to) q = q.lte("expense_date", opts.to);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExpenseRow[];
}

export interface ExpenseSummary {
  totalAmount: number;
  count: number;
  byCategory: Record<ExpenseCategory, { count: number; total: number }>;
}

export async function getExpenseSummary(
  orgId: string,
  opts: { from?: string; to?: string } = {},
): Promise<ExpenseSummary> {
  let q = supabaseAdmin
    .from("expenses")
    .select("category, amount")
    .eq("organization_id", orgId);
  if (opts.from) q = q.gte("expense_date", opts.from);
  if (opts.to) q = q.lte("expense_date", opts.to);
  const { data, error } = await q;
  if (error) throw error;

  const byCategory = Object.fromEntries(
    EXPENSE_CATEGORIES.map((c) => [c, { count: 0, total: 0 }]),
  ) as Record<ExpenseCategory, { count: number; total: number }>;

  let totalAmount = 0;
  let count = 0;
  for (const row of data ?? []) {
    const cat = row.category as ExpenseCategory;
    const amt = Number(row.amount) || 0;
    byCategory[cat].count += 1;
    byCategory[cat].total += amt;
    totalAmount += amt;
    count += 1;
  }

  return { totalAmount, count, byCategory };
}

export async function getMonthlyExpenseTrend(
  orgId: string,
  months = 6,
): Promise<{ month: string; total: number }[]> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const startIso = start.toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select("expense_date, amount")
    .eq("organization_id", orgId)
    .gte("expense_date", startIso);
  if (error) throw error;

  // Bucket by YYYY-MM
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    buckets.set(d.toISOString().slice(0, 7), 0);
  }
  for (const row of data ?? []) {
    const m = String(row.expense_date).slice(0, 7);
    if (buckets.has(m)) {
      buckets.set(m, (buckets.get(m) ?? 0) + (Number(row.amount) || 0));
    }
  }

  return Array.from(buckets.entries())
    .map(([month, total]) => ({ month, total }))
    .reverse();
}

export interface NewExpenseInput {
  expense_date: string;       // YYYY-MM-DD
  category: ExpenseCategory;
  amount: number;
  vendor?: string | null;
  description?: string | null;
  project_id?: string | null;
}

export async function createExpense(
  orgId: string,
  userId: string,
  input: NewExpenseInput,
): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .insert({
      organization_id: orgId,
      created_by: userId,
      expense_date: input.expense_date,
      category: input.category,
      amount: input.amount,
      vendor: input.vendor ?? null,
      description: input.description ?? null,
      project_id: input.project_id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}
