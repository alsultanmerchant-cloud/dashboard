"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { DrillTask } from "@/lib/data/accountability";

const NA = "—";

function useFmt() {
  const t = useTranslations("AccountabilityPage");
  return (min: number | null): string => {
    if (min == null) return NA;
    const m = Math.round(min);
    if (m < 60) return t("fmt.minutes", { n: m });
    const h = m / 60;
    if (h < 8) return t("fmt.hours", { n: Math.round(h * 10) / 10 });
    return t("fmt.workdays", { n: Math.round((h / 8) * 10) / 10 });
  };
}

export interface DrillView {
  title: string;
  subtitle?: string;
  // How to present the per-task value on the right of each row.
  valueKind: "minutes" | "flag" | "none";
  // Label for a truthy flag (valueKind "flag"), e.g. "دخلت تعديلات العميل".
  flagLabel?: string;
  tasks: DrillTask[];
  loading: boolean;
  error: string | null;
}

// The tasks behind a صرامة المراجعة / تعديلات العميل number — deliberately a SIDE
// SHEET (not the centered accountability-details modal) so the two never get
// confused. Each row deep-links to /tasks/[id] to reconcile against Rwasem.
export function TaskDrillSheet({
  view,
  onClose,
  onRetry,
}: {
  view: DrillView;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const fmt = useFmt();
  const tStages = useTranslations("TasksBoard.stages");
  const stageLabel = (stage: string | null) => {
    if (!stage) return null;
    try {
      return tStages(stage);
    } catch {
      return stage;
    }
  };
  // Always open from the visual RIGHT. In the RTL (Arabic) layout the Sheet's
  // rtl: classes flip "left" to the right edge; LTR uses "right" directly.
  const side = useLocale() === "ar" ? "left" : "right";

  // "افتح الكل في المهام" — hands the exact ids in view to /tasks (list view,
  // no default filter) so the same set is reproduced there. DISTINCT because
  // stage-interval rows can repeat a task (two owned stages on one task).
  const distinctIds = [...new Set(view.tasks.map((task) => task.taskId))];
  const openAllHref = `/tasks?view=list&f=all&ids=${distinctIds.join(",")}`;
  const canOpenAll = !view.loading && !view.error && view.tasks.length > 0;

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side={side} className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border pe-12">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-sm">{view.title}</SheetTitle>
            {!view.loading && !view.error && (
              <span className="rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {view.tasks.length}
              </span>
            )}
          </div>
          {view.subtitle && <SheetDescription className="text-[11px]">{view.subtitle}</SheetDescription>}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-3">
          {view.loading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-soft-1/60 px-3 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-cyan" />
              جارٍ تحميل التاسكات…
            </div>
          ) : view.error ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-cc-red/20 bg-red-dim/30 px-3 py-6 text-center text-xs text-muted-foreground">
              <p>تعذّر تحميل التاسكات.</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-soft-1"
                >
                  <RefreshCw className="size-3" />
                  إعادة المحاولة
                </button>
              )}
            </div>
          ) : view.tasks.length === 0 ? (
            <p className="rounded-lg bg-soft-1/60 px-3 py-6 text-center text-xs text-muted-foreground">
              لا توجد تاسكات مطابقة لهذا الرقم في الفترة المحددة.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {view.tasks.map((task) => (
                <li key={`${task.taskId}-${task.kind}`}>
                  <Link
                    href={`/tasks/${task.taskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] transition-colors hover:border-cyan/30 hover:bg-soft-1"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/60" />
                      <span className="min-w-0">
                        <span className="block max-w-[16rem] truncate">{task.title}</span>
                        {(task.projectName || task.clientName) && (
                          <span
                            className="block max-w-[16rem] truncate text-[11px] text-muted-foreground"
                            title={task.projectName ?? task.clientName ?? ""}
                          >
                            {task.projectName ?? task.clientName}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px]">
                      {task.stage && task.kind === "stage" && (
                        <span className="rounded bg-soft-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {stageLabel(task.stage)}
                        </span>
                      )}
                      {view.valueKind === "minutes" && (
                        <span className="tabular-nums text-muted-foreground">{fmt(task.minutes)}</span>
                      )}
                      {view.valueKind === "flag" && task.flag && (
                        <span className="rounded bg-amber-dim px-1.5 py-0.5 text-[10px] font-medium text-amber">
                          {view.flagLabel ?? "نعم"}
                        </span>
                      )}
                      {task.occurredAt && (
                        <span dir="ltr" className="tabular-nums text-muted-foreground/70">
                          {task.occurredAt.slice(0, 10)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canOpenAll && (
          <div className="shrink-0 border-t border-border bg-card/95 p-3">
            <Link
              href={openAllHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan/30 bg-cyan/5 px-3 py-2 text-[13px] font-semibold text-cyan transition-colors hover:bg-cyan/10"
            >
              <ExternalLink className="size-4" />
              افتح الكل في المهام ({distinctIds.length})
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// A number rendered as an inline drill-down trigger. Falls back to plain text
// when the value is zero (nothing to open) or no handler is wired.
export function DrillNumber({
  value,
  onClick,
  className,
  children,
}: {
  value: number;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!onClick || value === 0) {
    return <span className={className}>{children ?? value}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn("underline decoration-dotted underline-offset-2 transition-colors hover:text-cyan", className)}
      title="اعرض التاسكات وراء هذا الرقم"
    >
      {children ?? value}
    </button>
  );
}
