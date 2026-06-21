"use client";

import { useState } from "react";
import { Lightbulb, RefreshCw, Check } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TaskTechTipSchema } from "@/lib/tech-tips/schema";

// On-demand technical tip for a single task. Button-triggered (no model call
// until the user asks) so opening a task stays cheap. Streams a headline + a
// short actionable checklist grounded in this task + its project.
export function TaskTechTip({ taskId }: { taskId: string }) {
  const [started, setStarted] = useState(false);
  const { submit, isLoading, object, error } = useObject({
    api: `/api/tech-tips/task/${taskId}`,
    schema: TaskTechTipSchema,
  });

  const run = () => {
    setStarted(true);
    submit({});
  };

  const steps = (object?.steps ?? []).filter(Boolean) as string[];

  return (
    <Card className="border-amber/20 bg-amber/[0.03]">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-amber-dim text-amber">
              <Lightbulb className="size-3.5" />
            </span>
            نصيحة تقنية لهذه المهمة
          </span>
          <button
            type="button"
            onClick={run}
            disabled={isLoading}
            className={cn("inline-flex items-center gap-1 rounded-lg border border-amber/30 px-2.5 py-1 text-[11px] font-medium text-amber transition-colors hover:bg-amber-dim disabled:opacity-60", error && "border-cc-red/40 text-cc-red")}
          >
            <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
            {isLoading ? "يفكّر…" : started ? "نصيحة أخرى" : "احصل على نصيحة"}
          </button>
        </div>

        {error && !isLoading && (
          <p className="mt-3 text-[11px] text-cc-red">تعذّر توليد النصيحة — أعد المحاولة.</p>
        )}

        {started && (object?.headline || isLoading) && (
          <div className="mt-3 space-y-2">
            <p className={cn("text-sm font-semibold text-foreground/90", isLoading && !object?.headline && "animate-pulse")}>
              {object?.headline || "يحلّل المهمة…"}
            </p>
            <ul className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/85">
                  <Check className="mt-0.5 size-3 shrink-0 text-cc-green" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
