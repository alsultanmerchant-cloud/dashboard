"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addTimesheetAction, deleteTimesheetAction } from "./_subtask_timesheet_actions";

export type TimesheetRow = {
  id: string;
  spent_on: string;
  hours: number | string;
  description: string | null;
  employee: { id: string; full_name: string; user_id: string | null } | null;
  is_mine: boolean;
};

export function TimesheetsTab({
  taskId,
  rows,
  canEnter,
  canManage,
}: {
  taskId: string;
  rows: TimesheetRow[];
  canEnter: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("TaskDetailPage.timesheets");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [hours, setHours] = useState<string>("");
  const [spentOn, setSpentOn] = useState<string>(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState<string>("");
  const [pending, start] = useTransition();

  const total = rows.reduce((sum, r) => sum + Number(r.hours || 0), 0);

  const onAdd = () =>
    start(async () => {
      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) {
        toast.error(t("enterValidHours"));
        return;
      }
      const res = await addTimesheetAction({
        taskId,
        hours: h,
        spentOn,
        description: desc || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.added"));
      setHours("");
      setDesc("");
      setAdding(false);
      router.refresh();
    });

  const onDelete = (id: string) =>
    start(async () => {
      const res = await deleteTimesheetAction({ id, taskId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toasts.deleted"));
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("total")} <span className="font-semibold text-foreground tabular-nums">{total.toFixed(2)}</span>
        </p>
        {canEnter && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="ml-1 size-3.5" />
            {t("logHours")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-[auto_auto_1fr_auto]">
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t("date")}</label>
            <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className="h-9" disabled={pending} />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t("hours")}</label>
            <Input
              type="number"
              step="0.25"
              min="0"
              max="24"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="h-9 w-24"
              disabled={pending}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t("descriptionOptional")}</label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={1}
              className="min-h-9"
              disabled={pending}
              maxLength={1000}
            />
          </div>
          <div className="flex gap-2 self-end">
            <Button onClick={onAdd} disabled={pending} size="sm">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("save")}
            </Button>
            <Button onClick={() => setAdding(false)} disabled={pending} size="sm" variant="ghost">
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((r) => {
            const showDelete = canManage || r.is_mine;
            return (
              <li
                key={r.id}
                className="grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums" dir="ltr">
                  {r.spent_on}
                </span>
                <span className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                  {t("hoursValue", { count: Number(r.hours).toFixed(2) })}
                </span>
                <span className="min-w-0 truncate">
                  {r.description ? (
                    <span>{r.description}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {r.employee?.full_name ?? "—"}
                </span>
                {showDelete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(r.id)}
                    disabled={pending}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
