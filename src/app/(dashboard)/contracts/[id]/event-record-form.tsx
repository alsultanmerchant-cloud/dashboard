"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  recordContractEventAction,
  type ContractActionState,
} from "../_actions";

const COMMON_EVENTS: Array<{ key: string }> = [
  { key: "package_change" },
  { key: "hold" },
  { key: "resume" },
  { key: "lost" },
  { key: "renew" },
  { key: "note" },
];

export function EventRecordForm({ contractId }: { contractId: string }) {
  const t = useTranslations("ContractsPage");
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ContractActionState | undefined, FormData>(
    recordContractEventAction,
    undefined,
  );
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("eventForm.openButton")}
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
          <label className="block text-[11px] text-muted-foreground mb-1">
            {t("eventForm.fields.type")}
          </label>
          <Input
            list="event-types"
            name="event_type"
            placeholder={t("eventForm.placeholders.type")}
            required
            className="text-sm"
          />
          <datalist id="event-types">
            {COMMON_EVENTS.map((e) => (
              <option key={e.key} value={e.key}>
                {t(`eventForm.types.${e.key}` as const)}
              </option>
            ))}
          </datalist>
        </div>
      </div>
      <Textarea
        name="note"
        rows={2}
        placeholder={t("eventForm.placeholders.note")}
        className="text-sm"
      />
      {state && "error" in state && state.error && (
        <p className="text-xs text-cc-red">{state.error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("eventForm.actions.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("eventForm.actions.cancel")}
        </Button>
      </div>
    </form>
  );
}
