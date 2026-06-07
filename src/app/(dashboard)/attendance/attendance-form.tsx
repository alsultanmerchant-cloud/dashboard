"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordAttendanceAction, type AttendanceActionState } from "./_actions";

type Member = { id: string; full_name: string };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "present", label: "حاضر" },
  { value: "late", label: "متأخر" },
  { value: "absent", label: "غائب" },
  { value: "remote", label: "عن بُعد" },
  { value: "half_day", label: "نصف يوم" },
  { value: "leave", label: "إجازة" },
];

export function AttendanceForm({ members, today }: { members: Member[]; today: string }) {
  const [state, action, pending] = useActionState<AttendanceActionState | undefined, FormData>(
    recordAttendanceAction,
    undefined,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="sm:col-span-2">
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
        <Label htmlFor="work_date">التاريخ</Label>
        <Input id="work_date" name="work_date" type="date" defaultValue={today} required className="mt-1" />
      </div>

      <div>
        <Label htmlFor="status">الحالة</Label>
        <select
          id="status"
          name="status"
          defaultValue="present"
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="late_minutes">دقائق التأخير</Label>
        <Input id="late_minutes" name="late_minutes" type="number" min={0} defaultValue={0} className="mt-1" />
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        <Label htmlFor="note">ملاحظة</Label>
        <Input id="note" name="note" className="mt-1" />
      </div>

      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "جارٍ الحفظ…" : "تسجيل"}
        </Button>
      </div>

      {state?.error && <p className="sm:col-span-full text-xs text-cc-red">{state.error}</p>}
      {state?.ok && <p className="sm:col-span-full text-xs text-cc-green">تم حفظ سجل الحضور.</p>}
    </form>
  );
}
