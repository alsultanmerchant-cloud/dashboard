import { ExternalLink, TrendingUp, TrendingDown, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CompareTrendModal } from "@/components/activity/compare-trend-modal";
import { ActionBreakdownButton } from "@/components/activity/action-breakdown-sheet";
import type { AllMemberRow, ActivityStatus } from "@/lib/data/team-pulse";

const NA = "—";

const STATUS_META: Record<ActivityStatus, { label: string; tone: string; dot: string }> = {
  active: { label: "نشط", tone: "text-cc-green", dot: "bg-cc-green" },
  slow: { label: "بطيء", tone: "text-amber", dot: "bg-amber" },
  stalled: { label: "متوقّف", tone: "text-cc-red", dot: "bg-cc-red" },
};

function relativeDays(iso: string | null): string {
  if (!iso) return NA;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  return `منذ ${days} يوم`;
}

function Momentum({ value }: { value: number }) {
  if (value === 0) return <span className="text-[10px] text-muted-foreground">ثابت</span>;
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px]", up ? "text-cc-green" : "text-cc-red")}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "+" : ""}
      {value}
    </span>
  );
}

// كل الموظفين عبر الأقسام، مرتّبين من الأقل نشاطًا إلى الأكثر — مكان واحد لرصد من
// توقّف في الشركة كلها بدل التنقّل بين الأقسام.
export function TeamPulseAllMembers({ members }: { members: AllMemberRow[] }) {
  return (
    <Card className="mt-6">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-cyan" />
              كل الموظفين — مرتّبون من الأقل نشاطًا
            </p>
            <p className="text-[11px] text-muted-foreground">
              نظرة واحدة على نشاط الفريق بالكامل عبر الأقسام · {members.length} موظف
            </p>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">لا توجد بيانات نشاط بعد.</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">الموظف</th>
                  <th className="px-3 py-2.5 font-medium">القسم</th>
                  <th className="px-3 py-2.5 font-medium">الحالة</th>
                  <th className="px-3 py-2.5 font-medium">آخر إجراء</th>
                  <th className="px-3 py-2.5 font-medium text-center">إجراءات اليوم</th>
                  <th className="px-3 py-2.5 font-medium">إجراءات الأسبوع</th>
                  <th className="px-3 py-2.5 font-medium text-center">أُنجزت</th>
                  <th className="px-3 py-2.5 font-medium text-center">مفتوحة</th>
                  <th className="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const meta = STATUS_META[m.status];
                  return (
                    <tr key={m.employeeId} className="border-b border-border/50 hover:bg-soft-1">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{m.fullName}</span>
                          {m.isLeadership && (
                            <span className="rounded bg-cyan/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan">
                              قيادة
                            </span>
                          )}
                        </div>
                        {m.positionLabel && (
                          <div className="text-[10px] text-muted-foreground">{m.positionLabel}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                        {m.departmentName ?? NA}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("inline-flex items-center gap-1.5 text-xs", meta.tone)}>
                          <span className={cn("size-2 rounded-full", meta.dot)} />
                          {meta.label}
                        </span>
                      </td>
                      <td className={cn("px-3 py-2.5", meta.tone)}>{relativeDays(m.lastActionAt)}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 tabular-nums text-center font-semibold",
                          m.actionsToday > 0 ? "text-cc-green" : "text-muted-foreground",
                        )}
                      >
                        {m.actionsToday}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums">{m.actionsThisWeek}</span>
                          <Momentum value={m.momentum} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-center text-cc-green">
                        {m.completedThisWeek}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-center">{m.openWip}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <ActionBreakdownButton
                            employeeId={m.employeeId}
                            fullName={m.fullName}
                            className="px-2 py-1 text-[11px]"
                          />
                          <CompareTrendModal employeeId={m.employeeId} fullName={m.fullName} />
                          <Link
                            href={`/accountability?emp=${m.employeeId}`}
                            className="flex items-center gap-1 text-cyan hover:underline"
                            title="جودة الالتزام (المساءلة)"
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
