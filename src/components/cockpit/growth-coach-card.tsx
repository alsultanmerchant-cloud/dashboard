"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, Target, ListChecks } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GrowthCoachSchema, type GrowthCoachAi } from "@/lib/growth-coach/schema";
import { saveAgentAi, formatAgo } from "@/lib/agent-ai-cache-client";

// AI growth coach. Renders the LAST cached result instantly (no Gemini call on
// load); the agent presses "re-analyse" to regenerate. The fresh result is
// streamed and persisted on finish so the next load is instant again.
export function GrowthCoachCard({
  specialization,
  initial,
  generatedAt,
}: {
  specialization: string;
  initial: GrowthCoachAi | null;
  generatedAt: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("AgentCockpit");
  const [stamp, setStamp] = useState<string | null>(generatedAt);
  const { submit, isLoading, object, error } = useObject({
    api: "/api/growth/coach",
    schema: GrowthCoachSchema,
    onFinish: ({ object }) => {
      if (object) {
        saveAgentAi("growth_coach", object);
        setStamp(new Date().toISOString());
      }
    },
  });

  // Prefer the live stream while running, fall back to the cached result.
  const live = object as Partial<GrowthCoachAi> | undefined;
  const diagnosis = live?.diagnosis ?? (isLoading ? undefined : initial?.diagnosis);
  const focusArea = live?.focusArea ?? (isLoading ? undefined : initial?.focusArea);
  const actions = ((live?.actions ?? (isLoading ? [] : initial?.actions)) ?? []).filter(
    Boolean,
  ) as string[];
  const hasResult = !!(diagnosis || focusArea || actions.length);
  const ago = formatAgo(stamp, locale);

  return (
    <Card className="border-cyan/20 bg-cyan/[0.03]">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-cyan-dim text-cyan">
              <Sparkles className="size-3.5" />
            </span>
            {t("growth.coach.label")}
            {specialization && (
              <span className="rounded-full bg-cyan-dim px-2 py-0.5 text-[10px] font-medium text-cyan">
                {specialization}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {ago && !isLoading && (
              <span className="hidden text-[10px] text-muted-foreground sm:inline">
                {t("growth.updated", { ago })}
              </span>
            )}
            <button
              type="button"
              onClick={() => submit({ locale })}
              disabled={isLoading}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground",
                error && "text-cc-red",
              )}
              title={error ? t("growth.coach.retry") : t("growth.coach.refresh")}
            >
              <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
              {isLoading
                ? t("growth.coach.thinking")
                : hasResult
                  ? t("growth.reanalyse")
                  : t("growth.coach.generate")}
            </button>
          </div>
        </div>

        {/* Idle (never generated) — invite the agent to run it. */}
        {!hasResult && !isLoading ? (
          <button
            type="button"
            onClick={() => submit({ locale })}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-cyan/25 bg-card/40 px-4 py-6 text-center transition-colors hover:border-cyan/50"
          >
            <Sparkles className="size-5 text-cyan" />
            <span className="text-xs text-muted-foreground">{t("growth.coach.idleHint")}</span>
            <span className="text-[11px] font-semibold text-cyan">{t("growth.coach.generate")}</span>
          </button>
        ) : (
          <>
            {/* Diagnosis */}
            <p
              className={cn(
                "text-sm leading-relaxed text-foreground/90",
                isLoading && !diagnosis && "animate-pulse text-muted-foreground",
              )}
            >
              {diagnosis || (isLoading ? t("growth.coach.analyzing") : "—")}
            </p>

            {/* Focus area */}
            {(focusArea || isLoading) && (
              <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-card/40 p-3">
                <Target className="mt-0.5 size-3.5 shrink-0 text-cyan" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("growth.coach.focus")}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm leading-relaxed text-foreground/90",
                      isLoading && !focusArea && "animate-pulse",
                    )}
                  >
                    {focusArea || (isLoading ? t("growth.coach.preparing") : "—")}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            {actions.length > 0 && (
              <div>
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <ListChecks className="size-3.5 text-cyan" />
                  {t("growth.coach.actions")}
                </p>
                <ul className="space-y-1.5">
                  {actions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-cyan-dim text-[10px] font-bold text-cyan tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0">{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
