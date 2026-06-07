"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Trophy, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { MonthlyClosingRow, MonthlyClosingResult } from "@/lib/data/department";

const NA = "—";

function num(v: number | null, suffix = ""): string {
  return v == null ? NA : `${v}${suffix}`;
}

function monthLabel(month: string): string {
  // month is YYYY-MM-DD (first of month)
  const d = new Date(`${month}T00:00:00Z`);
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { year: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

export function MonthlyClosing({
  data,
  months,
  selectedMonth,
}: {
  data: MonthlyClosingResult;
  months: string[];
  selectedMonth: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const onMonthChange = (m: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("month", m);
    router.push(`${pathname}?${next.toString()}`);
  };

  const cols = [
    "الموظف",
    "مهام منجزة",
    "تصاميم",
    "مشاريع مكتملة",
    "تأخيرات",
    "تعديلات",
    "متوسط الإنجاز",
    "الالتزام",
    "الهدف",
    "الإنجاز مقابل الهدف",
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">الشهر</label>
          <select
            value={selectedMonth}
            onChange={(e) => onMonthChange(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
          >
            {months.length === 0 && <option value={selectedMonth}>{monthLabel(selectedMonth)}</option>}
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {(data.standouts.length > 0 || data.needsFollowUp.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="border-cc-green/20">
            <CardContent className="p-3">
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-cc-green">
                <Trophy className="size-3.5" /> موظفون مميّزون
              </p>
              {data.standouts.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{NA}</p>
              ) : (
                <ul className="space-y-1">
                  {data.standouts.map((r) => (
                    <li key={r.employeeId} className="flex items-center justify-between text-xs">
                      <span className="truncate">{r.fullName}</span>
                      <span className="tabular-nums text-cc-green">{num(r.achievementPct, "%") }</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="border-cc-red/20">
            <CardContent className="p-3">
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-cc-red">
                <AlertCircle className="size-3.5" /> يحتاجون متابعة
              </p>
              {data.needsFollowUp.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{NA}</p>
              ) : (
                <ul className="space-y-1">
                  {data.needsFollowUp.map((r) => (
                    <li key={r.employeeId} className="flex items-center justify-between text-xs">
                      <span className="truncate">{r.fullName}</span>
                      <span className="tabular-nums text-cc-red">{r.overdueTasks} متأخرة</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {data.rows.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState variant="compact" title="لا توجد بيانات إقفال لهذا الشهر" description="يتم احتساب الإقفال تلقائيًا مطلع كل شهر." />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    {cols.map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: MonthlyClosingRow) => (
                    <tr key={r.employeeId} className="border-b border-border/50 hover:bg-soft-1">
                      <td className="px-3 py-2.5 font-medium">{r.fullName}</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.completedTasks}</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.designsCount}</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.completedProjects}</td>
                      <td className={cn("px-3 py-2.5 tabular-nums", r.overdueTasks > 0 && "text-cc-red")}>{r.overdueTasks}</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.revisionCount}</td>
                      <td className="px-3 py-2.5 tabular-nums">{num(r.avgCompletionHours, " س")}</td>
                      <td className={cn("px-3 py-2.5 tabular-nums", r.onTimePct != null && (r.onTimePct >= 85 ? "text-cc-green" : r.onTimePct >= 70 ? "text-amber" : "text-cc-red"))}>{num(r.onTimePct, "%")}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{num(r.targetCompletedTasks)}</td>
                      <td className={cn("px-3 py-2.5 tabular-nums", r.achievementPct != null && (r.achievementPct >= 100 ? "text-cc-green" : r.achievementPct >= 60 ? "text-amber" : "text-cc-red"))}>{num(r.achievementPct, "%")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
