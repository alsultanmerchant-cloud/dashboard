"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  recordInstallmentReceivedAction,
  type ContractActionState,
} from "../_actions";

export function InstallmentReceiveForm({
  installmentId,
  expectedAmount,
}: {
  installmentId: string;
  expectedAmount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ContractActionState | undefined, FormData>(
    recordInstallmentReceivedAction,
    undefined,
  );
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        تسجيل استلام
      </Button>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="flex flex-wrap items-end gap-2 p-3 border border-border rounded-lg"
    >
      <input type="hidden" name="installment_id" value={installmentId} />
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">تاريخ الاستلام</label>
        <Input
          name="actual_date"
          type="date"
          defaultValue={today}
          required
          className="w-40"
        />
      </div>
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">المبلغ</label>
        <Input
          name="actual_amount"
          type="number"
          step="0.01"
          min="0"
          defaultValue={expectedAmount}
          required
          className="w-32 tabular-nums"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          حفظ
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
      {state && "error" in state && state.error && (
        <p className="basis-full text-xs text-cc-red">{state.error}</p>
      )}
    </form>
  );
}
