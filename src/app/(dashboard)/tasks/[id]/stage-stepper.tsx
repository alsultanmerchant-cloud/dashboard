"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  TASK_STAGES,
  isForwardStageMove,
  type TaskStage,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { moveTaskStageAction } from "../_actions";

function formatStageDuration(
  fromIso: string,
  locale: string,
  t: ReturnType<typeof useTranslations<"TaskDetailPage.stepper">>,
): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 60_000) return t("now");
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return locale === "ar" ? `${minutes}د` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return locale === "ar" ? `${hours}س` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return locale === "ar" ? `${days}ي` : `${days}d`;
}

// Compact "12h" / "14d" / "30m" — same suffix language as the live counter,
// driven by a fixed seconds value summed across all dwells in a stage.
function formatSeconds(seconds: number, locale: string): string | null {
  if (!Number.isFinite(seconds) || seconds < 60) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return locale === "ar" ? `${minutes}د` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return locale === "ar" ? `${hours}س` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return locale === "ar" ? `${days}ي` : `${days}d`;
}

export function StageStepper({
  taskId,
  currentStage,
  stageEnteredAt,
  stageDwellSeconds,
}: {
  taskId: string;
  currentStage: TaskStage;
  stageEnteredAt: string | null;
  /** Summed dwell seconds per stage, from task_stage_history. Past stages
   *  display this value; the current stage shows a live-counting label. */
  stageDwellSeconds?: Record<string, number>;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("TaskDetailPage.stepper");
  const stageT = useTranslations("TaskLabels.stage");
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<TaskStage | null>(null);
  const currentIdx = TASK_STAGES.indexOf(currentStage);
  const elapsed = stageEnteredAt ? formatStageDuration(stageEnteredAt, locale, t) : null;
  const labelForStage = (stage: TaskStage) => (stageT.has(stage) ? stageT(stage) : stage);

  const handleClick = (stage: TaskStage) => {
    if (stage === currentStage || pending) return;
    if (!isForwardStageMove(currentStage, stage)) {
      toast.error(t("cannotMoveBack"));
      return;
    }
    setTarget(stage);
  };

  const handleConfirm = () => {
    if (!target) return;
    const stage = target;
    start(async () => {
      const res = await moveTaskStageAction({ taskId, stage });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(t("movedTo", { stage: labelForStage(stage) }));
        router.refresh();
      }
      setTarget(null);
    });
  };

  return (
    <>
      <div
        className="flex flex-wrap items-stretch gap-1 rounded-2xl border border-soft bg-card/60 p-1"
        role="tablist"
        aria-label={t("ariaLabel")}
      >
        {TASK_STAGES.map((stage, idx) => {
          const isCurrent = idx === currentIdx;
          const isPast = idx < currentIdx;
          const isFuture = idx > currentIdx;
          return (
            <button
              key={stage}
              type="button"
              role="tab"
              aria-selected={isCurrent}
              disabled={pending || isPast}
              onClick={() => handleClick(stage)}
              className={cn(
                "group relative inline-flex min-w-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40",
                isCurrent &&
                  "bg-cyan-dim text-cyan ring-1 ring-cyan/30 shadow-sm",
                isPast &&
                  "cursor-not-allowed text-muted-foreground/60 opacity-70",
                isFuture &&
                  "text-muted-foreground/60 hover:bg-soft-1 hover:text-foreground",
                pending && "cursor-wait opacity-70",
              )}
              title={isPast ? t("cannotMoveBack") : undefined}
            >
              {isPast && (
                <Check className="size-3 shrink-0 opacity-70" aria-hidden />
              )}
              <span className="truncate">{labelForStage(stage)}</span>
              {isCurrent && elapsed && (
                <span className="rounded bg-cyan/10 px-1 py-0.5 text-[10px] tabular-nums">
                  {elapsed}
                </span>
              )}
              {/* §TASK-INFO-1 — show per-stage dwell on past chips, e.g.
                  "14d", matching Odoo's progression bar. */}
              {isPast && stageDwellSeconds && (() => {
                const fmt = formatSeconds(stageDwellSeconds[stage] ?? 0, locale);
                return fmt ? (
                  <span className="rounded bg-soft-2 px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground/80">
                    {fmt}
                  </span>
                ) : null;
              })()}
              {isCurrent && pending && (
                <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o && !pending) setTarget(null);
        }}
        title={t("confirmTitle")}
        description={
          target ? (
            <>
              {t("confirmFrom")}{" "}
              <span className="font-semibold text-foreground">
                {labelForStage(currentStage)}
              </span>{" "}
              {t("confirmTo")}{" "}
              <span className="font-semibold text-foreground">
                {labelForStage(target)}
              </span>
              {t("confirmWarning")}
            </>
          ) : null
        }
        confirmLabel={t("confirmAction")}
        onConfirm={handleConfirm}
        pending={pending}
      />
    </>
  );
}
