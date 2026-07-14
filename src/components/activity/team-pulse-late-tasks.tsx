import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import type { PendingLateTaskRow } from "@/lib/data/team-pulse";

const hoursFormatter = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 });

function lateDuration(minutes: number): string {
  const hours = Math.max(1, Math.ceil(minutes / 60));
  return `${hoursFormatter.format(hours)} ساعة عمل`;
}

export function TeamPulseLateTasks({ tasks }: { tasks: PendingLateTaskRow[] }) {
  return (
    <Card id="team-pulse-results" className="mt-6 scroll-mt-6 border-cc-red/30">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4 text-cc-red" aria-hidden="true" />
              المهام المعلّقة المتأخرة
            </p>
            <p className="text-[11px] text-muted-foreground">
              {tasks.length} مهمة فريدة تجاوزت SLA المرحلة الحالية — الأكثر تأخرًا أولًا
            </p>
          </div>
          <Link
            href="/team-activity#team-pulse-results"
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-cyan transition-colors hover:bg-soft-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            عرض كل الموظفين
          </Link>
        </div>

        {tasks.length === 0 ? (
          <div className="p-6">
            <EmptyState
              variant="compact"
              title="لا توجد مهام معلّقة متأخرة"
              description="كل المهام ضمن الزمن المسموح لمرحلتها الحالية."
            />
          </div>
        ) : (
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">المهمة</th>
                  <th className="px-3 py-2.5 font-medium">المشروع</th>
                  <th className="px-3 py-2.5 font-medium">المرحلة</th>
                  <th className="px-3 py-2.5 font-medium">المسؤول الآن</th>
                  <th className="px-3 py-2.5 font-medium">القسم</th>
                  <th className="px-3 py-2.5 text-center font-medium">تجاوز SLA</th>
                  <th className="px-3 py-2.5 font-medium">
                    <span className="sr-only">فتح المهمة</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.taskId} className="border-b border-border/50 hover:bg-soft-1">
                    <td className="max-w-72 px-3 py-2.5">
                      <p className="truncate font-medium">{task.title}</p>
                      {task.taskCode ? (
                        <p className="text-[10px] text-muted-foreground" translate="no">
                          {task.taskCode}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-48 px-3 py-2.5 text-muted-foreground">
                      <span className="block truncate">{task.projectName ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {TASK_STAGE_LABELS[task.stage as TaskStage] ?? task.stage}
                    </td>
                    <td className="max-w-52 px-3 py-2.5">
                      <span className="block truncate">{task.employeeNames.join("، ") || "—"}</span>
                    </td>
                    <td className="max-w-52 px-3 py-2.5 text-muted-foreground">
                      <span className="block truncate">{task.departmentNames.join("، ") || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-cc-red">
                      {lateDuration(task.overdueMinutes)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/tasks/${task.taskId}`}
                        aria-label={`فتح المهمة ${task.title}`}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-cyan transition-colors hover:bg-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
