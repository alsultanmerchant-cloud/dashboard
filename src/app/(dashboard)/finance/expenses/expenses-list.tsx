"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatArabicShortDate } from "@/lib/utils-format";
import {
  EXPENSE_CATEGORY_LABEL,
  type ExpenseCategory,
} from "@/lib/data/expense-categories";
import { loadMoreExpenses } from "./_actions";

type ExpenseRow = {
  id: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  vendor: string | null;
  description: string | null;
  project_id: string | null;
  created_at: string;
};

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(n);

export function ExpensesList({
  initialItems,
  initialNextCursor,
}: {
  initialItems: ExpenseRow[];
  initialNextCursor: { date: string; id: string } | null;
}) {
  const [items, setItems] = useState<ExpenseRow[]>(initialItems);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cursor) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isPending) return;
        startTransition(async () => {
          const page = await loadMoreExpenses(cursor.date, cursor.id);
          setItems((prev) => [...prev, ...page.items]);
          setCursor(page.nextCursor);
        });
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, isPending]);

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-white/[0.04]">
            {items.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {e.vendor || EXPENSE_CATEGORY_LABEL[e.category]}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border border-soft-2 bg-soft-1 px-2 py-0.5">
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
      {cursor && (
        <div
          ref={sentinelRef}
          className="mt-4 flex items-center justify-center py-4 text-xs text-muted-foreground"
        >
          {isPending ? "جاري التحميل..." : "مرّر للأسفل لتحميل المزيد"}
        </div>
      )}
    </>
  );
}
