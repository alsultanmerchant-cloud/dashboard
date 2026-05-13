"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Check, Trash2, Phone, Mail, Eye, Upload, Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createActivityAction,
  completeActivityAction,
  deleteActivityAction,
} from "./_activity_actions";

export type ActivityType = "call" | "email" | "review" | "upload" | "other";

export type ActivityRow = {
  id: string;
  activity_type: ActivityType;
  summary: string;
  due_date: string | null;
  completed_at: string | null;
  assignee_name: string | null;
};

const TYPE_ICONS: Record<ActivityType, React.ElementType> = {
  call:   Phone,
  email:  Mail,
  review: Eye,
  upload: Upload,
  other:  Bell,
};

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dueDate);
  d.setHours(0, 0, 0, 0);
  return d < today;
}

export function ActivitiesTab({
  taskId,
  rows,
  canManage,
}: {
  taskId: string;
  rows: ActivityRow[];
  canManage: boolean;
}) {
  const t = useTranslations("TaskDetailPage.activities");
  const typeLabels: Record<ActivityType, string> = {
    call: t("types.call"),
    email: t("types.email"),
    review: t("types.review"),
    upload: t("types.upload"),
    other: t("types.other"),
  };
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ActivityType>("other");
  const [summary, setSummary] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, start] = useTransition();

  const onAdd = () =>
    start(async () => {
      const trimmed = summary.trim();
      if (!trimmed) {
        toast.error(t("enterSummary"));
        return;
      }
      const res = await createActivityAction({
        taskId,
        activityType: type,
        summary: trimmed,
        dueDate: dueDate || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.added"));
      setSummary("");
      setDueDate("");
      setType("other");
      setAdding(false);
      router.refresh();
    });

  const onComplete = (id: string) =>
    start(async () => {
      const res = await completeActivityAction({ id, taskId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.completed"));
      router.refresh();
    });

  const onDelete = (id: string) =>
    start(async () => {
      const res = await deleteActivityAction({ id, taskId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.deleted"));
      router.refresh();
    });

  const open = rows.filter((r) => !r.completed_at);
  const done = rows.filter((r) => r.completed_at);

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
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ActivityType)}
            disabled={pending}
            className="h-9 rounded-md border bg-background px-2 text-xs"
          >
            {(Object.keys(typeLabels) as ActivityType[]).map((k) => (
              <option key={k} value={k}>
                {typeLabels[k]}
              </option>
            ))}
          </select>
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder={t("placeholder")}
            disabled={pending}
            maxLength={500}
            className="h-9 min-w-[14rem] flex-1"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={pending}
            className="h-9 w-40"
            dir="ltr"
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

      {open.length === 0 && done.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {open.map((a) => {
            const overdue = isOverdue(a.due_date);
            const Icon = TYPE_ICONS[a.activity_type];
            return (
              <li
                key={a.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm",
                  overdue && "border-red-300/40 bg-red-500/5",
                )}
              >
                <Icon className={cn("size-3.5 shrink-0", overdue ? "text-red-500" : "text-muted-foreground")} />
                <span className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {typeLabels[a.activity_type]}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                {a.assignee_name && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {a.assignee_name}
                  </span>
                )}
                {a.due_date && (
                  <span
                    className={cn(
                      "shrink-0 tabular-nums text-[11px]",
                      overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground",
                    )}
                    dir="ltr"
                  >
                    {a.due_date}
                  </span>
                )}
                {overdue && (
                  <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                    {t("overdue")}
                  </span>
                )}
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => onComplete(a.id)}
                      disabled={pending}
                      title={t("complete")}
                      className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-500/10"
                    >
                      <Check className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(a.id)}
                      disabled={pending}
                      title={t("delete")}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-cc-red"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
          {done.length > 0 && (
            <li className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("done")}
            </li>
          )}
          {done.map((a) => {
            const Icon = TYPE_ICONS[a.activity_type];
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground line-through"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px]">
                  {typeLabels[a.activity_type]}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                {a.due_date && (
                  <span className="shrink-0 tabular-nums text-[11px]" dir="ltr">
                    {a.due_date}
                  </span>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    disabled={pending}
                    title={t("delete")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-cc-red"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
