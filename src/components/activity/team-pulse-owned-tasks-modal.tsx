"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Inbox, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import type { OwnedDeskTaskRow } from "@/lib/data/team-pulse";

const numberFormatter = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 });

function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${numberFormatter.format(remainder)} دقيقة`;
  if (remainder === 0) return `${numberFormatter.format(hours)} ساعة`;
  return `${numberFormatter.format(hours)} ساعة و${numberFormatter.format(remainder)} دقيقة`;
}

export function TeamPulseOwnedTasksModal({
  employeeId,
  fullName,
  owned,
}: {
  employeeId: string;
  fullName: string;
  owned: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OwnedDeskTaskRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRows() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/team-activity/owned-tasks?emp=${encodeURIComponent(employeeId)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { rows: OwnedDeskTaskRow[] };
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

  const displayedCount = rows?.length ?? owned;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`عرض ${owned} مهام على مكتب ${fullName}`}
            className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-cyan/10 hover:text-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          />
        }
      >
        {owned} على مكتبه
      </DialogTrigger>

      <DialogContent className="sm:w-[min(94vw,64rem)] sm:max-w-5xl">
        <DialogHeader className="pe-9 text-right">
          <DialogTitle className="inline-flex items-center gap-2">
            <Inbox className="size-4 text-cyan" aria-hidden="true" />
            المهام على مكتب {fullName}
          </DialogTitle>
          <DialogDescription>
            {displayedCount} مهام مفتوحة يملك فيها الموظف مسؤولية المرحلة الحالية.
          </DialogDescription>
        </DialogHeader>

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
            <table className="w-full min-w-[50rem] text-right text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">المهمة</th>
                  <th className="px-3 py-2.5 font-medium">المشروع</th>
                  <th className="px-3 py-2.5 font-medium">المرحلة الحالية</th>
                  <th className="px-3 py-2.5 text-center font-medium">وقت العمل في المرحلة</th>
                  <th className="px-3 py-2.5 text-center font-medium">حالة SLA</th>
                  <th className="px-3 py-2.5 font-medium"><span className="sr-only">فتح المهمة</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr key={task.taskId} className="border-b border-border/50 hover:bg-soft-1">
                    <td className="max-w-64 px-3 py-3">
                      <Link
                        href={`/tasks/${task.taskId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate font-medium hover:text-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        {task.taskCode ? `${task.taskCode} · ` : ""}{task.title}
                      </Link>
                    </td>
                    <td className="max-w-52 px-3 py-3 text-muted-foreground">
                      <span className="block truncate">{task.projectName ?? "—"}</span>
                    </td>
                    <td className="px-3 py-3 font-medium">
                      {TASK_STAGE_LABELS[task.stage as TaskStage] ?? task.stage}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums">
                      {formatMinutes(task.elapsedMinutes)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {task.slaMinutes == null ? (
                        <span className="rounded-full bg-soft-2 px-2 py-1 text-[10px] text-muted-foreground">بدون SLA</span>
                      ) : task.isLate ? (
                        <span className="rounded-full bg-cc-red/10 px-2 py-1 text-[10px] font-medium text-cc-red">
                          متأخرة · SLA {formatMinutes(task.slaMinutes)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-cc-green/10 px-2 py-1 text-[10px] font-medium text-cc-green">
                          ضمن الوقت · SLA {formatMinutes(task.slaMinutes)}
                        </span>
                      )}
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
            لا توجد مهام على مكتبه حاليًا.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
