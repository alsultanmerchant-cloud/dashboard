import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { getMyMonthlyClosing, type MyMonthlyRow } from "@/lib/data/my-performance";

// Calendar-month performance history (frozen closing). Extracted from the old
// /my-performance page so it can live in the agent dashboard ("لوحتي").

const NA = "—";

function pctTone(v: number | null, good = 85, mid = 70): string {
  if (v == null) return "text-muted-foreground";
  if (v >= good) return "text-cc-green";
  if (v >= mid) return "text-amber";
  return "text-cc-red";
}

function fmtMonth(iso: string): string {
  return iso.slice(0, 7);
}

function MonthlyTable({
  rows,
  labels,
}: {
  rows: MyMonthlyRow[];
  labels: {
    month: string;
    completed: string;
    onTime: string;
    overdue: string;
    revisions: string;
    designs: string;
    achievement: string;
    noTarget: string;
  };
}) {
  const maxCompleted = Math.max(...rows.map((r) => r.completedTasks), 1);
  const cols = [
    labels.month,
    labels.completed,
    labels.onTime,
    labels.overdue,
    labels.revisions,
    labels.designs,
    labels.achievement,
  ];
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                {cols.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.month} className="border-b border-border/50 hover:bg-soft-1">
                  <td className="px-3 py-2.5 font-medium tabular-nums ltr:text-left">
                    {fmtMonth(r.month)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{r.completedTasks}</span>
                      <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-soft-2 sm:block">
                        <span
                          className="block h-full bg-cc-green/50"
                          style={{ width: `${(r.completedTasks / maxCompleted) * 100}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className={cn("px-3 py-2.5 tabular-nums", pctTone(r.onTimePct))}>
                    {r.onTimePct == null ? NA : `${Math.round(r.onTimePct)}%`}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 tabular-nums",
                      r.overdueTasks > 0 && "font-semibold text-cc-red",
                    )}
                  >
                    {r.overdueTasks}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{r.revisionCount}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.designsCount}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.achievementPct == null ? (
                      <span className="text-muted-foreground">{labels.noTarget}</span>
                    ) : (
                      <span className={pctTone(r.achievementPct, 100, 70)}>
                        {Math.round(r.achievementPct)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export async function MonthlyHistorySection({
  orgId,
  employeeId,
}: {
  orgId: string;
  employeeId: string;
}) {
  const [rows, t] = await Promise.all([
    getMyMonthlyClosing(orgId, employeeId),
    getTranslations("MyPerformance"),
  ]);
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState variant="compact" title={t("monthly.empty")} description="" />
        </CardContent>
      </Card>
    );
  }
  return (
    <MonthlyTable
      rows={rows}
      labels={{
        month: t("monthly.month"),
        completed: t("monthly.completed"),
        onTime: t("monthly.onTime"),
        overdue: t("monthly.overdue"),
        revisions: t("monthly.revisions"),
        designs: t("monthly.designs"),
        achievement: t("monthly.achievement"),
        noTarget: t("monthly.noTarget"),
      }}
    />
  );
}
