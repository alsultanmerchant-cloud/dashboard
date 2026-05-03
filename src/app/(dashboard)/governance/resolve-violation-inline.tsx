"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveViolationAction, type GovernanceActionState } from "./_actions";

export function ResolveViolationInline({ violationId }: { violationId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<GovernanceActionState | undefined, FormData>(
    resolveViolationAction,
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
        إغلاق المخالفة
      </Button>
    );
  }

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="w-full md:w-72 space-y-2"
    >
      <input type="hidden" name="id" value={violationId} />
      <Textarea
        name="note"
        rows={3}
        placeholder="ملاحظة الإغلاق (اختياري)…"
        className="text-sm"
      />
      {state && "error" in state && state.error && (
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
