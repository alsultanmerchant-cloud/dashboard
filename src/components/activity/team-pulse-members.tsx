import Link from "next/link";
import { ChevronRight, ExternalLink, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { CompareTrendModal } from "@/components/activity/compare-trend-modal";
import type { TeamMemberRow, ActivityStatus, LoadFlag } from "@/lib/data/team-pulse";

const NA = "—";

const STATUS_META: Record<ActivityStatus, { label: string; tone: string; dot: string }> = {
  active: { label: "نشط", tone: "text-cc-green", dot: "bg-cc-green" },
  slow: { label: "بطيء", tone: "text-amber", dot: "bg-amber" },
  stalled: { label: "متوقّف", tone: "text-cc-red", dot: "bg-cc-red" },
};

const LOAD_META: Record<LoadFlag, { label: string; cls: string } | null> = {
  overloaded: { label: "محمّل زائد", cls: "bg-cc-red/10 text-cc-red" },
  light: { label: "سعة متاحة", cls: "bg-soft-2 text-muted-foreground" },
  balanced: null,
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
              {headName ? `يقودها ${headName}` : "بدون مسؤول"} · {members.length} عضو لديه عمل حالي
            </p>
          </div>
          <Link href="/team-activity" className="flex items-center gap-1 text-xs text-cyan hover:underline">
            كل الأقسام
            <ChevronRight className="size-3.5" />
          </Link>
        </div>

        {members.length === 0 ? (
          <div className="p-6">
            <EmptyState
              variant="compact"
              title="لا يوجد أعضاء لديهم عمل حالي في هذا القسم"
              description="يظهر العضو هنا عندما تكون لديه مهام مفتوحة تتحرّك."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">الموظف</th>
                  <th className="px-3 py-2.5 font-medium">الحالة</th>
                  <th className="px-3 py-2.5 font-medium">آخر إجراء</th>
                  <th className="px-3 py-2.5 font-medium text-center">إجراءات اليوم</th>
                  <th className="px-3 py-2.5 font-medium">إجراءات الأسبوع</th>
                  <th className="px-3 py-2.5 font-medium text-center">أُنجزت</th>
                  <th className="px-3 py-2.5 font-medium text-center">مفتوحة</th>
                  <th className="px-3 py-2.5 font-medium text-center">متوقّفة</th>
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
                          {LOAD_META[m.loadFlag] && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-medium",
                                LOAD_META[m.loadFlag]!.cls,
                              )}
                            >
                              {LOAD_META[m.loadFlag]!.label}
                            </span>
                          )}
                        </div>
                        {m.positionLabel && (
                          <div className="text-[10px] text-muted-foreground">{m.positionLabel}</div>
                        )}
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
                      <td
                        className={cn(
                          "px-3 py-2.5 tabular-nums text-center",
                          m.stuckTasks > 0 && "text-cc-red font-semibold",
                        )}
                      >
                        {m.stuckTasks}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-3">
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
