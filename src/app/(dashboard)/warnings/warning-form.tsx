"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { issueWarningAction, type WarningActionState } from "./_actions";

type Member = { id: string; full_name: string };

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: "verbal", label: "شفهي" },
  { value: "written", label: "كتابي" },
  { value: "final", label: "نهائي" },
  { value: "suspension", label: "إيقاف" },
];

export function WarningForm({ members }: { members: Member[] }) {
  const [state, action, pending] = useActionState<WarningActionState | undefined, FormData>(
    issueWarningAction,
    undefined,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="employee_profile_id">الموظف</Label>
        <select
          id="employee_profile_id"
          name="employee_profile_id"
          required
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">— اختر —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
        {state?.fieldErrors?.employee_profile_id && (
          <p className="mt-1 text-[11px] text-cc-red">{state.fieldErrors.employee_profile_id}</p>
        )}
      </div>

      <div>
        <Label htmlFor="severity">الدرجة</Label>
        <select
          id="severity"
          name="severity"
          defaultValue="verbal"
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="reason">السبب</Label>
        <Input id="reason" name="reason" required className="mt-1" />
        {state?.fieldErrors?.reason && (
          <p className="mt-1 text-[11px] text-cc-red">{state.fieldErrors.reason}</p>
        )}
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="detail">تفاصيل (اختياري)</Label>
        <Textarea id="detail" name="detail" rows={3} className="mt-1" />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الإصدار…" : "إصدار إنذار"}
        </Button>
        {state?.error && <p className="text-xs text-cc-red">{state.error}</p>}
        {state?.ok && <p className="text-xs text-cc-green">تم إصدار الإنذار.</p>}
      </div>
    </form>
  );
}
