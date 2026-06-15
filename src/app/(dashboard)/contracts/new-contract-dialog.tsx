"use client";

// New-contract creation modal — used by the "+ عقد جديد" button on the
// contracts grid. Keeps the form short on purpose: client, AM, type,
// start date, duration, package, total + paid value, notes. Everything
// else (target, status, payment_status, dates, money detail) is set to
// the sheet's typical defaults and refined later via inline edit.
// Idempotent: re-submitting reuses the same external_id key so the
// importer's old rows + new manual rows compete cleanly.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react";
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
  const t = useTranslations("ContractsPage");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 transition-colors"
      >
        <Plus className="size-3.5" />
        {t("newDialog.openButton")}
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
  const t = useTranslations("ContractsPage");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientSearch, setClientSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [amId, setAmId] = useState("");
  const [typeId, setTypeId] = useState("");
  // Multi-package: the sheet's Package column is a comma list of services
  // (e.g. «سوشيال, حملات») — one contract regularly bundles several.
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [duration, setDuration] = useState("1");
  const [totalValue, setTotalValue] = useState("");
  const [paidValue, setPaidValue] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"Complete" | "Installments">(
    "Complete",
  );
  // Inline installment schedule (date + amount per row). seq 1 = signing deposit.
  const [installments, setInstallments] = useState<
    Array<{ date: string; amount: string }>
  >([]);
  const [notes, setNotes] = useState("");

  function choosePayment(next: "Complete" | "Installments") {
    setPaymentStatus(next);
    // Seed one empty row the first time installments are picked so the team
    // sees where to type immediately.
    if (next === "Installments" && installments.length === 0) {
      setInstallments([{ date: startDate, amount: "" }]);
    }
  }
  function addInstallment() {
    setInstallments((prev) => [...prev, { date: startDate, amount: "" }]);
  }
  function updateInstallment(i: number, patch: Partial<{ date: string; amount: string }>) {
    setInstallments((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }
  function removeInstallment(i: number) {
    setInstallments((prev) => prev.filter((_, idx) => idx !== i));
  }
  function splitRemaining() {
    const total = Number(totalValue) || 0;
    const paid = Number(paidValue) || 0;
    const n = installments.length;
    if (n === 0) return;
    const each = Math.max(0, Math.round(((total - paid) / n) * 100) / 100);
    setInstallments((prev) => prev.map((row) => ({ ...row, amount: String(each) })));
  }

  const scheduledSum = installments.reduce(
    (s, r) => s + (Number(r.amount) || 0),
    0,
  );
  const unscheduled =
    (Number(totalValue) || 0) - (Number(paidValue) || 0) - scheduledSum;
  const fmtAmt = (n: number) =>
    `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)} SR`;

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
      toast.error(t("newDialog.toasts.selectClient"));
      return;
    }
    const total = Number(totalValue);
    if (!Number.isFinite(total) || total < 0) {
      toast.error(t("newDialog.toasts.invalidTotal"));
      return;
    }
    const paid = paidValue.trim() === "" ? null : Number(paidValue);
    if (paid !== null && (!Number.isFinite(paid) || paid < 0)) {
      toast.error(t("newDialog.toasts.invalidPaid"));
      return;
    }
    const dur = duration.trim() === "" ? null : Number(duration);

    // Inline installment schedule — only sent when "Installments" is chosen.
    let installmentsPayload:
      | Array<{ expected_date: string; expected_amount: number }>
      | undefined;
    if (paymentStatus === "Installments") {
      const filled = installments.filter(
        (r) => r.date.trim() !== "" || r.amount.trim() !== "",
      );
      const invalid = filled.some(
        (r) => !r.date.trim() || !(Number(r.amount) > 0),
      );
      if (invalid) {
        toast.error(t("newDialog.toasts.invalidInstallment"));
        return;
      }
      if (filled.length > 0) {
        installmentsPayload = filled.map((r) => ({
          expected_date: r.date,
          expected_amount: Number(r.amount),
        }));
      }
    }

    start(async () => {
      const res = await createContractAction({
        client_id: clientId,
        account_manager_id: amId || null,
        contract_type_id: typeId || null,
        package_ids: packageIds,
        start_date: startDate,
        duration_months: dur as number | null,
        total_value: total,
        paid_value: paid,
        payment_status: paymentStatus,
        installments: installmentsPayload,
        notes: notes.trim() || null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("newDialog.toasts.created"));
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
          <h2 className="text-sm font-semibold">{t("newDialog.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("newDialog.close")}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <Field label={t("newDialog.fields.client")} required>
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
                  {t("newDialog.actions.change")}
                </button>
              </div>
            ) : (
              <>
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder={t("newDialog.placeholders.clientSearch")}
                  className="h-9 w-full rounded-lg border border-input bg-input px-3 text-sm outline-none focus:border-cyan/40"
                  autoFocus
                />
                {clientSearch.trim() && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-soft bg-card">
                    {clientResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {t("newDialog.noResults")}
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
            <Field label={t("newDialog.fields.accountManager")}>
              <SearchSelect
                value={amId}
                onChange={setAmId}
                options={accountManagers.map((a) => ({
                  id: a.id,
                  label: a.full_name,
                }))}
                placeholder={t("newDialog.placeholders.none")}
                disabled={pending}
              />
            </Field>
            <Field label={t("newDialog.fields.type")}>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
              >
                <option value="">{t("newDialog.placeholders.none")}</option>
                {contractTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={t("newDialog.fields.packages", { count: packageIds.length })}>
            <div className="flex max-h-32 flex-wrap content-start gap-1.5 overflow-y-auto rounded-lg border border-input bg-input p-2">
              {packages.map((p) => {
                const selected = packageIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      setPackageIds((prev) =>
                        selected
                          ? prev.filter((id) => id !== p.id)
                          : [...prev, p.id],
                      )
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                      selected
                        ? "border-cyan/50 bg-cyan-dim font-medium text-cyan"
                        : "border-soft bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {selected && "✓ "}
                    {p.name_ar}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("newDialog.helpers.packages")}
            </p>
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label={t("newDialog.fields.startDate")} required>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
                dir="ltr"
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
              />
            </Field>
            <Field label={t("newDialog.fields.duration")}>
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
            <Field label={t("newDialog.fields.totalValue")} required>
              <input
                type="number"
                step="0.01"
                min="0"
                value={totalValue}
                onChange={(e) => setTotalValue(e.target.value)}
                disabled={pending}
                dir="ltr"
                placeholder={t("newDialog.placeholders.zero")}
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm tabular-nums"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t("newDialog.fields.paidValue")}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={paidValue}
                onChange={(e) => setPaidValue(e.target.value)}
                disabled={pending}
                dir="ltr"
                placeholder={t("newDialog.placeholders.defaultZero")}
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm tabular-nums"
              />
            </Field>
            <Field label={t("newDialog.fields.paymentStatus")}>
              <select
                value={paymentStatus}
                onChange={(e) =>
                  choosePayment(e.target.value as "Complete" | "Installments")
                }
                disabled={pending}
                className="h-9 w-full rounded-lg border border-input bg-input px-2 text-sm"
              >
                <option value="Complete">{t("newDialog.payment.complete")}</option>
                <option value="Installments">{t("newDialog.payment.installments")}</option>
              </select>
            </Field>
          </div>

          {paymentStatus === "Installments" && (
            <div className="space-y-2 rounded-lg border border-cyan/25 bg-cyan-dim/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">
                  {t("newDialog.installmentsForm.title")}
                </span>
                <div className="flex items-center gap-2">
                  {installments.length > 0 && (
                    <button
                      type="button"
                      onClick={splitRemaining}
                      disabled={pending}
                      className="text-[10px] text-cyan hover:underline"
                    >
                      {t("newDialog.installmentsForm.split")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addInstallment}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan/30 bg-card px-2 py-1 text-[10px] font-medium text-cyan hover:bg-cyan-dim/60"
                  >
                    <Plus className="size-3" />
                    {t("newDialog.installmentsForm.add")}
                  </button>
                </div>
              </div>

              {installments.length === 0 ? (
                <p className="py-1 text-[10px] text-muted-foreground">
                  {t("newDialog.installmentsForm.empty")}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {installments.map((row, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateInstallment(i, { date: e.target.value })}
                        disabled={pending}
                        dir="ltr"
                        aria-label={t("newDialog.installmentsForm.dueDate")}
                        className="h-8 flex-1 rounded-md border border-input bg-input px-2 text-xs"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={(e) => updateInstallment(i, { amount: e.target.value })}
                        disabled={pending}
                        dir="ltr"
                        placeholder={t("newDialog.installmentsForm.amount")}
                        aria-label={t("newDialog.installmentsForm.amount")}
                        className="h-8 w-28 rounded-md border border-input bg-input px-2 text-xs tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => removeInstallment(i)}
                        disabled={pending}
                        aria-label={t("newDialog.installmentsForm.remove")}
                        className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-cyan/20 pt-1.5 text-[10px] text-muted-foreground">
                <span className="tabular-nums">
                  {t("newDialog.installmentsForm.scheduled", {
                    amount: fmtAmt(scheduledSum),
                  })}
                </span>
                {Math.abs(unscheduled) >= 0.01 && (
                  <span
                    className={cn(
                      "tabular-nums",
                      unscheduled < 0 && "text-rose-500",
                    )}
                  >
                    {t("newDialog.installmentsForm.remaining", {
                      amount: fmtAmt(unscheduled),
                    })}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {t("newDialog.helpers.installments")}
              </p>
            </div>
          )}

          <Field label={t("newDialog.fields.notes")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={pending}
              rows={2}
              className="w-full resize-y rounded-lg border border-input bg-input p-2 text-sm"
              placeholder={t("newDialog.placeholders.optional")}
            />
          </Field>

          <p className="text-[10px] text-muted-foreground">
            {t("newDialog.helpers.defaults")}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("newDialog.actions.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !clientId || !totalValue}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan-dim/80 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            {t("newDialog.actions.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Searchable single-select. The account-manager list is the full active
// roster (~50+ people), so a plain <select> made the team scroll forever —
// this filters as they type. Closes on outside click via a transparent
// backdrop so it behaves like a normal popover inside the modal.
function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
  placeholder: string;
  disabled?: boolean;
}) {
  const t = useTranslations("ContractsPage");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const picked = options.find((o) => o.id === value);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const src = t
      ? options.filter((o) => o.label.toLowerCase().includes(t))
      : options;
    return src.slice(0, 50);
  }, [options, q]);

  function close() {
    setOpen(false);
    setQ("");
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className="flex h-9 w-full items-center justify-between gap-1 rounded-lg border border-input bg-input px-2 text-sm disabled:opacity-50"
      >
        <span className={cn("truncate", !picked && "text-muted-foreground")}>
          {picked ? picked.label : placeholder}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-soft bg-popover text-popover-foreground shadow-xl">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("newDialog.placeholders.searchManager")}
              className="h-8 w-full border-b border-soft bg-popover px-2 text-xs outline-none"
            />
            <div className="max-h-48 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  close();
                }}
                className="block w-full px-3 py-1.5 text-start text-xs text-muted-foreground hover:bg-soft-1"
              >
                {placeholder}
              </button>
              {results.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    close();
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-start text-xs hover:bg-soft-1",
                    o.id === value && "bg-soft-1 font-medium",
                  )}
                >
                  {o.label}
                </button>
              ))}
              {results.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("newDialog.noResults")}
                </div>
              )}
            </div>
          </div>
        </>
      )}
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
