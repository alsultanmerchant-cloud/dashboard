"use client";

// New-contract creation modal — used by the "+ عقد جديد" button on the
// contracts grid. Keeps the form short on purpose: client, AM, type,
// start date, duration, package, total + paid value, notes. Everything
// else (target, status, payment_status, dates, money detail) is set to
// the sheet's typical defaults and refined later via inline edit.
// Idempotent: re-submitting reuses the same external_id key so the
// importer's old rows + new manual rows compete cleanly.

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createContractAction } from "./_actions";

export type ClientOption = {
  id: string;
  name: string;
  external_id: string | null;
};
export type PackageOption = { id: string; name_ar: string };
export type TypeOption = { id: string; key: string; label: string };
export type AmOption = { id: string; full_name: string };

export function NewContractButton({
  clients,
  packages,
  contractTypes,
  accountManagers,
}: {
  clients: ClientOption[];
  packages: PackageOption[];
  contractTypes: TypeOption[];
  accountManagers: AmOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 transition-colors"
      >
        <Plus className="size-3.5" />
        عقد جديد
      </button>
      {open && (
        <NewContractDialog
          clients={clients}
          packages={packages}
          contractTypes={contractTypes}
          accountManagers={accountManagers}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NewContractDialog({
  clients,
  packages,
  contractTypes,
  accountManagers,
  onClose,
}: {
  clients: ClientOption[];
  packages: PackageOption[];
  contractTypes: TypeOption[];
  accountManagers: AmOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientSearch, setClientSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [amId, setAmId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [packageId, setPackageId] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [duration, setDuration] = useState("1");
  const [totalValue, setTotalValue] = useState("");
  const [paidValue, setPaidValue] = useState("");
  const [notes, setNotes] = useState("");

  const clientResults = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const src = q
      ? clients.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.external_id ?? "").toLowerCase().includes(q),
        )
      : clients;
    return src.slice(0, 50);
  }, [clients, clientSearch]);

  const picked = clients.find((c) => c.id === clientId);

  function submit() {
    if (!clientId) {
      toast.error("اختر العميل أولًا");
      return;
    }
    const total = Number(totalValue);
    if (!Number.isFinite(total) || total < 0) {
      toast.error("قيمة العقد غير صالحة");
      return;
    }
    const paid = paidValue.trim() === "" ? null : Number(paidValue);
    if (paid !== null && (!Number.isFinite(paid) || paid < 0)) {
      toast.error("القيمة المدفوعة غير صالحة");
      return;
    }
    const dur = duration.trim() === "" ? null : Number(duration);
    start(async () => {
      const res = await createContractAction({
        client_id: clientId,
        account_manager_id: amId || null,
        contract_type_id: typeId || null,
        package_id: packageId || null,
        start_date: startDate,
        duration_months: dur as number | null,
        total_value: total,
        paid_value: paid,
        notes: notes.trim() || null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("تم إنشاء العقد");
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mt-12 w-full max-w-lg overflow-hidden rounded-xl border border-soft bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-soft px-4 py-3">
          <h2 className="text-sm font-semibold">عقد جديد</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <Field label="العميل" required>
            {picked ? (
              <div className="flex items-center justify-between rounded-lg border border-soft bg-input px-3 py-2">
                <div>
                  <span className="font-medium">{picked.name}</span>
                  {picked.external_id && (
                    <span className="ms-2 font-mono text-[11px] text-muted-foreground">
                      {picked.external_id}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setClientId("")}
                  className="text-xs text-cyan hover:underline"
                >
                  تغيير
                </button>
              </div>
            ) : (
              <>
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو الكود…"
                  className="h-9 w-full rounded-lg border border-input bg-input px-3 text-sm outline-none focus:border-cyan/40"
                  autoFocus
                />
                {clientSearch.trim() && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-soft bg-card">
                    {clientResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        لا توجد نتائج
                      </div>
                    ) : (
                      clientResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setClientId(c.id);
                            setClientSearch("");
                          }}
                          className={cn(
                            "flex w-full items-center justify-between px-3 py-1.5 text-start text-xs hover:bg-soft-1",
                          )}
                        >
                          <span>{c.name}</span>
                          {c.external_id && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {c.external_id}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="المسوّق">
              <select
                value={amId}
                onChange={(e) => setAmId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
              >
                <option value="">— بدون —</option>
                {accountManagers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="النوع">
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
              >
                <option value="">— بدون —</option>
                {contractTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="الباقة">
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              disabled={pending}
              className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
            >
              <option value="">— بدون —</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_ar}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label="تاريخ البدء" required>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
                dir="ltr"
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
              />
            </Field>
            <Field label="المدة (شهور)">
              <input
                type="number"
                min="0"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={pending}
                dir="ltr"
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm tabular-nums"
              />
            </Field>
            <Field label="قيمة العقد" required>
              <input
                type="number"
                step="0.01"
                min="0"
                value={totalValue}
                onChange={(e) => setTotalValue(e.target.value)}
                disabled={pending}
                dir="ltr"
                placeholder="0"
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm tabular-nums"
              />
            </Field>
          </div>

          <Field label="القيمة المدفوعة">
            <input
              type="number"
              step="0.01"
              min="0"
              value={paidValue}
              onChange={(e) => setPaidValue(e.target.value)}
              disabled={pending}
              dir="ltr"
              placeholder="افتراضي 0"
              className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm tabular-nums"
            />
          </Field>

          <Field label="ملاحظات">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={pending}
              rows={2}
              className="w-full resize-y rounded-lg border border-input bg-input p-2 text-sm"
              placeholder="اختياري"
            />
          </Field>

          <p className="text-[10px] text-muted-foreground">
            القيم الافتراضية: Target = Overdue، الحالة = نشط، الدفع = Complete.
            يمكن تعديلها من الجدول بعد الإنشاء.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !clientId || !totalValue}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan-dim/80 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            إنشاء العقد
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted-foreground">
        {label}
        {required && <span className="ms-1 text-rose-400">*</span>}
      </label>
      {children}
    </div>
  );
}
