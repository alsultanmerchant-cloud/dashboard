import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { EmployeePerfRow } from "@/lib/data/department";

const NA = "—";

function fmtRelative(iso: string | null): string {
  if (!iso) return NA;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  return `قبل ${days} يوم`;
}

function num(v: number | null, suffix = ""): string {
  return v == null ? NA : `${v}${suffix}`;
}

export function EmployeePerformanceTable({ rows }: { rows: EmployeePerfRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState variant="compact" title="لا يوجد أعضاء في الفريق بعد" description="" />
        </CardContent>
      </Card>
    );
  }

  const cols = [
    "الموظف",
    "حضور / تأخير",
    "إنذارات",
    "طلبات",
    "مشاريع",
    "مُسندة",
    "مكتملة",
    "متأخرة",
    "متوسط الإنجاز",
    "الالتزام",
    "تأخّر فرعية",
    "آخر نشاط",
  ];

  return (
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
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-border/50 hover:bg-soft-1">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.fullName}</div>
                    {r.jobTitle && <div className="text-[10px] text-muted-foreground">{r.jobTitle}</div>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.presentDays == null ? NA : (
                      <span>
                        {r.presentDays}
                        {r.lateDays != null && r.lateDays > 0 && (
                          <span className="mr-1 text-amber">/ {r.lateDays} تأخير</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className={cn("px-3 py-2.5 tabular-nums", r.warnings > 0 && "text-amber font-semibold")}>{r.warnings}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.pendingRequests}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.projects}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.assigned}</td>
                  <td className="px-3 py-2.5 tabular-nums text-cc-green">{r.completed}</td>
                  <td className={cn("px-3 py-2.5 tabular-nums", r.overdue > 0 && "text-cc-red font-semibold")}>{r.overdue}</td>
                  <td className="px-3 py-2.5 tabular-nums">{num(r.avgCompletionHours, " س")}</td>
                  <td className={cn("px-3 py-2.5 tabular-nums", r.onTimePct != null && (r.onTimePct >= 85 ? "text-cc-green" : r.onTimePct >= 70 ? "text-amber" : "text-cc-red"))}>
                    {num(r.onTimePct, "%")}
                  </td>
                  <td className={cn("px-3 py-2.5 tabular-nums", r.lateSubtasks > 0 && "text-amber")}>{r.lateSubtasks}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtRelative(r.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
