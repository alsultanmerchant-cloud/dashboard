"use client";

// Monthly closing widget for designers.
// The manager picks a month → the URL search param `designerMonth=YYYY-MM`
// updates and the server section re-renders with totals for the chosen
// window. Inline link to /tasks pre-filtered by employee + completion-month.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Palette, RefreshCw, Users } from "lucide-react";
import { useTransition } from "react";

export type DesignerOutputRow = {
  employee_id: string;
  full_name: string;
  job_title: string | null;
  design_total: number;
  revision_total: number;
  task_count: number;
};

function todayYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DesignerMonthlyOutput({
  rows,
  selectedMonth,
}: {
  rows: DesignerOutputRow[];
  selectedMonth: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setMonth(value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete("designerMonth");
    else next.set("designerMonth", value);
    startTransition(() => {
      router.replace(`${path}?${next.toString()}`, { scroll: false });
    });
  }

  const totalDesigns = rows.reduce((s, r) => s + r.design_total, 0);
  const totalRevisions = rows.reduce((s, r) => s + r.revision_total, 0);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-soft/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-cyan" />
          إنتاج المصممين خلال الشهر
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground" htmlFor="designer-month">
            الشهر
          </label>
          <input
            id="designer-month"
            type="month"
            value={selectedMonth || todayYearMonth()}
            onChange={(e) => setMonth(e.target.value)}
            disabled={pending}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
            dir="ltr"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          لا توجد مهام مكتملة بأي عدد تصاميم/تعديلات في هذا الشهر.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 border-b border-soft/40 bg-soft-1/40 px-4 py-2 text-xs">
            <div className="text-muted-foreground">إجمالي التصاميم</div>
            <div className="text-muted-foreground">إجمالي التعديلات</div>
            <div className="text-muted-foreground">عدد الموظفين</div>
            <div className="font-bold tabular-nums">{totalDesigns}</div>
            <div className="font-bold tabular-nums">{totalRevisions}</div>
            <div className="font-bold tabular-nums">{rows.length}</div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-soft-1/20 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">الموظف</th>
                <th className="px-4 py-2 text-start font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Palette className="size-3.5" /> تصاميم
                  </span>
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw className="size-3.5" /> تعديلات
                  </span>
                </th>
                <th className="px-4 py-2 text-start font-medium">عدد المهام</th>
                <th className="px-4 py-2 text-start font-medium">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employee_id} className="border-t border-soft/30">
                  <td className="px-4 py-2">
                    <div className="font-medium">{row.full_name}</div>
                    {row.job_title && (
                      <div className="text-[11px] text-muted-foreground">
                        {row.job_title}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 font-semibold tabular-nums">{row.design_total}</td>
                  <td className="px-4 py-2 font-semibold tabular-nums">{row.revision_total}</td>
                  <td className="px-4 py-2 tabular-nums">{row.task_count}</td>
                  <td className="px-4 py-2 font-bold text-cyan tabular-nums">
                    {row.design_total + row.revision_total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
