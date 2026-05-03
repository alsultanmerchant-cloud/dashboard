"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  recordContractEventAction,
  type ContractActionState,
} from "../_actions";

const COMMON_EVENTS: Array<{ key: string; label: string }> = [
  { key: "package_change", label: "تغيير الباقة" },
  { key: "hold", label: "تعليق" },
  { key: "resume", label: "استئناف" },
  { key: "lost", label: "فقد" },
  { key: "renew", label: "تجديد" },
  { key: "note", label: "ملاحظة" },
];

export function EventRecordForm({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ContractActionState | undefined, FormData>(
    recordContractEventAction,
    undefined,
  );
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        تسجيل حدث جديد
      </Button>
    );
  }

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="space-y-2 p-3 border border-border rounded-lg"
    >
      <input type="hidden" name="contract_id" value={contractId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="grow min-w-40">
          <label className="block text-[11px] text-muted-foreground mb-1">نوع الحدث</label>
          <Input
            list="event-types"
            name="event_type"
            placeholder="package_change"
            required
            className="text-sm"
          />
          <datalist id="event-types">
            {COMMON_EVENTS.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </datalist>
        </div>
      </div>
      <Textarea
        name="note"
        rows={2}
        placeholder="ملاحظة (اختياري)…"
        className="text-sm"
      />
      {state && "error" in state && state.error && (
        <p className="text-xs text-cc-red">{state.error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          حفظ
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
