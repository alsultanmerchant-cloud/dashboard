"use client";

// Editable installments schedule for the contract detail page. Replaces the
// read-only list so the team can manage the 4-payment plan here instead of
// the sheet's Installments Tracker: edit expected date/amount, mark a payment
// received (actual date/amount), add a new installment, or delete one. Each
// edit is optimistic with revert-on-error; contracts.paid_value is recomputed
// server-side from received amounts.

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  addInstallmentAction,
  updateInstallmentAction,
  deleteInstallmentAction,
} from "../_actions";

export type InstallmentRow = {
  id: string;
  sequence: number;
  expected_date: string | null;
  expected_amount: number;
  actual_date: string | null;
  actual_amount: number | null;
  status: string;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  received: { label: "مستلمة", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  partial: { label: "جزئية", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  pending: { label: "منتظرة", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  overdue: { label: "متأخرة", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  waived: { label: "متنازَل", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(n);
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function InstallmentsEditor({
  contractId,
  rows: initial,
  canManage,
}: {
  contractId: string;
  rows: InstallmentRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<InstallmentRow[]>(initial);
  const [last, setLast] = useState(initial);
  if (last !== initial) {
    setLast(initial);
    setRows(initial);
  }
  const [adding, setAdding] = useState(false);

  function patchLocal(id: string, patch: Partial<InstallmentRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function commitField(
    id: string,
    field: "expected_date" | "expected_amount" | "actual_date" | "actual_amount",
    value: string | number | null,
  ) {
    const before = rows.find((r) => r.id === id);
    patchLocal(id, { [field]: value } as Partial<InstallmentRow>);
    updateInstallmentAction({ id, field, value }).then((res) => {
      if ("error" in res) {
        if (before) patchLocal(id, before);
        toast.error(res.error);
      } else {
        toast.success("تم الحفظ", { duration: 1000 });
        router.refresh();
      }
    });
  }

  const total = rows.reduce((s, r) => s + r.expected_amount, 0);
  const received = rows.reduce((s, r) => s + (r.actual_amount ?? 0), 0);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-soft bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-soft-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-center font-medium">#</th>
              <th className="px-3 py-2 text-end font-medium">المبلغ المتوقَّع</th>
              <th className="px-3 py-2 font-medium">التاريخ المتوقَّع</th>
              <th className="px-3 py-2 text-end font-medium">المبلغ المستلَم</th>
              <th className="px-3 py-2 font-medium">تاريخ الاستلام</th>
              <th className="px-3 py-2 font-medium">الحالة</th>
              {canManage && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-3 py-6 text-center text-muted-foreground">
                  لا توجد دفعات بعد.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-soft/60">
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex size-6 items-center justify-center rounded-md bg-cyan-dim text-[11px] font-semibold text-cyan tabular-nums">
                      {r.sequence}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {canManage ? (
                      <EditNum value={r.expected_amount} onCommit={(v) => commitField(r.id, "expected_amount", v ?? 0)} />
                    ) : (
                      fmtMoney(r.expected_amount)
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {canManage ? (
                      <EditDate value={r.expected_date} onCommit={(v) => v && commitField(r.id, "expected_date", v)} />
                    ) : (
                      fmtDate(r.expected_date)
                    )}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {canManage ? (
                      <EditNum value={r.actual_amount} nullable onCommit={(v) => commitField(r.id, "actual_amount", v)} />
                    ) : (
                      fmtMoney(r.actual_amount)
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {canManage ? (
                      <EditDate value={r.actual_date} nullable onCommit={(v) => commitField(r.id, "actual_date", v)} />
                    ) : (
                      fmtDate(r.actual_date)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        STATUS_LABEL[r.status]?.cls ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
                      )}
                    >
                      {STATUS_LABEL[r.status]?.label ?? r.status}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <DeleteButton
                        onConfirm={() => {
                          const snapshot = rows;
                          setRows((p) => p.filter((x) => x.id !== r.id));
                          deleteInstallmentAction({ id: r.id }).then((res) => {
                            if ("error" in res) {
                              setRows(snapshot);
                              toast.error(res.error);
                            } else {
                              toast.success("تم الحذف");
                              router.refresh();
                            }
                          });
                        }}
                      />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-soft bg-soft-1/40 text-xs">
                <td className="px-3 py-2 text-center text-muted-foreground">∑</td>
                <td className="px-3 py-2 text-end font-semibold tabular-nums">{fmtMoney(total)}</td>
                <td />
                <td className="px-3 py-2 text-end font-semibold tabular-nums text-emerald-300">{fmtMoney(received)}</td>
                <td colSpan={canManage ? 3 : 2} className="px-3 py-2 text-muted-foreground">
                  المتبقّي: {fmtMoney(total - received)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {canManage && (
        adding ? (
          <AddInstallmentRow
            contractId={contractId}
            onDone={() => {
              setAdding(false);
              router.refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan-dim/80"
          >
            <Plus className="size-3.5" />
            إضافة دفعة
          </button>
        )
      )}
    </div>
  );
}

function AddInstallmentRow({
  contractId,
  onDone,
  onCancel,
}: {
  contractId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("أدخل مبلغًا صحيحًا");
      return;
    }
    start(async () => {
      const res = await addInstallmentAction({
        contractId,
        expectedDate: date,
        expectedAmount: amt,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تمت الإضافة");
      onDone();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-soft bg-soft-1/40 p-3">
      <div className="space-y-1">
        <label className="block text-[10px] text-muted-foreground">المبلغ المتوقَّع</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={pending}
          dir="ltr"
          placeholder="0"
          autoFocus
          className="h-8 w-28 rounded-lg border border-input bg-input px-2 text-sm tabular-nums"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[10px] text-muted-foreground">التاريخ المتوقَّع</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={pending}
          dir="ltr"
          className="h-8 rounded-lg border border-input bg-input px-2 text-sm"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1 rounded-lg bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        حفظ
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="inline-flex h-8 items-center rounded-lg border border-soft px-3 text-xs text-muted-foreground hover:bg-muted"
      >
        إلغاء
      </button>
    </div>
  );
}

function EditNum({
  value,
  onCommit,
  nullable,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  nullable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value == null ? "" : String(value));
  const [lp, setLp] = useState(value);
  if (lp !== value) {
    setLp(value);
    setLocal(value == null ? "" : String(value));
  }
  function done() {
    const t = local.trim();
    const v = t === "" ? (nullable ? null : 0) : Number(t);
    if (v != null && !Number.isFinite(v)) {
      setLocal(value == null ? "" : String(value));
      setEditing(false);
      return;
    }
    if (v !== value) onCommit(v);
    setEditing(false);
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-soft-1 hover:ring-1 hover:ring-soft"
      >
        {value == null ? <span className="text-muted-foreground">—</span> : fmtMoney(value)}
        <Pencil className="size-2.5 text-muted-foreground/50" />
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value == null ? "" : String(value));
          setEditing(false);
        }
      }}
      dir="ltr"
      className="h-7 w-24 rounded-md border border-cyan/40 bg-input px-1 text-sm tabular-nums text-end outline-none"
    />
  );
}

function EditDate({
  value,
  onCommit,
  nullable,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  nullable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  const [lp, setLp] = useState(value);
  if (lp !== value) {
    setLp(value);
    setLocal(value ?? "");
  }
  function done() {
    const v = local.trim() || null;
    if (v !== value) onCommit(nullable ? v : v ?? value);
    setEditing(false);
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-soft-1 hover:ring-1 hover:ring-soft"
      >
        {fmtDate(value)}
        <Pencil className="size-2.5 text-muted-foreground/50" />
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value ?? "");
          setEditing(false);
        }
      }}
      dir="ltr"
      className="h-7 rounded-md border border-cyan/40 bg-input px-1 text-sm outline-none"
    />
  );
}

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        title="حذف"
        className="rounded p-1.5 text-muted-foreground hover:bg-cc-red/10 hover:text-cc-red"
      >
        <Trash2 className="size-3.5" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onConfirm}
        title="تأكيد الحذف"
        className="rounded bg-cc-red/15 p-1 text-cc-red hover:bg-cc-red/25"
      >
        <Check className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        title="إلغاء"
        className="rounded bg-soft-1 p-1 text-muted-foreground hover:bg-soft-2"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
