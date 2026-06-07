"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  upsertEmployeeTargetAction,
  upsertDepartmentTargetAction,
  type TargetActionState,
} from "./_actions";

type Member = { id: string; full_name: string };
type Dept = { id: string; name: string };

function selectClass() {
  return "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm";
}

export function EmployeeTargetForm({ members, defaultMonth }: { members: Member[]; defaultMonth: string }) {
  const [state, action, pending] = useActionState<TargetActionState | undefined, FormData>(
    upsertEmployeeTargetAction,
    undefined,
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <Label htmlFor="et_emp">الموظف</Label>
        <select id="et_emp" name="employee_profile_id" required className={selectClass()}>
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
        <Label htmlFor="et_month">الشهر</Label>
        <Input id="et_month" name="month" type="date" defaultValue={defaultMonth} required className="mt-1" />
      </div>
      <div>
        <Label htmlFor="et_tasks">هدف المهام المنجزة</Label>
        <Input id="et_tasks" name="target_completed_tasks" type="number" min={0} defaultValue={0} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="et_designs">هدف التصاميم</Label>
        <Input id="et_designs" name="target_designs" type="number" min={0} defaultValue={0} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="et_ontime">هدف الالتزام %</Label>
        <Input id="et_ontime" name="target_on_time_pct" type="number" min={0} max={100} className="mt-1" />
      </div>
      <div className="flex items-end gap-3">
        <Button type="submit" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ هدف الموظف"}</Button>
      </div>
      {state?.error && <p className="sm:col-span-full text-xs text-cc-red">{state.error}</p>}
      {state?.ok && <p className="sm:col-span-full text-xs text-cc-green">تم حفظ الهدف.</p>}
    </form>
  );
}

export function DepartmentTargetForm({ depts, defaultMonth }: { depts: Dept[]; defaultMonth: string }) {
  const [state, action, pending] = useActionState<TargetActionState | undefined, FormData>(
    upsertDepartmentTargetAction,
    undefined,
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <Label htmlFor="dt_dept">القسم</Label>
        <select id="dt_dept" name="department_id" required className={selectClass()}>
          <option value="">— اختر —</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {state?.fieldErrors?.department_id && (
          <p className="mt-1 text-[11px] text-cc-red">{state.fieldErrors.department_id}</p>
        )}
      </div>
      <div>
        <Label htmlFor="dt_month">الشهر</Label>
        <Input id="dt_month" name="month" type="date" defaultValue={defaultMonth} required className="mt-1" />
      </div>
      <div>
        <Label htmlFor="dt_tasks">هدف المهام المنجزة</Label>
        <Input id="dt_tasks" name="target_completed_tasks" type="number" min={0} defaultValue={0} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="dt_projects">هدف المشاريع المسلّمة</Label>
        <Input id="dt_projects" name="target_projects_delivered" type="number" min={0} defaultValue={0} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="dt_ontime">هدف الالتزام %</Label>
        <Input id="dt_ontime" name="target_on_time_pct" type="number" min={0} max={100} className="mt-1" />
      </div>
      <div className="flex items-end gap-3">
        <Button type="submit" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ هدف القسم"}</Button>
      </div>
      {state?.error && <p className="sm:col-span-full text-xs text-cc-red">{state.error}</p>}
      {state?.ok && <p className="sm:col-span-full text-xs text-cc-green">تم حفظ هدف القسم.</p>}
    </form>
  );
}
