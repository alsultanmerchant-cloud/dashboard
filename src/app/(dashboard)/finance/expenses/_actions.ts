"use server";

import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ExpenseRow } from "@/lib/data/expenses";

const PAGE_SIZE = 20;

export async function loadMoreExpenses(
  beforeDate: string | null,
  beforeId: string | null,
): Promise<{ items: ExpenseRow[]; nextCursor: { date: string; id: string } | null }> {
  const session = await requirePermission("finance.view");

  let q = supabaseAdmin
    .from("expenses")
    .select("id, expense_date, category, amount, vendor, description, project_id, created_at")
    .eq("organization_id", session.orgId)
    .order("expense_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (beforeDate && beforeId) {
    q = q.or(
      `expense_date.lt.${beforeDate},and(expense_date.eq.${beforeDate},id.lt.${beforeId})`,
    );
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as ExpenseRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last
    ? { date: last.expense_date, id: last.id }
    : null;

  return { items, nextCursor };
}
