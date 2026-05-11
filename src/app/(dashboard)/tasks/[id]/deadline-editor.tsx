"use client";

import { useState, useTransition } from "react";
import { Pencil, Check, X, Loader2, CalendarPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setTaskDeadlineAction } from "./_deadline_actions";

export function DeadlineEditor({
  taskId,
  initialDate,
  overdue,
  canEdit,
}: {
  taskId: string;
  initialDate: string | null;
  overdue: boolean;
  canEdit: boolean;
}) {
  const [value, setValue] = useState<string | null>(initialDate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDate ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  }

  function save(next: string | null) {
    startTransition(async () => {
      const res = await setTaskDeadlineAction({
        taskId,
        plannedDate: next,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setValue(next);
      setEditing(false);
      setError(null);
    });
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          type="date"
          className="h-7 w-40 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          dir="ltr"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => save(draft || null)}
          disabled={pending}
          className="h-7 gap-1"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          حفظ
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={pending}
          className="h-7 gap-1"
        >
          <X className="size-3.5" />
          إلغاء
        </Button>
        {value && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => save(null)}
            disabled={pending}
            className="h-7 gap-1 text-cc-red hover:text-cc-red"
          >
            <Trash2 className="size-3.5" />
            إزالة
          </Button>
        )}
        {error && <span className="w-full text-[11px] text-cc-red">{error}</span>}
      </div>
    );
  }

  if (!value) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">لا يوجد موعد نهائي</span>
        {canEdit && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded-md border border-cyan/30 bg-cyan-dim/30 px-2 py-0.5 text-[11px] font-medium text-cyan hover:bg-cyan-dim/50"
          >
            <CalendarPlus className="size-3" />
            إضافة موعد
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn("tabular-nums", overdue && "text-cc-red font-semibold")}
        dir="ltr"
      >
        {value}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={startEdit}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="تعديل الموعد النهائي"
          title="تعديل الموعد النهائي"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}
