import Link from "next/link";
import {
  ChevronRight,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  GitBranch,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { riyadhDateOf, riyadhTodayIso, riyadhDaysAgoIso } from "@/lib/tz";
import { CompareTrendModal } from "@/components/activity/compare-trend-modal";
import { ActionBreakdownButton } from "@/components/activity/action-breakdown-sheet";
import type { TeamMemberRow, ActivityStatus, LoadFlag } from "@/lib/data/team-pulse";

const NA = "—";

const STATUS_META: Record<ActivityStatus, { label: string; tone: string; dot: string }> = {
  active: { label: "نشط", tone: "text-cc-green", dot: "bg-cc-green" },
  slow: { label: "خامل", tone: "text-amber", dot: "bg-amber" },
  stalled: { label: "غير نشط", tone: "text-cc-red", dot: "bg-cc-red" },
};

// إجراءات اليوم, broken into "how many stage moves" vs "how many Log Notes".
function ActionsSplit({ moves, notes }: { moves: number; notes: number }) {
  const total = moves + notes;
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2.5 tabular-nums",
        total > 0 ? "text-cc-green" : "text-muted-foreground",
      )}
    >
      <span className="inline-flex items-center gap-0.5" title="نقل مراحل">
        <GitBranch className="size-3" />
        {moves}
      </span>
      <span
        className="inline-flex items-center gap-0.5"
        title="سجل العمل: ملاحظات (كومنت) + إنشاء مهام + إسناد وتعديلات"
      >
        <MessageSquare className="size-3" />
        {notes}
      </span>
    </div>
  );
}

// أُنجزت, split into today vs this week.
function CompletedSplit({ today, week }: { today: number; week: number }) {
  return (
    <div className="flex flex-col items-center leading-tight tabular-nums">
      <span className="font-semibold text-cc-green">
        {today}
        <span className="text-[9px] font-normal text-muted-foreground"> اليوم</span>
      </span>
      <span className="text-[10px] text-muted-foreground">{week} الأسبوع</span>
    </div>
  );
}

// مُعلقة — tasks whose current stage the person OWNS: how many have breached
// their STAGE SLA (sat in the current stage longer than that stage's allowance,
// red) out of the total on their desk. "Late" = per-stage SLA, NOT the ordinary
// task-deadline overdue; only the 5 SLA-configured stages can be late.
function PendingCell({ late, owned }: { late: number; owned: number }) {
  if (owned === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-center leading-tight tabular-nums">
      <span className={cn("font-semibold", late > 0 ? "text-cc-red" : "text-muted-foreground")}>
        {late}
        <span className="text-[9px] font-normal text-muted-foreground"> متأخرة</span>
      </span>
      <span className="text-[10px] text-muted-foreground">{owned} على مكتبه</span>
    </div>
  );
}

const LOAD_META: Record<LoadFlag, { label: string; cls: string } | null> = {
  overloaded: { label: "محمّل زائد", cls: "bg-cc-red/10 text-cc-red" },
  light: { label: "سعة متاحة", cls: "bg-soft-2 text-muted-foreground" },
  balanced: null,
};

// Riyadh CALENDAR-day relative label — consistent with the status column, so a
// yesterday-evening action reads "أمس" (not "اليوم" from a rolling-24h floor).
function relativeDays(iso: string | null): string {
  if (!iso) return NA;
  const d = riyadhDateOf(iso);
  const today = riyadhTodayIso();
  if (d >= today) return "اليوم";
  if (d === riyadhDaysAgoIso(1)) return "أمس";
  const days = Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
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
                  <th
                    className="px-3 py-2.5 font-medium text-center"
                    title="كل الإجراءات التي قام بها الموظف نفسه اليوم في رواسم — نقل المراحل + سجل العمل (ملاحظات + إنشاء مهام + إسناد وتعديلات). منسوبة لفاعلها الحقيقي، لا لكل المكلّفين بالمهمة"
                  >
                    إجراءات اليوم
                  </th>
                  <th className="px-3 py-2.5 font-medium">إجراءات الأسبوع</th>
                  <th
                    className="px-3 py-2.5 font-medium text-center"
                    title="المهام التي أنهاها اليوم / خلال هذا الأسبوع"
                  >
                    أُنجزت
                  </th>
                  <th className="px-3 py-2.5 font-medium text-center">مفتوحة</th>
                  <th
                    className="px-3 py-2.5 font-medium text-center"
                    title="المهام التي يملك مرحلتها الحالية (على مكتبه الآن) — كم منها تجاوز زمن SLA لمرحلته الحالية (متأخرة) من إجمالي ما على مكتبه. يُقاس التأخّر بحسب SLA المرحلة لا بموعد المهمة، وتُحتسب فقط المراحل الخمس التي لها SLA."
                  >
                    مُعلقة
                  </th>
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
                          {LOAD_META[m.loadFlag] && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-medium",
                                LOAD_META[m.loadFlag]!.cls,
                              )}
                              title={`${m.activeProjects} مشروع نشط على مكتبه`}
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
                      <td className="px-3 py-2.5">
                        <ActionsSplit moves={m.movesToday} notes={m.notesToday} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums">{m.actionsThisWeek}</span>
                          <Momentum value={m.momentum} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <CompletedSplit today={m.completedToday} week={m.completedThisWeek} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-center">{m.openWip}</td>
                      <td className="px-3 py-2.5 text-center">
                        <PendingCell late={m.pendingLate} owned={m.ownedOpen} />
                      </td>
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
