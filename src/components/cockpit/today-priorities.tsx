"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, RefreshCw, ArrowLeft, Flame, Clock, UploadCloud, Link2 } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TASK_STAGE_LABELS, TASK_STAGE_LABELS_EN, type TaskStage } from "@/lib/labels";
import { cleanTaskTitle } from "@/components/cockpit/task-row";
import { AgentPrioritiesSchema } from "@/lib/agent-priorities/schema";
import { saveAgentAi, formatAgo } from "@/lib/agent-ai-cache-client";

// Cached AI prose payload (migration 0206): per-task reason + suggestedAction,
// merged over the live code-ranked rows. Tasks no longer present fall back to
// their heuristic hint; new tasks simply have no AI prose until re-analysed.
export interface CachedPriorityAi {
  items: { taskId: string; reason: string; suggestedAction: string }[];
}

// Serializable subset of PrioritySignal passed from the server. The code-ranked
// order is preserved; the AI only fills reason/suggestedAction (with the
// heuristic *Hint fields as the graceful fallback).
export interface PriorityItem {
  taskId: string;
  title: string;
  taskCode: string | null;
  stage: string;
  projectName: string | null;
  clientName: string | null;
  isOverdue: boolean;
  slaOverByHours: number | null;
  uploadSoon: boolean;
  dependentsCount: number;
  reasonHint: string;
  actionHint: string;
}

function Tag({ icon: Icon, label, tone }: { icon: typeof Flame; label: string; tone: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", tone)}>
      <Icon className="size-2.5" /> {label}
    </span>
  );
}

export function TodayPriorities({
  initialItems,
  initialAi,
  generatedAt,
}: {
  initialItems: PriorityItem[];
  initialAi: CachedPriorityAi | null;
  generatedAt: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("AgentCockpit");
  const stageLabel = (stage: string) =>
    locale === "en"
      ? TASK_STAGE_LABELS_EN[stage as TaskStage] ?? stage
      : TASK_STAGE_LABELS[stage as TaskStage] ?? stage;
  // AI prose keyed by taskId, merged over the code-ranked initialItems. Seeded
  // from the cached result (migration 0206) so prose shows without a fresh call.
  const [aiText, setAiText] = useState<Record<string, { reason: string; suggestedAction: string }>>(
    () => {
      const seed: Record<string, { reason: string; suggestedAction: string }> = {};
      for (const it of initialAi?.items ?? []) {
        if (it?.taskId) seed[it.taskId] = { reason: it.reason ?? "", suggestedAction: it.suggestedAction ?? "" };
      }
      return seed;
    },
  );
  const [stamp, setStamp] = useState<string | null>(generatedAt);

  const { submit, isLoading, object, error } = useObject({
    api: "/api/agent-priorities",
    schema: AgentPrioritiesSchema,
    onFinish: ({ object }) => {
      if (!object?.items) return;
      const next: Record<string, { reason: string; suggestedAction: string }> = {};
      const payload: CachedPriorityAi = { items: [] };
      for (const it of object.items) {
        if (it?.taskId) {
          next[it.taskId] = { reason: it.reason ?? "", suggestedAction: it.suggestedAction ?? "" };
          payload.items.push({ taskId: it.taskId, reason: it.reason ?? "", suggestedAction: it.suggestedAction ?? "" });
        }
      }
      setAiText(next);
      setStamp(new Date().toISOString());
      saveAgentAi("today_priorities", payload);
    },
  });

  const hasAi = Object.keys(aiText).length > 0;
  const ago = formatAgo(stamp, locale);

  // Live-merge streaming partials so prose appears as it arrives.
  const streaming = useMemo(() => {
    const m: Record<string, { reason?: string; suggestedAction?: string }> = {};
    for (const it of object?.items ?? []) {
      if (it?.taskId) m[it.taskId] = { reason: it.reason, suggestedAction: it.suggestedAction };
    }
    return m;
  }, [object]);

  if (initialItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          {t("priorities.empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="size-3.5 text-cyan" /> {t("priorities.ranked")}
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
            title={error ? t("priorities.retry") : t("priorities.rerank")}
          >
            <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
            {isLoading
              ? t("priorities.analyzing")
              : hasAi
                ? t("growth.reanalyse")
                : t("priorities.enhance")}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {initialItems.map((it, i) => {
          const ai = aiText[it.taskId] ?? streaming[it.taskId];
          const reason = ai?.reason || it.reasonHint;
          const action = ai?.suggestedAction || it.actionHint;
          const pending = isLoading && !ai?.reason;
          return (
            <Card key={it.taskId} className="border-cyan/15">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-cyan-dim text-[11px] font-bold text-cyan tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/tasks/${it.taskId}`} className="text-sm font-semibold hover:text-cyan">
                        {cleanTaskTitle(it.title)}
                      </Link>
                      {it.projectName ? (
                        <span
                          className="max-w-[14rem] truncate rounded bg-cyan-dim px-1.5 py-0.5 text-[10px] text-cyan"
                          title={it.taskCode ? `${it.projectName} · ${it.taskCode}` : it.projectName}
                        >
                          {it.projectName}
                        </span>
                      ) : it.taskCode ? (
                        <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground/70 ltr">
                          {it.taskCode}
                        </span>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground">{stageLabel(it.stage)}</span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {it.slaOverByHours != null && (
                        <Tag icon={Flame} label={t("priorities.slaOver", { count: it.slaOverByHours })} tone="bg-red-dim text-cc-red" />
                      )}
                      {it.isOverdue && it.slaOverByHours == null && (
                        <Tag icon={Clock} label={t("overdue")} tone="bg-red-dim text-cc-red" />
                      )}
                      {it.uploadSoon && <Tag icon={UploadCloud} label={t("priorities.uploadDue")} tone="bg-amber-dim text-amber" />}
                      {it.dependentsCount > 0 && (
                        <Tag icon={Link2} label={t("priorities.dependents", { count: it.dependentsCount })} tone="bg-cyan-dim text-cyan" />
                      )}
                    </div>

                    <p className={cn("text-xs text-muted-foreground leading-relaxed", pending && "animate-pulse")}>
                      {reason}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <ArrowLeft className="size-3 shrink-0 text-cc-green rtl:rotate-0 ltr:rotate-180" />
                      <p className={cn("text-xs font-medium text-foreground/90", pending && "animate-pulse")}>
                        {action}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
