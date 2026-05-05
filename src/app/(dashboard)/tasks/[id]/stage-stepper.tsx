"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  TASK_STAGES,
  TASK_STAGE_LABELS,
  type TaskStage,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import { moveTaskStageAction } from "../_actions";

function formatStageDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 60_000) return "الآن";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}س`;
  const days = Math.floor(hours / 24);
  return `${days}ي`;
}

export function StageStepper({
  taskId,
  currentStage,
  stageEnteredAt,
}: {
  taskId: string;
  currentStage: TaskStage;
  stageEnteredAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const currentIdx = TASK_STAGES.indexOf(currentStage);
  const elapsed = stageEnteredAt ? formatStageDuration(stageEnteredAt) : null;

  const handleClick = (stage: TaskStage) => {
    if (stage === currentStage || pending) return;
    start(async () => {
      const res = await moveTaskStageAction({ taskId, stage });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(`نُقلت إلى ${TASK_STAGE_LABELS[stage]}`);
        router.refresh();
      }
    });
  };

  return (
    <div
      className="flex flex-wrap items-stretch gap-1 rounded-2xl border border-soft bg-card/60 p-1"
      role="tablist"
      aria-label="مراحل المهمة"
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
            disabled={pending}
            onClick={() => handleClick(stage)}
            className={cn(
              "group relative inline-flex min-w-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40",
              isCurrent &&
                "bg-cyan-dim text-cyan ring-1 ring-cyan/30 shadow-sm",
              isPast &&
                "text-muted-foreground hover:bg-soft-2 hover:text-foreground",
              isFuture &&
                "text-muted-foreground/60 hover:bg-soft-1 hover:text-foreground",
              pending && "cursor-wait opacity-70",
            )}
          >
            {isPast && (
              <Check className="size-3 shrink-0 opacity-70" aria-hidden />
            )}
            <span className="truncate">{TASK_STAGE_LABELS[stage]}</span>
            {isCurrent && elapsed && (
              <span className="rounded bg-cyan/10 px-1 py-0.5 text-[10px] tabular-nums">
                {elapsed}
              </span>
            )}
            {isCurrent && pending && (
              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
