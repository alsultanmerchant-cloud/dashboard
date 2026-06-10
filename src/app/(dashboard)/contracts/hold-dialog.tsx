"use client";

// Hold popup (gap G2) — the feature the team asked for explicitly:
// switching a contract's type to Hold must ask for the agreed hold END date
// (and an optional note). The date drives the daily expiry cron
// (notify_hold_expiring_contracts, migration 0159) which pings the AM and
// the owner starting 5 days out.
//
// Rendered by ContractsGrid when the inline type-dropdown picks "Hold",
// and reusable from the contract detail page.

import { useState, useTransition } from "react";
import { CalendarClock, Loader2, PauseCircle, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { setContractHoldAction } from "./_actions";

export function HoldDialog({
  contractId,
  contractLabel,
  currentHoldEnd,
  onClose,
}: {
  contractId: string;
  contractLabel: string;
  /** Set when editing an existing hold (extend / shorten). */
  currentHoldEnd?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [endDate, setEndDate] = useState(currentHoldEnd ?? "");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  function submit() {
    if (!endDate) {
      toast.error("حدّدي تاريخ نهاية الإيقاف أولًا");
      return;
    }
    if (endDate < today) {
      toast.error("تاريخ نهاية الإيقاف لا يمكن أن يكون في الماضي");
      return;
    }
    start(async () => {
      const res = await setContractHoldAction({
        contractId,
        holdEndDate: endDate,
        note: note.trim() || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم إيقاف العقد مؤقتًا — سيتم التنبيه قبل نهاية الإيقاف بـ5 أيام");
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-soft bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-amber-500/15 p-2 text-amber-400">
              <PauseCircle className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                {currentHoldEnd ? "تعديل مدة الإيقاف" : "إيقاف العقد مؤقتًا (Hold)"}
              </h2>
              <p className="text-xs text-muted-foreground">{contractLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md p-1 text-muted-foreground hover:bg-soft-1 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium">
          تاريخ نهاية الإيقاف <span className="text-rose-400">*</span>
        </label>
        <div className="relative mb-1">
          <CalendarClock className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="date"
            dir="ltr"
            value={endDate}
            min={today}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-input ps-8 pe-3 text-sm outline-none focus:border-cyan/40 [color-scheme:light] dark:[color-scheme:dark]"
          />
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          سيتم تنبيه مدير الحساب والمالك تلقائيًا قبل هذا التاريخ بـ5 أيام،
          ويوميًا إذا تجاوز العقد التاريخ دون رفع الإيقاف.
        </p>

        <label className="mb-1 block text-xs font-medium">سبب الإيقاف / ملاحظة</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="مثال: العميل طلب إيقاف السوشيال خلال فترة الجرد…"
          className="mb-4 w-full resize-y rounded-lg border border-input bg-input p-2 text-sm outline-none focus:border-cyan/40"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 rounded-lg border border-soft px-4 text-xs text-muted-foreground hover:text-foreground"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500/90 px-4 text-xs font-semibold text-amber-950 hover:bg-amber-500 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            تأكيد الإيقاف
          </button>
        </div>
      </div>
    </div>
  );
}
