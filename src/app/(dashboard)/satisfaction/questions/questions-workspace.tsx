"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  MessageCircleQuestion,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type {
  SatisfactionQuestionKind,
  SatisfactionQuestionRow,
} from "@/lib/satisfaction-questions";

const KIND_BADGE: Record<SatisfactionQuestionKind, string> = {
  recommendation: "border-cyan/20 bg-cyan-dim text-cyan",
  risk: "border-cc-red/30 bg-red-dim text-cc-red",
  accountability: "border-amber/30 bg-amber-dim text-amber",
};

type AnswerOutcome = "resolved" | "still_open";

export function QuestionsWorkspace({
  canManage,
  initialOpen,
  initialAnswered,
}: {
  canManage: boolean;
  initialOpen: SatisfactionQuestionRow[];
  initialAnswered: SatisfactionQuestionRow[];
}) {
  const t = useTranslations("SatisfactionPage");
  const [open, setOpen] = useState(initialOpen);
  const [answered, setAnswered] = useState(initialAnswered);

  const handleAnswered = (
    row: SatisfactionQuestionRow,
    outcome: AnswerOutcome,
    answer: string,
  ) => {
    setOpen((prev) => prev.filter((q) => q.id !== row.id));
    setAnswered((prev) => [
      {
        ...row,
        status: "answered",
        answer,
        answerOutcome: outcome,
        answeredAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { clientId: string; clientName: string; rows: SatisfactionQuestionRow[] }
    >();
    for (const row of open) {
      const group = map.get(row.clientId) ?? {
        clientId: row.clientId,
        clientName: row.clientName,
        rows: [],
      };
      group.rows.push(row);
      map.set(row.clientId, group);
    }
    return [...map.values()];
  }, [open]);

  return (
    <div className="space-y-5">
      {open.length === 0 ? (
        <EmptyState
          icon={<MessageCircleQuestion className="size-6" />}
          title={t("questions.empty")}
          description={t("questions.emptyHint")}
        />
      ) : (
        groups.map((group) => (
          <section key={group.clientId} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <h2
                className="truncate text-sm font-semibold text-foreground"
                data-private="client"
              >
                {group.clientName}
              </h2>
              <span className="shrink-0 rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[11px] text-muted-foreground">
                {t("questions.openCount", { count: group.rows.length })}
              </span>
            </div>
            <div className="space-y-3">
              {group.rows.map((row) => (
                <QuestionCard
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  onAnswered={handleAnswered}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {answered.length > 0 && (
        <details className="group rounded-xl border border-border bg-card/50">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            {t("questions.answeredRecently")}
            <span className="rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[11px] font-normal tabular-nums">
              {answered.length}
            </span>
          </summary>
          <div className="space-y-3 border-t border-border p-4">
            {answered.map((row) => (
              <AnsweredCard key={row.id} row={row} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function QuestionChips({ row }: { row: SatisfactionQuestionRow }) {
  const t = useTranslations("SatisfactionPage");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {row.responsibleName && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[11px] text-muted-foreground"
          data-private="person"
        >
          <User className="size-3" />
          {row.responsibleName}
        </span>
      )}
      {row.tasks.map((task) => (
        <Link
          key={task.id}
          href={`/tasks/${task.id}`}
          title={task.title ?? undefined}
          dir="ltr"
          className="inline-flex items-center rounded-full border border-cyan/20 bg-cyan/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-cyan transition-colors hover:bg-cyan/15"
        >
          {task.code}
        </Link>
      ))}
      <Link
        href={`/satisfaction?client=${row.clientId}#accountability`}
        className="inline-flex items-center gap-1 text-[11px] text-cyan hover:underline"
      >
        <ExternalLink className="size-3" />
        {t("questions.viewAnalysis")}
      </Link>
    </div>
  );
}

function QuestionCard({
  row,
  canManage,
  onAnswered,
}: {
  row: SatisfactionQuestionRow;
  canManage: boolean;
  onAnswered: (
    row: SatisfactionQuestionRow,
    outcome: AnswerOutcome,
    answer: string,
  ) => void;
}) {
  const t = useTranslations("SatisfactionPage");
  const [mode, setMode] = useState<AnswerOutcome | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!mode || note.trim().length < 3) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/satisfaction/questions/${row.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: mode, answer: note.trim() }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "");
      onAnswered(row, mode, note.trim());
      toast.success(t("questions.answerSaved"));
    } catch (e) {
      toast.error((e as Error).message || t("questions.answerFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            KIND_BADGE[row.kind],
          )}
        >
          {t(`questions.kind.${row.kind}`)}
        </span>
        <span
          dir="ltr"
          className="ms-auto text-[11px] tabular-nums text-muted-foreground/70"
        >
          {row.createdAt.slice(0, 10)}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold leading-relaxed text-foreground">
        {row.question}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground" data-private="chat">
        {row.issue}
      </p>
      {row.context && (
        <p
          className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70"
          data-private="chat"
        >
          {row.context}
        </p>
      )}
      <QuestionChips row={row} />

      {canManage &&
        (mode === null ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("resolved")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cc-green/25 bg-green-dim px-3 py-1.5 text-xs font-semibold text-cc-green transition-colors hover:bg-cc-green/15"
            >
              <CheckCircle2 className="size-3.5" />
              {t("questions.markResolved")}
            </button>
            <button
              type="button"
              onClick={() => setMode("still_open")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber/30 bg-amber-dim px-3 py-1.5 text-xs font-semibold text-amber transition-colors hover:bg-amber/15"
            >
              <AlertCircle className="size-3.5" />
              {t("questions.markStillOpen")}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t("questions.notePlaceholder")}
              className="w-full rounded-lg border border-border bg-soft-1/60 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-cyan/40"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={submitting || note.trim().length < 3}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/20 bg-cyan/10 px-3 py-1.5 text-xs font-semibold text-cyan transition-colors hover:bg-cyan/15 disabled:opacity-60"
              >
                {submitting ? t("questions.saving") : t("questions.submit")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode(null);
                  setNote("");
                }}
                disabled={submitting}
                className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-soft-1 disabled:opacity-60"
              >
                {t("questions.cancel")}
              </button>
              <span className="text-[11px] text-muted-foreground/70">
                {t(`questions.outcome.${mode}`)}
              </span>
            </div>
          </div>
        ))}
    </div>
  );
}

function AnsweredCard({ row }: { row: SatisfactionQuestionRow }) {
  const t = useTranslations("SatisfactionPage");
  const outcome = row.answerOutcome ?? "still_open";
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-xs font-semibold text-foreground" data-private="client">
          {row.clientName}
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            outcome === "resolved"
              ? "border-cc-green/25 bg-green-dim text-cc-green"
              : "border-amber/30 bg-amber-dim text-amber",
          )}
        >
          {t(`questions.outcome.${outcome}`)}
        </span>
        {row.answeredAt && (
          <span
            dir="ltr"
            className="ms-auto text-[11px] tabular-nums text-muted-foreground/70"
          >
            {row.answeredAt.slice(0, 10)}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{row.question}</p>
      {row.answer && (
        <p className="mt-1.5 text-xs leading-relaxed text-foreground" data-private="chat">
          {row.answer}
        </p>
      )}
    </div>
  );
}
