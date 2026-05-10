"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createProjectHolidayAction,
  deleteProjectHolidayAction,
} from "./_holiday_actions";

export type ProjectHolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  recurring: boolean;
};

export function ProjectHolidaysPanel({
  projectId,
  rows,
  canManage,
}: {
  projectId: string;
  rows: ProjectHolidayRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [recurring, setRecurring] = useState(false);

  const onAdd = () =>
    start(async () => {
      if (!date) {
        toast.error("اختر التاريخ");
        return;
      }
      if (name.trim().length < 2) {
        toast.error("اكتب اسم العطلة");
        return;
      }
      const res = await createProjectHolidayAction({
        projectId,
        date,
        name: name.trim(),
        recurring,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("أُضيفت العطلة وأُعيد حساب التواريخ");
      setDate("");
      setName("");
      setRecurring(false);
      router.refresh();
    });

  const onDelete = (id: string) =>
    start(async () => {
      const res = await deleteProjectHolidayAction({ id, projectId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("حُذفت العطلة وأُعيد حساب التواريخ");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-[auto_1fr_auto_auto]">
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              التاريخ
            </label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              dir="ltr"
              className="h-9"
              disabled={pending}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              اسم العطلة
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: إغلاق العميل · إجازة الفريق"
              maxLength={120}
              disabled={pending}
              className="h-9"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end rounded-md border bg-background px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              disabled={pending}
              className="size-3.5"
            />
            <RefreshCw className="size-3.5 text-muted-foreground" />
            تتكرر سنويًا
          </label>
          <Button onClick={onAdd} disabled={pending} className="self-end">
            {pending ? (
              <Loader2 className="ml-1 size-3.5 animate-spin" />
            ) : (
              <Plus className="ml-1 size-3.5" />
            )}
            إضافة
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          لا توجد عطلات خاصة بهذا المشروع. تُضاف هنا أيام الإغلاق التي يطلبها
          العميل أو فترات تجميد المشروع بحيث تُزاح تواريخ المهام تلقائيًا.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((h) => (
            <li
              key={h.id}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <span
                className="shrink-0 font-mono text-xs tabular-nums"
                dir="ltr"
              >
                {h.recurring ? h.holiday_date.slice(5) : h.holiday_date}
              </span>
              <span className="min-w-0 truncate">{h.name}</span>
              {h.recurring && (
                <span className="shrink-0 rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] text-cyan">
                  سنوية
                </span>
              )}
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(h.id)}
                  disabled={pending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
