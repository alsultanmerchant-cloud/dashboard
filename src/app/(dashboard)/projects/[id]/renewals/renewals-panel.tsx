"use client";

// Phase T7 — Renewals panel for the project detail page.
//
// Two affordances:
//   1. "جدول التجديد" form — set cycle_length_months + next_renewal_date.
//   2. "دورات التجديد" table — read-only ledger of historical cycles
//      with a primary "بدء دورة تجديد جديدة" button.
//
// Both writes are gated server-side on the renewal.manage permission;
// when the caller lacks it we render a disabled, read-only view.

import { useActionState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  startRenewalCycleAction,
  setProjectCycleAction,
  type RenewalActionState,
} from "./_actions";
import { formatArabicShortDate } from "@/lib/utils-format";

export type RenewalCycleRow = {
  id: string;
  cycle_no: number;
  started_at: string;
  ended_at: string | null;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  active: "نشطة",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

export function RenewalsPanel({
  projectId,
  cycleLengthMonths,
  nextRenewalDate,
  cycles,
  canManage,
}: {
  projectId: string;
  cycleLengthMonths: number | null;
  nextRenewalDate: string | null;
  cycles: RenewalCycleRow[];
  canManage: boolean;
}) {
  const [startState, startAction, startPending] = useActionState<
    RenewalActionState | undefined,
    FormData
  >(startRenewalCycleAction, undefined);
  const [setState, setAction, setPending] = useActionState<
    RenewalActionState | undefined,
    FormData
  >(setProjectCycleAction, undefined);

  return (
    <div className="space-y-4">
      {/* جدول التجديد */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">جدول التجديد</h3>
          <form action={setAction} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="project_id" value={projectId} />
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">
                طول الدورة (بالأشهر)
              </span>
              <input
                type="number"
                name="cycle_length_months"
                min={1}
                max={36}
                defaultValue={cycleLengthMonths ?? ""}
                disabled={!canManage}
                placeholder="مثال: 1، 3، 6"
                className="w-full h-9 rounded-lg border border-soft-2 bg-soft-1 px-3 text-sm tabular-nums disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1">
                تاريخ التجديد القادم
              </span>
              <input
                type="date"
                name="next_renewal_date"
                defaultValue={nextRenewalDate ?? ""}
                disabled={!canManage}
                className="w-full h-9 rounded-lg border border-soft-2 bg-soft-1 px-3 text-sm disabled:opacity-50"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={!canManage || setPending}
                className="h-9 w-full rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {setPending ? "جارٍ الحفظ…" : "حفظ الجدول"}
              </button>
            </div>
          </form>
          {setState?.error && (
            <p className="mt-2 text-xs text-cc-red">{setState.error}</p>
          )}
          {setState?.ok && (
            <p className="mt-2 text-xs text-emerald-400">تم تحديث جدول التجديد</p>
          )}
          {!canManage && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              تعديل جدول التجديد متاح لحاملي صلاحية «إدارة دورات التجديد» فقط.
            </p>
          )}
        </CardContent>
      </Card>

      {/* دورات التجديد */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold">دورات التجديد</h3>
            <form action={startAction}>
              <input type="hidden" name="project_id" value={projectId} />
              <button
                type="submit"
                disabled={!canManage || startPending}
                className="h-8 rounded-lg border border-cyan/40 bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 disabled:opacity-50"
              >
                {startPending ? "جارٍ البدء…" : "بدء دورة تجديد جديدة"}
              </button>
            </form>
          </div>
          {startState?.error && (
            <p className="mb-2 text-xs text-cc-red">{startState.error}</p>
          )}
          {startState?.ok && (
            <p className="mb-2 text-xs text-emerald-400">
              بدأت الدورة رقم {startState.cycleNo} وتم إنشاء {startState.taskCount ?? 0} مهمة.
            </p>
          )}
          {cycles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              لا توجد دورات تجديد مسجَّلة لهذا المشروع بعد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-right">
                    <th className="py-2 px-2 font-medium">رقم الدورة</th>
                    <th className="py-2 px-2 font-medium">البدء</th>
                    <th className="py-2 px-2 font-medium">الانتهاء</th>
                    <th className="py-2 px-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {cycles.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 px-2 tabular-nums">#{c.cycle_no}</td>
                      <td className="py-2 px-2">
                        {formatArabicShortDate(c.started_at)}
                      </td>
                      <td className="py-2 px-2">
                        {c.ended_at ? formatArabicShortDate(c.ended_at) : "—"}
                      </td>
                      <td className="py-2 px-2 text-xs">
                        {STATUS_LABEL[c.status] ?? c.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
