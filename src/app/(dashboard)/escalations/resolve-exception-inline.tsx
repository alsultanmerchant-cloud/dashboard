"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveExceptionAction, type EscalationActionState } from "./_actions";

export function ResolveExceptionInline({ exceptionId }: { exceptionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<EscalationActionState | undefined, FormData>(
    resolveExceptionAction,
    undefined,
  );
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        إغلاق الاستثناء
      </Button>
    );
  }

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="w-full md:w-72 space-y-2"
    >
      <input type="hidden" name="id" value={exceptionId} />
      <Textarea
        name="note"
        required
        minLength={3}
        rows={3}
        placeholder="ملاحظة الإغلاق…"
        className="text-sm"
      />
      {state?.fieldErrors?.note && (
        <p className="text-xs text-cc-red">{state.fieldErrors.note}</p>
      )}
      {state?.error && !state.fieldErrors && (
        <p className="text-xs text-cc-red">{state.error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          حفظ
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          إلغاء
        </Button>
      </div>
    </form>
  );
}
