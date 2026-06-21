"use client";

import { useState } from "react";
import Link from "next/link";
import { Lightbulb, RefreshCw, GraduationCap, ArrowLeft } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cleanTaskTitle } from "@/components/cockpit/task-row";
import { AgentTechTipSchema, type AgentTechTipAi } from "@/lib/tech-tips/schema";
import { saveAgentAi, formatAgo } from "@/lib/agent-ai-cache-client";

// Dashboard technical-tip card. Renders the LAST cached tip instantly (no
// Gemini call on load); the agent presses "new tip" to regenerate. The fresh
// tip is streamed and persisted on finish so the next load is instant.
export function TechTipCard({
  specialization,
  focusTask,
  initial,
  generatedAt,
}: {
  specialization: string;
  focusTask: { id: string; title: string } | null;
  initial: AgentTechTipAi | null;
  generatedAt: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("AgentCockpit");
  const [stamp, setStamp] = useState<string | null>(generatedAt);
  const { submit, isLoading, object, error } = useObject({
    api: "/api/tech-tips/agent",
    schema: AgentTechTipSchema,
    onFinish: ({ object }) => {
      if (object) {
        saveAgentAi("tech_tip", object);
        setStamp(new Date().toISOString());
      }
    },
  });

  const live = object as Partial<AgentTechTipAi> | undefined;
  const focusTip = live?.focusTip ?? (isLoading ? undefined : initial?.focusTip);
  const generalTip = live?.generalTip ?? (isLoading ? undefined : initial?.generalTip);
  const hasResult = !!(focusTip || generalTip);
  const ago = formatAgo(stamp, locale);

  return (
    <Card className="border-amber/20 bg-amber/[0.03]">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-amber-dim text-amber">
              <Lightbulb className="size-3.5" />
            </span>
            {t("techTip.label")}
            <span className="rounded-full bg-amber-dim px-2 py-0.5 text-[10px] font-medium text-amber">{specialization}</span>
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
              className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground", error && "text-cc-red")}
              title={error ? t("techTip.retry") : t("techTip.newTip")}
            >
              <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
              {isLoading
                ? t("techTip.thinking")
                : hasResult
                  ? t("techTip.newTip")
                  : t("techTip.generate")}
            </button>
          </div>
        </div>

        {/* Idle (never generated) — invite the agent to run it. */}
        {!hasResult && !isLoading ? (
          <button
            type="button"
            onClick={() => submit({ locale })}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-amber/25 bg-card/40 px-4 py-6 text-center transition-colors hover:border-amber/50"
          >
            <Lightbulb className="size-5 text-amber" />
            <span className="text-xs text-muted-foreground">{t("techTip.idleHint")}</span>
            <span className="text-[11px] font-semibold text-amber">{t("techTip.generate")}</span>
          </button>
        ) : (
          <>
            {/* Focus-task tip */}
            {focusTask && (
              <div className="rounded-xl border border-amber/20 bg-card/40 p-3">
                <Link href={`/tasks/${focusTask.id}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan hover:underline">
                  {cleanTaskTitle(focusTask.title)} <ArrowLeft className="size-3 rtl:rotate-0 ltr:rotate-180" />
                </Link>
                <p className={cn("mt-1.5 text-sm leading-relaxed text-foreground/90", isLoading && !focusTip && "animate-pulse")}>
                  {focusTip || (isLoading ? t("techTip.analyzingTask") : "—")}
                </p>
              </div>
            )}

            {/* General specialization tip */}
            <div className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 size-3.5 shrink-0 text-amber" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {t("techTip.general", { specialization })}
                </p>
                <p className={cn("mt-1 text-sm leading-relaxed text-foreground/90", isLoading && !generalTip && "animate-pulse")}>
                  {generalTip || (isLoading ? t("techTip.preparing") : "—")}
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
