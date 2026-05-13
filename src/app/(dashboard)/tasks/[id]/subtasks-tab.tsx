"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSubtaskAction } from "./_subtask_timesheet_actions";

export type SubtaskRow = {
  id: string;
  title: string;
  task_code: string | null;
  stage: string;
  planned_date: string | null;
};

export function SubtasksTab({
  parentTaskId,
  subtasks,
  canManage,
}: {
  parentTaskId: string;
  subtasks: SubtaskRow[];
  canManage: boolean;
}) {
  const t = useTranslations("TaskDetailPage.subtasks");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();

  const onAdd = () =>
    start(async () => {
      const trimmed = title.trim();
      if (!trimmed) {
        toast.error(t("enterTitle"));
        return;
      }
      const res = await createSubtaskAction({ parentTaskId, title: trimmed });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.created"));
      setTitle("");
      setAdding(false);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("description")}
        </p>
        {canManage && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="ml-1 size-3.5" />
            {t("add")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex items-end gap-2 rounded-md border bg-muted/20 p-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder={t("placeholder")}
            disabled={pending}
            maxLength={200}
            className="h-9 flex-1"
          />
          <Button onClick={onAdd} disabled={pending} size="sm">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("save")}
          </Button>
          <Button onClick={() => setAdding(false)} size="sm" variant="ghost" disabled={pending}>
            {t("cancel")}
          </Button>
        </div>
      )}

      {subtasks.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {subtasks.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
            >
              {s.task_code && (
                <span
                  className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  dir="ltr"
                >
                  {s.task_code}
                </span>
              )}
              <Link
                href={`/tasks/${s.id}`}
                className="min-w-0 flex-1 truncate hover:text-cyan transition-colors"
              >
                {s.title}
              </Link>
              <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                {s.stage}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
