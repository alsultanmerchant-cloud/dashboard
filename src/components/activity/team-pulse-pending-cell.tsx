"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import type { PendingLateTaskRow } from "@/lib/data/team-pulse";
import { TeamPulseOwnedTasksModal } from "@/components/activity/team-pulse-owned-tasks-modal";

const numberFormatter = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 });
const riyadhDateTimeFormatter = new Intl.DateTimeFormat("ar-SA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${numberFormatter.format(remainder)} دقيقة`;
  if (remainder === 0) return `${numberFormatter.format(hours)} ساعة`;
  return `${numberFormatter.format(hours)} ساعة و${numberFormatter.format(remainder)} دقيقة`;
}

function formatStageEnteredAt(iso: string | null): string {
  if (!iso) return "—";
  return riyadhDateTimeFormatter.format(new Date(iso));
}

const SLA_SOURCE_LABEL: Record<PendingLateTaskRow["slaSource"], string> = {
  task_override: "استثناء على المهمة",
  template_snapshot: "نسخة القالب عند الإنشاء",
  organization_default: "إعداد SLA العام",
};

function TemplateComparison({ task }: { task: PendingLateTaskRow }) {
  if (!task.templateItemTitle) {
    return (
      <div>
        <p className="font-medium text-muted-foreground">لا يوجد قالب مرتبط</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">مهمة مستوردة أو منشأة يدويًا</p>
      </div>
    );
  }

  const currentTemplateSla = task.currentTemplateSlaMinutes ?? task.organizationSlaMinutes;
  const usesDefault = task.currentTemplateSlaMinutes == null;
  const matches = currentTemplateSla != null && currentTemplateSla === task.slaMinutes;

  return (
    <div className="min-w-40">
      <p className="font-semibold tabular-nums">
        {currentTemplateSla == null ? "بدون SLA" : formatMinutes(currentTemplateSla)}
      </p>
      <p className="mt-0.5 max-w-48 truncate text-[10px] text-muted-foreground" title={task.templateItemTitle}>
        {task.templateItemTitle} {usesDefault ? "· يستخدم الإعداد العام" : "· مُدخل في القالب"}
      </p>
      <span
        className={
          matches
            ? "mt-1 inline-flex items-center gap-1 rounded-full bg-cc-green/10 px-2 py-0.5 text-[10px] font-medium text-cc-green"
            : "mt-1 inline-flex items-center gap-1 rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber"
        }
      >
        {matches ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <AlertTriangle className="size-3" aria-hidden="true" />}
        {matches ? "مطابق للحساب" : "يختلف عن القيمة المحسوبة"}
      </span>
    </div>
  );
}

export function TeamPulsePendingCell({
  employeeId,
  fullName,
  late,
  owned,
}: {
  employeeId: string;
  fullName: string;
  late: number;
  owned: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PendingLateTaskRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRows() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/team-activity/pending-late?emp=${encodeURIComponent(employeeId)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { rows: PendingLateTaskRow[] };
      setRows(body.rows);
    } catch {
      setError("تعذّر تحميل المهام. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && rows === null && !loading) void loadRows();
  }

  if (owned === 0) return <span className="text-muted-foreground">—</span>;
  const displayedLate = rows?.length ?? late;

  const count = (
    <span className={late > 0 ? "text-cc-red" : "text-muted-foreground"}>
      <span className="font-semibold">{late}</span>
      <span className="text-[9px] font-normal text-muted-foreground"> متأخرة</span>
    </span>
  );

  return (
    <div className="flex flex-col items-center leading-tight tabular-nums">
      {late > 0 ? (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger
            render={
              <button
                type="button"
                aria-label={`عرض ${late} مهام معلّقة متأخرة لدى ${fullName}`}
                className="rounded-md px-1.5 py-1 transition-colors hover:bg-cc-red/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-red"
              />
            }
          >
            {count}
          </DialogTrigger>
          <DialogContent className="sm:w-[min(96vw,72rem)] sm:max-w-6xl">
            <DialogHeader className="pe-9 text-right">
              <DialogTitle>المهام المعلّقة المتأخرة — {fullName}</DialogTitle>
              <DialogDescription>
                {displayedLate} مهام على مكتبه تجاوزت الزمن المسموح للمرحلة الحالية.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-cyan/20 bg-cyan/5 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">طريقة التحقق:</span>{" "}
              وقت العمل المنقضي − SLA المطبّق = التجاوز. وقت العمل يُحسب من الأحد إلى الخميس،
              ٩:٠٠ ص–٥:٠٠ م بتوقيت الرياض.
            </div>

            {loading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                جارٍ تحميل المهام…
              </div>
            ) : error ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center" aria-live="polite">
                <p className="text-sm text-cc-red">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadRows()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-soft-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  إعادة المحاولة
                </button>
              </div>
            ) : rows && rows.length > 0 ? (
              <div className="max-h-[62svh] overflow-auto rounded-xl border border-border">
                <table className="w-full min-w-[68rem] text-right text-xs">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border text-[10px] text-muted-foreground">
                      <th className="px-3 py-2.5 font-medium">المهمة</th>
                      <th className="px-3 py-2.5 font-medium">المرحلة ودخولها</th>
                      <th className="px-3 py-2.5 font-medium">SLA المطبّق</th>
                      <th className="px-3 py-2.5 font-medium">القالب الحالي</th>
                      <th className="px-3 py-2.5 text-center font-medium">وقت العمل المنقضي</th>
                      <th className="px-3 py-2.5 text-center font-medium">التجاوز</th>
                      <th className="px-3 py-2.5 font-medium"><span className="sr-only">فتح المهمة</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((task) => (
                      <tr key={task.taskId} className="border-b border-border/50 align-top hover:bg-soft-1">
                        <td className="max-w-64 px-3 py-3">
                          <Link
                            href={`/tasks/${task.taskId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate font-medium hover:text-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                          >
                            {task.taskCode ? `${task.taskCode} · ` : ""}{task.title}
                          </Link>
                          <p className="mt-1 truncate text-[10px] text-muted-foreground">{task.projectName ?? "—"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium">{TASK_STAGE_LABELS[task.stage as TaskStage] ?? task.stage}</p>
                          <p className="mt-1 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums">
                            {formatStageEnteredAt(task.stageEnteredAt)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold tabular-nums">{formatMinutes(task.slaMinutes)}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">{SLA_SOURCE_LABEL[task.slaSource]}</p>
                        </td>
                        <td className="px-3 py-3"><TemplateComparison task={task} /></td>
                        <td className="px-3 py-3 text-center font-semibold tabular-nums">
                          {formatMinutes(task.elapsedMinutes)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-cc-red/10 px-2 py-1 font-semibold text-cc-red tabular-nums">
                            <AlertTriangle className="size-3.5" aria-hidden="true" />
                            {formatMinutes(task.overdueMinutes)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/tasks/${task.taskId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`فتح المهمة ${task.title}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg text-cyan hover:bg-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                          >
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" aria-live="polite">
                لا توجد مهام متأخرة حاليًا.
              </div>
            )}
          </DialogContent>
        </Dialog>
      ) : (
        count
      )}
      <TeamPulseOwnedTasksModal employeeId={employeeId} fullName={fullName} owned={owned} />
    </div>
  );
}
