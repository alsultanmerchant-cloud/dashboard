"use client";

// Odoo-style rich tasks list/table view with cross-task bulk operations.
// Columns mirror Odoo's project.task list view: title, project, service,
// stage, priority, role-colored assignee dots, deadline (with delay), and
// time-in-stage. Click a row to open the task detail.
//
// Selecting one or more rows reveals a sticky bottom toolbar with:
// move-stage, set-priority, shift-deadline-by-N. Bound to bulkUpdateTasksAction.

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Calendar, ChevronLeft, X, Loader2, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  TASK_STAGES,
  TASK_STAGE_LABELS,
  TASK_STAGE_TONES,
  TASK_ROLE_TYPES,
  TASK_ROLE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type TaskStage,
  type Priority,
} from "@/lib/labels";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/status-badges";
import {
  DataTableShell,
  DataTable,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableCell,
} from "@/components/data-table-shell";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ListTaskRow } from "./_loaders";
import { bulkUpdateTasksAction } from "./_bulk_actions";

const ROLE_DOT_FILL: Record<string, string> = {
  specialist: "bg-amber-400",
  manager: "bg-blue-400",
  agent: "bg-emerald-400",
  account_manager: "bg-rose-400",
  supporting_lead: "bg-violet-400",
  supporting_agent: "bg-violet-300",
};
const ROLE_DOT_RING: Record<string, string> = {
  specialist: "ring-amber-400/50",
  manager: "ring-blue-400/50",
  agent: "ring-emerald-400/50",
  account_manager: "ring-rose-400/50",
  supporting_lead: "ring-violet-400/50",
  supporting_agent: "ring-violet-300/50",
};

function formatDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 60_000) return "الآن";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}س ${minutes % 60}د`;
  const days = Math.floor(hours / 24);
  return `${days}ي ${hours % 24}س`;
}

function deadlineDelta(deadline: string | null): {
  days: number | null;
  label: string | null;
  tone: "late" | "today" | "soon" | "future" | null;
} {
  if (!deadline) return { days: null, label: null, tone: null };
  const ms = new Date(deadline).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < 0) return { days, label: `+${-days}d`, tone: "late" };
  if (days === 0) return { days, label: "اليوم", tone: "today" };
  if (days === 1) return { days, label: "غداً", tone: "soon" };
  if (days < 7) return { days, label: `بعد ${days}ي`, tone: "soon" };
  return { days, label: `بعد ${days}ي`, tone: "future" };
}

export function TasksListView({ tasks }: { tasks: ListTaskRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<TaskStage>("in_progress");
  const [priority, setPriority] = useState<Priority>("medium");
  const [shiftDays, setShiftDays] = useState<string>("1");
  const [confirmStageOpen, setConfirmStageOpen] = useState(false);

  const allChecked = useMemo(
    () => tasks.length > 0 && tasks.every((t) => selected.has(t.id)),
    [tasks, selected],
  );

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo className="size-6" />}
        title="لا توجد مهام"
        description="لا توجد مهام تطابق هذا الفلتر حالياً."
      />
    );
  }

  const toggleAll = () => {
    setSelected((curr) => {
      if (allChecked) return new Set();
      return new Set(tasks.map((t) => t.id));
    });
  };

  const toggleOne = (id: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ids = useMemo(() => [...selected], [selected]);

  const reportResult = (
    res: Awaited<ReturnType<typeof bulkUpdateTasksAction>>,
    okMsg: string,
  ) => {
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    if (res.failed.length > 0) {
      toast.warning(
        `${okMsg}: تم تحديث ${res.changed} · فشل ${res.failed.length}`,
      );
    } else {
      toast.success(`${okMsg}: تم تحديث ${res.changed}`);
    }
    setSelected(new Set());
    router.refresh();
  };

  const onMoveStage = () => {
    setConfirmStageOpen(true);
  };

  const runMoveStage = () =>
    start(async () => {
      const res = await bulkUpdateTasksAction({ op: "stage", ids, stage });
      setConfirmStageOpen(false);
      reportResult(res, "نقل المرحلة");
    });

  const onSetPriority = () =>
    start(async () => {
      const res = await bulkUpdateTasksAction({ op: "priority", ids, priority });
      reportResult(res, "تعديل الأولوية");
    });

  const onShiftDeadline = () =>
    start(async () => {
      const days = Number(shiftDays);
      if (!Number.isFinite(days) || days === 0) {
        return toast.error("أدخل عددًا صحيحًا غير صفر");
      }
      const res = await bulkUpdateTasksAction({
        op: "shift_deadline",
        ids,
        days,
      });
      reportResult(res, "إزاحة الموعد");
    });

  return (
    <>
      <DataTableShell>
        <DataTable>
          <DataTableHead>
            <tr>
              <DataTableHeaderCell aria-label="تحديد">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="size-3.5 cursor-pointer"
                  aria-label="تحديد الكل"
                />
              </DataTableHeaderCell>
              <DataTableHeaderCell>المهمة</DataTableHeaderCell>
              <DataTableHeaderCell>المشروع</DataTableHeaderCell>
              <DataTableHeaderCell>الخدمة</DataTableHeaderCell>
              <DataTableHeaderCell>المرحلة</DataTableHeaderCell>
              <DataTableHeaderCell>الفريق</DataTableHeaderCell>
              <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
              <DataTableHeaderCell>الموعد النهائي</DataTableHeaderCell>
              <DataTableHeaderCell className="text-center" title="عدد التصاميم / المنشورات (Design / Post Count)">تصاميم</DataTableHeaderCell>
              <DataTableHeaderCell className="text-center" title="عدد المهام الفرعية المنجزة (تعديلات/مراجعات)">تعديلات</DataTableHeaderCell>
              <DataTableHeaderCell>المدة في المرحلة</DataTableHeaderCell>
              <DataTableHeaderCell>التقدم</DataTableHeaderCell>
              <DataTableHeaderCell aria-label="فتح" />
            </tr>
          </DataTableHead>
          <tbody>
            {tasks.map((t) => {
              const deadline = t.planned_date ?? t.due_date;
              const dl = deadlineDelta(deadline);
              const isLate = dl.tone === "late" && t.stage !== "done";
              const stageDuration = formatDuration(t.stage_entered_at);
              const slip = (t.expected_progress_percent ?? 0) - (t.progress_percent ?? 0);
              const checked = selected.has(t.id);
              return (
                <DataTableRow key={t.id} className={cn(checked && "bg-cyan/5")}>
                  <DataTableCell>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-3.5 cursor-pointer"
                      aria-label={`تحديد ${t.title}`}
                    />
                  </DataTableCell>
                  <DataTableCell className="max-w-[280px] font-medium">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="line-clamp-1 hover:text-cyan transition-colors"
                    >
                      {t.task_code && (
                        <span className="me-1.5 inline-flex shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 align-middle font-mono text-[10px] text-muted-foreground" dir="ltr">
                          {t.task_code}
                        </span>
                      )}
                      {t.title}
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="max-w-[200px] text-xs">
                    <Link
                      href={`/projects/${t.project_id}`}
                      className="line-clamp-1 text-muted-foreground hover:text-cyan transition-colors"
                    >
                      {t.project_name}
                    </Link>
                    {t.client_name && (
                      <div className="text-[10px] text-muted-foreground/60 line-clamp-1">
                        {t.client_name}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {t.service?.name ?? "—"}
                  </DataTableCell>
                  <DataTableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        TASK_STAGE_TONES[t.stage],
                      )}
                    >
                      {TASK_STAGE_LABELS[t.stage]}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex items-center gap-1">
                      {TASK_ROLE_TYPES.map((role) => {
                        const e = t.role_slots[role];
                        return e ? (
                          <Avatar
                            key={role}
                            size="sm"
                            className={cn(
                              "ring-2 ring-offset-1 ring-offset-card",
                              ROLE_DOT_RING[role],
                            )}
                            title={`${TASK_ROLE_LABELS[role]}: ${e.full_name}`}
                          >
                            <AvatarFallback className="text-[10px]">
                              {e.full_name[0]}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <span
                            key={role}
                            className={cn(
                              "inline-block size-2 rounded-full opacity-25",
                              ROLE_DOT_FILL[role],
                            )}
                            title={`${TASK_ROLE_LABELS[role]}: غير معيّن`}
                          />
                        );
                      })}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <PriorityBadge priority={t.priority} />
                  </DataTableCell>
                  <DataTableCell>
                    {deadline ? (
                      <div
                        className={cn(
                          "inline-flex items-center gap-1 text-xs tabular-nums",
                          isLate && "text-cc-red font-medium",
                          dl.tone === "today" && "text-amber-300",
                        )}
                        dir="ltr"
                      >
                        <Calendar className="size-3" />
                        <span>{deadline}</span>
                        {dl.label && (
                          <span className="opacity-80">({dl.label})</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-center tabular-nums">
                    {(t.design_count ?? 0) > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-cyan/10 text-cyan px-1.5 py-0.5 text-[11px]"
                        title="عدد التصاميم / المنشورات"
                      >
                        🎨 {t.design_count}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-center tabular-nums">
                    {(t.closed_subtask_count ?? 0) > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber/10 text-amber px-1.5 py-0.5 text-[11px]"
                        title="عدد المهام الفرعية المنجزة (تعديلات / مراجعات)"
                      >
                        ✎ {t.closed_subtask_count}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                      <Clock className="size-3" />
                      {stageDuration}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-soft-2">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            slip > 10 ? "bg-cc-red" :
                            slip > 0 ? "bg-amber-400" :
                            "bg-emerald-400",
                          )}
                          style={{ width: `${Math.min(100, t.progress_percent ?? 0)}%` }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {Math.round(t.progress_percent ?? 0)}%
                      </span>
                      {slip > 0 && (
                        <span className="text-[10px] tabular-nums text-cc-red">
                          خلف {Math.round(slip)}%
                        </span>
                      )}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`/tasks/${t.id}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground transition-colors"
                      aria-label="فتح"
                    >
                      <ChevronLeft className="size-3.5 icon-flip-rtl" />
                    </Link>
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      </DataTableShell>

      {selected.size > 0 && (
        <div className="sticky bottom-3 z-30 mt-3">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-cyan/40 bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2.5 py-1 text-xs font-medium text-cyan tabular-nums">
              {selected.size} محددة
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="opacity-70 hover:opacity-100"
                aria-label="إلغاء التحديد"
              >
                <X className="size-3" />
              </button>
            </span>

            <div className="mx-1 h-5 w-px bg-soft" />

            <div className="flex items-center gap-1">
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as TaskStage)}
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="المرحلة"
              >
                {TASK_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={onMoveStage} disabled={pending}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                نقل المرحلة
              </Button>
            </div>

            <div className="mx-1 h-5 w-px bg-soft" />

            <div className="flex items-center gap-1">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="الأولوية"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={onSetPriority} disabled={pending}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                تعيين الأولوية
              </Button>
            </div>

            <div className="mx-1 h-5 w-px bg-soft" />

            <div className="flex items-center gap-1">
              <input
                type="number"
                value={shiftDays}
                onChange={(e) => setShiftDays(e.target.value)}
                disabled={pending}
                step={1}
                className="h-8 w-16 rounded-md border bg-background px-2 text-xs tabular-nums"
                aria-label="عدد الأيام"
                dir="ltr"
              />
              <Button size="sm" variant="outline" onClick={onShiftDeadline} disabled={pending}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                إزاحة الموعد
              </Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmStageOpen}
        onOpenChange={(o) => {
          if (!o && !pending) setConfirmStageOpen(false);
        }}
        title="تأكيد نقل المرحلة"
        description={
          <>
            نقل {selected.size} مهمة إلى{" "}
            <span className="font-semibold text-foreground">
              {TASK_STAGE_LABELS[stage]}
            </span>
            ؟ المهام التي تتطلّب الرجوع إلى مرحلة سابقة سيتم تخطيها. لا يمكن
            التراجع عن هذه الخطوة.
          </>
        }
        confirmLabel="نقل"
        onConfirm={runMoveStage}
        pending={pending}
      />
    </>
  );
}
