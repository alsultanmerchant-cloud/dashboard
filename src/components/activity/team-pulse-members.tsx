import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { gradeFor } from "@/lib/data/executive-scores";
import { CompareTrendModal } from "@/components/activity/compare-trend-modal";
import type { TeamMemberRow } from "@/lib/data/team-pulse";

const NA = "—";
const pct = (v: number | null): string => (v == null ? NA : `${v}%`);

function scoreTone(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 75) return "text-cc-green";
  if (v >= 60) return "text-amber";
  return "text-cc-red";
}

function fmtDwell(min: number | null): string {
  if (min == null) return NA;
  const h = min / 60;
  if (h < 1) return `${Math.round(min)}د`;
  if (h < 24) return `${Math.round(h)}س`;
  return `${Math.round(h / 8)}ي عمل`;
}

export function TeamPulseMembers({
  departmentName,
  headName,
  members,
}: {
  departmentName: string;
  headName: string | null;
  members: TeamMemberRow[];
}) {
  return (
    <Card className="mb-4 border-cyan/30">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{departmentName}</p>
            <p className="text-[11px] text-muted-foreground">
              {headName ? `يقودها ${headName}` : "بدون مسؤول"} · {members.length} عضو مُقاس
            </p>
          </div>
          <Link
            href="/team-activity"
            className="flex items-center gap-1 text-xs text-cyan hover:underline"
          >
            كل الأقسام
            <ChevronRight className="size-3.5" />
          </Link>
        </div>

        {members.length === 0 ? (
          <div className="p-6">
            <EmptyState
              variant="compact"
              title="لا يوجد أعضاء مُقاسون في هذا القسم"
              description="الأعضاء يظهرون عند توفر سجل مراحل كافٍ لقياس أدائهم."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">الموظف</th>
                  <th className="px-3 py-2.5 font-medium">النتيجة</th>
                  <th className="px-3 py-2.5 font-medium">الالتزام بالموعد</th>
                  <th className="px-3 py-2.5 font-medium text-center">مفتوحة</th>
                  <th className="px-3 py-2.5 font-medium text-center">متأخرة</th>
                  <th className="px-3 py-2.5 font-medium text-center">متوسط المكوث</th>
                  <th className="px-3 py-2.5 font-medium text-center">ارتدادات</th>
                  <th className="px-3 py-2.5 font-medium">الإنجاز مقابل الهدف</th>
                  <th className="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const grade = m.score != null ? gradeFor(m.score) : null;
                  return (
                    <tr key={m.employeeId} className="border-b border-border/50 hover:bg-soft-1">
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{m.fullName}</div>
                        {m.positionLabel && (
                          <div className="text-[10px] text-muted-foreground">{m.positionLabel}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-base font-bold tabular-nums", scoreTone(m.score))}>
                            {m.score ?? NA}
                          </span>
                          {grade && (
                            <span className="rounded border border-border px-1.5 text-[10px] font-semibold">
                              {grade}
                            </span>
                          )}
                          {m.confidence === "low" && (
                            <span className="text-[9px] text-amber" title="عينة محدودة">
                              ~
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={cn("px-3 py-2.5 tabular-nums", scoreTone(m.onTimeRate))}>
                        {pct(m.onTimeRate)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-center">{m.openTasks}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 tabular-nums text-center",
                          m.overdueOwned > 0 && "text-cc-red font-semibold",
                        )}
                      >
                        {m.overdueOwned}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-center text-muted-foreground">
                        {fmtDwell(m.avgDwellBusinessMinutes)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 tabular-nums text-center",
                          m.reworkReturns30d > 0 && "text-amber",
                        )}
                      >
                        {m.reworkReturns30d}
                      </td>
                      <td className="px-3 py-2.5">
                        {m.commAttainmentPct == null ? (
                          <span className="text-muted-foreground">{NA}</span>
                        ) : (
                          <span
                            className={cn(
                              "tabular-nums font-semibold",
                              m.commAttainmentPct >= 90
                                ? "text-cc-green"
                                : m.commAttainmentPct >= 70
                                  ? "text-amber"
                                  : "text-cc-red",
                            )}
                          >
                            {m.commAttainmentPct}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-3">
                          <CompareTrendModal
                            employeeId={m.employeeId}
                            fullName={m.fullName}
                          />
                          <Link
                            href={`/accountability?emp=${m.employeeId}`}
                            className="flex items-center gap-1 text-cyan hover:underline"
                            title="عرض الأدلة التفصيلية"
                          >
                            <ExternalLink className="size-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
