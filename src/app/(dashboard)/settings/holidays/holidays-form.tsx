"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createHolidayAction, deleteHolidayAction } from "./_actions";

export type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  recurring: boolean;
};

export function HolidaysForm({
  rows,
  canManage,
}: {
  rows: HolidayRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [name, setName] = useState("");
  const [recurring, setRecurring] = useState(false);

  const onAdd = () =>
    start(async () => {
      if (!startDate) return toast.error("اختر تاريخ البداية");
      if (endDate && endDate < startDate)
        return toast.error("تاريخ النهاية يجب أن يكون بعد البداية");
      if (name.trim().length < 2) return toast.error("اكتب اسم الإجازة");
      const res = await createHolidayAction({
        startDate,
        endDate: endDate || null,
        name: name.trim(),
        recurring,
      });
      if ("error" in res) return toast.error(res.error);
      const s = res.summary;
      const rangeLabel =
        s.start === s.end ? s.start : `${s.start} → ${s.end}`;
      if (s.affected_tasks === 0) {
        toast.success(
          `أُضيفت الإجازة (${rangeLabel}). لم تتأثر أي مهام نشطة.`,
        );
      } else {
        toast.success(
          `أُضيفت الإجازة (${rangeLabel}). تم ترحيل ${s.affected_tasks} مهمة عبر ${s.affected_projects} مشروع.`,
          { duration: 8000 },
        );
      }
      setStartDate("");
      setEndDate("");
      setName("");
      setRecurring(false);
      router.refresh();
    });

  const onDelete = (id: string) =>
    start(async () => {
      const res = await deleteHolidayAction({ id });
      if ("error" in res) return toast.error(res.error);
      toast.success("حُذفت الإجازة");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-[auto_auto_1fr_auto_auto]">
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">من</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              dir="ltr"
              className="h-9"
              disabled={pending}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              إلى (اختياري)
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              dir="ltr"
              className="h-9"
              disabled={pending}
              title="اتركه فارغًا ليوم واحد"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium text-muted-foreground">اسم الإجازة</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: اليوم الوطني"
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
            {pending ? <Loader2 className="ml-1 size-3.5 animate-spin" /> : <Plus className="ml-1 size-3.5" />}
            إضافة
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          لم تُسجَّل إجازات بعد. أضف أيام العطل الرسمية والشركة هنا حتى تتجنبها حسابات الجدولة.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((h) => (
            <li
              key={h.id}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <span className="shrink-0 font-mono text-xs tabular-nums" dir="ltr">
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
