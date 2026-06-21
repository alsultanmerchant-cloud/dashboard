"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import {
  AlertTriangle,
  RotateCcw,
  Hourglass,
  Sparkles,
  RefreshCw,
  Target,
  ListChecks,
  Lightbulb,
  ArrowLeft,
  ChevronLeft,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/lib/agent-ai-cache-client";
import { FailureLessonSchema, type FailureLesson } from "@/lib/my-performance/lesson-schema";
import type { MyFailureItem, FailureKind } from "@/lib/data/my-performance";

const FAILURE_META: Record<
  FailureKind,
  { icon: typeof AlertTriangle; tone: string; chip: string }
> = {
  overdue: { icon: AlertTriangle, tone: "text-cc-red", chip: "bg-red-dim text-cc-red" },
  rework: { icon: RotateCcw, tone: "text-amber", chip: "bg-amber-dim text-amber" },
  slow: { icon: Hourglass, tone: "text-cc-purple", chip: "bg-purple-dim text-cc-purple" },
};

// Business minutes → working days (8h day), 1 decimal.
const toDays = (min: number | null) => (min == null ? null : Math.round((min / 480) * 10) / 10);

export function FailuresList({ items }: { items: MyFailureItem[] }) {
  const t = useTranslations("MyPerformance");
  const ts = useTranslations("TasksBoard");
  const locale = useLocale();

  const [selected, setSelected] = useState<MyFailureItem | null>(null);
  // Lesson served from the persistent cache (instant, no Gemini call).
  const [cached, setCached] = useState<FailureLesson | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loadingCache, setLoadingCache] = useState(false);
  // Guards against a slow cache fetch resolving after the user opened another row.
  const reqRef = useRef<string>("");

  const { submit, object, isLoading, error, clear } = useObject({
    api: "/api/my-performance/lesson",
    schema: FailureLessonSchema,
    onFinish: ({ object: o }) => {
      // A fresh stream was just persisted server-side; stamp it "now".
      if (o) setGeneratedAt(new Date().toISOString());
    },
  });

  // Stream a fresh lesson (cache miss or manual regenerate).
  const stream = useCallback(
    (taskId: string) => {
      setCached(null);
      setGeneratedAt(null);
      clear();
      submit({ taskId, locale });
    },
    [submit, clear, locale],
  );

  const open = useCallback(
    async (item: MyFailureItem) => {
      setSelected(item);
      setCached(null);
      setGeneratedAt(null);
      clear();
      setLoadingCache(true);
      reqRef.current = item.taskId;
      try {
        const res = await fetch(
          `/api/my-performance/lesson?taskId=${encodeURIComponent(item.taskId)}`,
        );
        const json = (await res.json().catch(() => ({}))) as {
          lesson?: FailureLesson | null;
          generatedAt?: string | null;
        };
        if (reqRef.current !== item.taskId) return; // user moved on
        if (json.lesson) {
          setCached(json.lesson);
          setGeneratedAt(json.generatedAt ?? null);
        } else {
          stream(item.taskId);
        }
      } catch {
        if (reqRef.current === item.taskId) stream(item.taskId);
      } finally {
        if (reqRef.current === item.taskId) setLoadingCache(false);
      }
    },
    [clear, stream],
  );

  const close = useCallback(() => {
    reqRef.current = "";
    setSelected(null);
    setCached(null);
    setGeneratedAt(null);
    clear();
  }, [clear]);

  const stageLabel = (stage: string) => ts(`stages.${stage}` as never);

  const kindLabel = (k: FailureKind) =>
    k === "overdue"
      ? t("failures.kindOverdue")
      : k === "rework"
        ? t("failures.kindRework")
        : t("failures.kindSlow");

  const detailLabel = (item: MyFailureItem) => {
    if (item.kind === "overdue")
      return item.delayDays != null
        ? t("failures.delayDays", { n: item.delayDays })
        : kindLabel(item.kind);
    if (item.kind === "rework")
      return t("failures.reworkTimes", { n: item.reworkCount });
    const d = toDays(item.maxDwellMinutes);
    return d != null ? t("failures.dwellDays", { n: Math.round(d) }) : kindLabel(item.kind);
  };

  // The lesson to render: a streaming object wins; otherwise the cached one.
  const view = object ?? cached;
  const rootCauses = (view?.rootCauses ?? []).filter(Boolean) as string[];
  const improvements = (view?.improvements ?? []).filter(Boolean) as string[];
  const busy = loadingCache || (isLoading && !object);
  const maxStageDwell = selected ? Math.max(...selected.stages.map((s) => s.dwellMinutes), 1) : 1;
  const ago = generatedAt && !isLoading && !loadingCache ? formatAgo(generatedAt, locale) : "";

  return (
    <>
      <div className="space-y-1.5">
        {items.map((item) => {
          const meta = FAILURE_META[item.kind];
          return (
            <button
              key={item.taskId}
              type="button"
              onClick={() => open(item)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-right text-xs transition-all hover:border-cyan/40 hover:bg-soft-1"
            >
              <span className="flex min-w-0 items-center gap-2">
                <meta.icon className={cn("size-4 shrink-0", meta.tone)} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  {(item.projectName || item.clientName) && (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {[item.projectName, item.clientName].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {item.taskCode && (
                  <span className="font-mono text-[10px] text-muted-foreground ltr">
                    {item.taskCode}
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    meta.chip,
                  )}
                >
                  {kindLabel(item.kind)} · {detailLabel(item)}
                </span>
                <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground ltr:rotate-180" />
              </span>
            </button>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-start gap-2 text-sm">
                  {(() => {
                    const M = FAILURE_META[selected.kind].icon;
                    return (
                      <M className={cn("mt-0.5 size-4 shrink-0", FAILURE_META[selected.kind].tone)} />
                    );
                  })()}
                  <span className="min-w-0">
                    <span className="block">{selected.title}</span>
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      {[selected.projectName, selected.clientName].filter(Boolean).join(" · ")}
                      {selected.taskCode ? ` · ${selected.taskCode}` : ""}
                    </span>
                  </span>
                </DialogTitle>
              </DialogHeader>

              {/* Facts */}
              <div className="flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    FAILURE_META[selected.kind].chip,
                  )}
                >
                  {kindLabel(selected.kind)} · {detailLabel(selected)}
                </span>
              </div>

              {/* Where the time went */}
              {selected.stages.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("failures.timeByStage")}
                  </p>
                  <div className="space-y-1">
                    {selected.stages.map((s) => {
                      const days = toDays(s.dwellMinutes);
                      return (
                        <div key={s.stage} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0 truncate text-muted-foreground">
                            {stageLabel(s.stage)}
                          </span>
                          <span className="relative h-4 flex-1 overflow-hidden rounded bg-soft-2">
                            <span
                              className="absolute inset-y-0 right-0 bg-cyan/40 ltr:left-0 ltr:right-auto"
                              style={{ width: `${Math.max(4, (s.dwellMinutes / maxStageDwell) * 100)}%` }}
                            />
                          </span>
                          <span className="w-16 shrink-0 text-left tabular-nums text-muted-foreground ltr:text-right">
                            {days != null ? t("failures.daysShort", { n: days }) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI lesson */}
              <div className="space-y-3 rounded-xl border border-cyan/20 bg-cyan/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan">
                    <Sparkles className="size-3.5" />
                    {t("failures.lesson.title")}
                  </span>
                  <div className="flex items-center gap-2">
                    {ago && (
                      <span className="text-[10px] text-muted-foreground">
                        {t("failures.lesson.saved")} · {ago}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => stream(selected.taskId)}
                      disabled={busy}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground",
                        error && "text-cc-red",
                      )}
                      title={error ? t("failures.lesson.retry") : t("failures.lesson.refresh")}
                    >
                      <RefreshCw className={cn("size-3", busy && "animate-spin")} />
                      {busy ? t("failures.lesson.analyzing") : t("failures.lesson.refresh")}
                    </button>
                  </div>
                </div>

                {error && !busy && (
                  <p className="text-xs text-cc-red">{t("failures.lesson.failed")}</p>
                )}

                {/* what happened */}
                <p
                  className={cn(
                    "text-sm leading-relaxed text-foreground/90",
                    busy && !view?.whatHappened && "animate-pulse text-muted-foreground",
                  )}
                >
                  {view?.whatHappened || (busy ? t("failures.lesson.analyzing") : "—")}
                </p>

                {/* root causes */}
                {rootCauses.length > 0 && (
                  <div>
                    <p className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <Target className="size-3.5 text-amber" />
                      {t("failures.lesson.rootCauses")}
                    </p>
                    <ul className="space-y-1">
                      {rootCauses.map((c, i) => (
                        <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-foreground/85">
                          <span className="mt-1 size-1 shrink-0 rounded-full bg-amber" />
                          <span className="min-w-0">{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* the lesson */}
                {view?.lesson && (
                  <div className="flex items-start gap-2 rounded-lg border border-cyan/20 bg-card/40 p-2.5">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-cyan" />
                    <p className="text-sm leading-relaxed text-foreground/90">{view.lesson}</p>
                  </div>
                )}

                {/* improvements */}
                {improvements.length > 0 && (
                  <div>
                    <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <ListChecks className="size-3.5 text-cc-green" />
                      {t("failures.lesson.improvements")}
                    </p>
                    <ul className="space-y-1.5">
                      {improvements.map((a, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-green-dim text-[10px] font-bold tabular-nums text-cc-green">
                            {i + 1}
                          </span>
                          <span className="min-w-0">{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <Link
                href={`/tasks/${selected.taskId}`}
                className="inline-flex items-center gap-1.5 text-xs text-cyan hover:underline"
              >
                {t("failures.viewTask")}
                <ArrowLeft className="size-3.5 ltr:rotate-180" />
              </Link>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
