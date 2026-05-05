"use client";

import { useActionState, useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { openExceptionAction, type EscalationActionState } from "./_actions";

const KINDS = [
  { key: "client", label: "استثناء عميل" },
  { key: "deadline", label: "تجاوز موعد" },
  { key: "quality", label: "جودة" },
  { key: "resource", label: "موارد" },
] as const;

export function TaskExceptionBadge({
  taskId,
  hasOpenException,
  canOpen,
}: {
  taskId: string;
  hasOpenException: boolean;
  canOpen: boolean;
}) {
  const [openDialog, setOpenDialog] = useState(false);
  const [state, formAction] = useActionState<EscalationActionState | undefined, FormData>(
    openExceptionAction,
    undefined,
  );
  const [pending, startTransition] = useTransition();

  if (state?.ok && openDialog) {
    // close on success
    setTimeout(() => setOpenDialog(false), 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasOpenException && (
        <Badge variant="destructive" className="gap-1">
          <ShieldAlert className="size-3" />
          استثناء مفتوح
        </Badge>
      )}
      {canOpen && (
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              فتح استثناء
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>فتح استثناء على المهمة</DialogTitle>
            </DialogHeader>
            <form
              action={(fd) => startTransition(() => formAction(fd))}
              className="space-y-3"
            >
              <input type="hidden" name="task_id" value={taskId} />
              <div>
                <label className="mb-1 block text-xs font-medium">نوع الاستثناء</label>
                <select
                  name="kind"
                  required
                  className="w-full rounded-md border border-soft-2 bg-transparent px-3 py-2 text-sm"
                  defaultValue="client"
                >
                  {KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">السبب</label>
                <Textarea name="reason" rows={4} required minLength={3} />
                {state?.fieldErrors?.reason && (
                  <p className="text-xs text-cc-red">{state.fieldErrors.reason}</p>
                )}
              </div>
              {state?.error && !state.fieldErrors && (
                <p className="text-xs text-cc-red">{state.error}</p>
              )}
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpenDialog(false)}
                >
                  إلغاء
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "جارٍ الفتح…" : "فتح الاستثناء"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
