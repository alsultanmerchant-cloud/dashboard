"use client";

// Sheet-parity contracts grid.
//
// Mirrors the team's "Client's Contracts" Google sheet column-for-column with
// the 4-color row rule encoded as derived CSS:
//
//   dark red  → renewed_status = 'NO'        (lost / churned)
//   yellow    → contract_type_key = 'Hold'   (waiting on client)
//   gray      → renewed_status = 'Closed'    (cleanly closed)
//   white     → no status set yet
//
// Sticky header + frozen first 2 columns (Client ID, Client Name) so the
// team can scan a wide row without losing context. Filter bar above the
// grid is client-side for instant feedback (the dataset caps at ~1000
// contracts; no point round-tripping). Each row links to /contracts/[id]
// for the rich detail view that's already built. Inline editing arrives
// in a follow-up; this PR ships read-only parity so the team can verify
// every cell matches the sheet before we turn them loose to edit live.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { GridContract } from "@/lib/data/contracts";
import { updateContractFieldAction } from "./_actions";

type TypeOption = { id: string; key: string; label: string };
type AmOption = { id: string; full_name: string };

type Props = {
  rows: GridContract[];
  meEmployeeId: string | null;
  canEdit: boolean;
  contractTypes: TypeOption[];
  accountManagers: AmOption[];
};

// Discriminated payload for the single inline-edit action. Mirrors the
// zod schema on the server so the client can't drift.
type FieldValue =
  | { field: "target"; value: string }
  | { field: "renewed_status"; value: string | null }
  | { field: "payment_status"; value: string | null }
  | { field: "contract_type_id"; value: string | null }
  | { field: "account_manager_id"; value: string | null }
  | { field: "notes"; value: string | null }
  | {
      field:
        | "total_value"
        | "paid_value"
        | "next_contract_value"
        | "renewal_paid_value"
        | "repeated_services_value";
      value: number | null;
    }
  | {
      field: "start_date" | "end_date" | "actual_end_date";
      value: string | null;
    }
  | {
      field: "duration_months" | "extension_days" | "delay_days";
      value: number | null;
    };

const TARGET_TONE: Record<string, string> = {
  Overdue: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  "Sales Deposit": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "On Target": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Closed: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  Lost: "bg-rose-700/20 text-rose-200 border-rose-700/40",
  Renewed: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

const TYPE_TONE: Record<string, string> = {
  New: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Renew: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  UPSELL: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  WinBack: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Hold: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Switch: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  Lost: "bg-rose-700/20 text-rose-200 border-rose-700/40",
};

const TYPE_LABEL: Record<string, string> = {
  New: "جديد",
  Renew: "تجديد",
  UPSELL: "Upsell",
  WinBack: "Win-Back",
  Hold: "Hold",
  Switch: "تحويل",
  Lost: "Lost",
};

const RENEWED_LABEL: Record<string, { label: string; cls: string }> = {
  YES: { label: "YES", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  NO: { label: "NO", cls: "bg-rose-500/20 text-rose-200 border-rose-500/40" },
  Closed: { label: "Closed", cls: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40" },
};

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  hold: "Hold",
  closed: "Closed",
  expired: "Expired",
  renewed: "Renewed",
  lost: "Lost",
};

// 4-color row rule. Returns the className for the <tr>, encoding the
// semantic the team uses to scan the sheet at a glance.
function rowTone(c: GridContract): string {
  if (c.renewed_status === "NO") {
    // Dark red — lost client.
    return "bg-rose-950/40 hover:bg-rose-950/60";
  }
  if (c.contract_type_key === "Hold") {
    // Yellow — waiting on client.
    return "bg-amber-900/20 hover:bg-amber-900/30";
  }
  if (c.renewed_status === "Closed") {
    // Gray — cleanly closed.
    return "bg-zinc-800/40 hover:bg-zinc-800/60 text-muted-foreground";
  }
  return "hover:bg-soft-1";
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function Pill({
  label,
  tone,
  size = "sm",
}: {
  label: string;
  tone: string;
  size?: "sm" | "xs";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium whitespace-nowrap",
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        tone,
      )}
    >
      {label}
    </span>
  );
}

export function ContractsGrid({
  rows: initialRows,
  meEmployeeId,
  canEdit,
  contractTypes,
  accountManagers,
}: Props) {
  // Optimistic mirror of the server rows. Inline edits write here
  // immediately, then the server action either confirms (revalidate
  // re-seeds from the source) or errors (we revert and toast).
  const [rows, setRows] = useState<GridContract[]>(initialRows);
  // Reset to fresh server data when the parent re-fetches (router.refresh
  // post-commit, or filter changes that come down as new props). React 19
  // "derived from prop" pattern — avoids the cascading-render setState-in-
  // effect lint error.
  const [lastInitial, setLastInitial] = useState(initialRows);
  if (lastInitial !== initialRows) {
    setLastInitial(initialRows);
    setRows(initialRows);
  }
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");

  // Shared save handler — patches the row optimistically, then calls the
  // server action. On failure we revert to the prior snapshot. Same code
  // path serves every editable cell, so error UX stays consistent.
  function commit(id: string, patch: FieldValue, label: string) {
    const before = rows.find((r) => r.id === id);
    if (!before) return Promise.resolve(false);

    setRows((prev) =>
      prev.map((r) => (r.id === id ? applyPatch(r, patch, contractTypes, accountManagers) : r)),
    );
    return updateContractFieldAction({
      id,
      field: patch.field,
      value: patch.value,
    }).then((res) => {
      if ("error" in res) {
        // Revert
        setRows((prev) => prev.map((r) => (r.id === id ? before : r)));
        toast.error(res.error);
        return false;
      }
      toast.success(`تم حفظ ${label}`, { duration: 1200 });
      router.refresh();
      return true;
    });
  }

  // Derived option lists for filter chips.
  const counts = useMemo(() => {
    const target: Record<string, number> = {};
    const status: Record<string, number> = {};
    const type: Record<string, number> = {};
    for (const r of rows) {
      target[r.target] = (target[r.target] ?? 0) + 1;
      status[r.status] = (status[r.status] ?? 0) + 1;
      if (r.contract_type_key) {
        type[r.contract_type_key] = (type[r.contract_type_key] ?? 0) + 1;
      }
    }
    return { target, status, type };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (scope === "mine" && r.account_manager_id !== meEmployeeId) return false;
      if (target && r.target !== target) return false;
      if (status && r.status !== status) return false;
      if (typeKey && r.contract_type_key !== typeKey) return false;
      if (!q) return true;
      return (
        (r.client_name ?? "").toLowerCase().includes(q) ||
        (r.client_external_id ?? "").toLowerCase().includes(q) ||
        (r.account_manager_name ?? "").toLowerCase().includes(q) ||
        r.package_names.some((p) => p.toLowerCase().includes(q)) ||
        (r.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, scope, target, status, typeKey, meEmployeeId]);

  const totalValue = filtered.reduce((s, r) => s + r.total_value, 0);
  const totalPaid = filtered.reduce((s, r) => s + r.paid_value, 0);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="rounded-2xl border border-soft bg-card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم، الكود، الباقة، الملاحظات…"
              className="h-9 w-full rounded-lg border border-input bg-input ps-8 pe-3 text-sm outline-none focus:border-cyan/40"
            />
          </div>
          {meEmployeeId && (
            <div className="inline-flex rounded-lg border border-soft bg-soft-1 p-0.5 text-xs">
              <button
                onClick={() => setScope("all")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  scope === "all"
                    ? "bg-cyan-dim text-cyan font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                الكل
              </button>
              <button
                onClick={() => setScope("mine")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  scope === "mine"
                    ? "bg-cyan-dim text-cyan font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                عقودي
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <ChipGroup
            label="Target"
            value={target}
            onChange={setTarget}
            options={[
              { value: "Overdue", count: counts.target["Overdue"] ?? 0 },
              { value: "Sales Deposit", count: counts.target["Sales Deposit"] ?? 0 },
              { value: "On Target", count: counts.target["On Target"] ?? 0 },
              { value: "Closed", count: counts.target["Closed"] ?? 0 },
            ]}
          />
          <ChipGroup
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", count: counts.status["active"] ?? 0, label: "نشط" },
              { value: "closed", count: counts.status["closed"] ?? 0, label: "Closed" },
              { value: "expired", count: counts.status["expired"] ?? 0, label: "Expired" },
              { value: "hold", count: counts.status["hold"] ?? 0, label: "Hold" },
            ]}
          />
          <ChipGroup
            label="Type"
            value={typeKey}
            onChange={setTypeKey}
            options={[
              { value: "New", count: counts.type["New"] ?? 0, label: "جديد" },
              { value: "Renew", count: counts.type["Renew"] ?? 0, label: "تجديد" },
              { value: "UPSELL", count: counts.type["UPSELL"] ?? 0, label: "Upsell" },
              { value: "Hold", count: counts.type["Hold"] ?? 0, label: "Hold" },
              { value: "WinBack", count: counts.type["WinBack"] ?? 0, label: "Win-Back" },
            ]}
          />
        </div>

        <div className="flex items-center justify-between border-t border-soft pt-2 text-xs text-muted-foreground">
          <div>
            {filtered.length.toLocaleString("ar-SA-u-nu-latn")} عقد
            {filtered.length !== rows.length && (
              <span> · أصل {rows.length.toLocaleString("ar-SA-u-nu-latn")}</span>
            )}
          </div>
          <div className="flex items-center gap-3 tabular-nums">
            <span>
              القيمة:{" "}
              <span className="text-foreground font-medium">{fmtMoney(totalValue)}</span>
            </span>
            <span>
              المدفوع:{" "}
              <span className="text-foreground font-medium">{fmtMoney(totalPaid)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-2xl border border-soft bg-card">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full border-collapse text-right text-[12px]">
            <thead className="sticky top-0 z-20 bg-soft-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th sticky className="text-center min-w-[64px]">Client ID</Th>
                <Th sticky stickyOffset="64px" className="min-w-[200px]">العميل</Th>
                <Th>المسوّق</Th>
                <Th>تاريخ البدء</Th>
                <Th>Target</Th>
                <Th>النوع</Th>
                <Th className="min-w-[200px]">الباقة</Th>
                <Th className="text-center">المدة</Th>
                <Th className="text-end">المدفوع</Th>
                <Th className="text-end">المتكرر</Th>
                <Th>الدفع</Th>
                <Th className="text-center">الأيام</Th>
                <Th>نهاية متوقعة</Th>
                <Th>الحالة</Th>
                <Th className="text-end">قيمة التجديد</Th>
                <Th className="text-end">دفعة التجديد</Th>
                <Th>نهاية فعلية</Th>
                <Th className="text-center">تأخير</Th>
                <Th>تجديد؟</Th>
                <Th className="text-center">تمديد</Th>
                <Th className="min-w-[180px]">ملاحظات</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={21} className="px-3 py-10 text-center text-muted-foreground text-sm">
                    لا توجد عقود مطابقة للفلتر.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr
                    key={c.id}
                    className={cn(
                      "border-t border-soft/60 transition-colors",
                      rowTone(c),
                    )}
                  >
                    <Td sticky className="text-center font-mono text-[11px]">
                      <Link href={`/contracts/${c.id}`} className="hover:underline">
                        {c.client_external_id ?? "—"}
                      </Link>
                    </Td>
                    <Td sticky stickyOffset="64px" className="font-medium">
                      <Link href={`/contracts/${c.id}`} className="hover:underline">
                        {c.client_name ?? "—"}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">
                      {canEdit ? (
                        <EditableSelect
                          value={c.account_manager_id ?? ""}
                          options={[
                            { value: "", label: "—" },
                            ...accountManagers.map((a) => ({
                              value: a.id,
                              label: a.full_name,
                            })),
                          ]}
                          renderView={() => c.account_manager_name ?? "—"}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "account_manager_id", value: v || null },
                              "المسوّق",
                            )
                          }
                        />
                      ) : (
                        c.account_manager_name ?? "—"
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {canEdit ? (
                        <EditableDate
                          value={c.start_date}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "start_date", value: v },
                              "تاريخ البدء",
                            )
                          }
                        />
                      ) : (
                        fmtDate(c.start_date)
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <EditableSelect
                          value={c.target}
                          options={[
                            { value: "Overdue", label: "Overdue" },
                            { value: "Sales Deposit", label: "Sales Deposit" },
                            { value: "On Target", label: "On Target" },
                            { value: "Closed", label: "Closed" },
                          ]}
                          renderView={() => (
                            <Pill
                              label={c.target}
                              tone={
                                TARGET_TONE[c.target] ??
                                "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
                              }
                            />
                          )}
                          onCommit={(v) =>
                            commit(c.id, { field: "target", value: v }, "Target")
                          }
                        />
                      ) : (
                        <Pill
                          label={c.target}
                          tone={TARGET_TONE[c.target] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"}
                        />
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <EditableSelect
                          value={
                            contractTypes.find((t) => t.key === c.contract_type_key)?.id ?? ""
                          }
                          options={[
                            { value: "", label: "—" },
                            ...contractTypes.map((t) => ({
                              value: t.id,
                              label: t.label,
                            })),
                          ]}
                          renderView={() =>
                            c.contract_type_key ? (
                              <Pill
                                label={TYPE_LABEL[c.contract_type_key] ?? c.contract_type_key}
                                tone={TYPE_TONE[c.contract_type_key] ?? "bg-zinc-500/15"}
                              />
                            ) : (
                              "—"
                            )
                          }
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "contract_type_id", value: v || null },
                              "النوع",
                            )
                          }
                        />
                      ) : c.contract_type_key ? (
                        <Pill
                          label={TYPE_LABEL[c.contract_type_key] ?? c.contract_type_key}
                          tone={TYPE_TONE[c.contract_type_key] ?? "bg-zinc-500/15"}
                        />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {c.package_names.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {c.package_names.map((p, i) => (
                            <Pill
                              key={`${p}-${i}`}
                              label={p}
                              tone="bg-soft-2 text-foreground border-soft"
                              size="xs"
                            />
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="text-center tabular-nums">
                      {canEdit ? (
                        <EditableNumber
                          value={c.duration_months}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "duration_months", value: v },
                              "المدة",
                            )
                          }
                        />
                      ) : (
                        c.duration_months ?? "—"
                      )}
                    </Td>
                    <Td className="text-end tabular-nums">
                      {canEdit ? (
                        <EditableNumber
                          value={c.paid_value}
                          allowDecimal
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "paid_value", value: v },
                              "المدفوع",
                            )
                          }
                          render={() => fmtMoney(c.paid_value)}
                        />
                      ) : (
                        fmtMoney(c.paid_value)
                      )}
                    </Td>
                    <Td className="text-end tabular-nums text-muted-foreground">
                      {canEdit ? (
                        <EditableNumber
                          value={c.repeated_services_value}
                          allowDecimal
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "repeated_services_value", value: v },
                              "المتكرر",
                            )
                          }
                          render={() => fmtMoney(c.repeated_services_value)}
                        />
                      ) : (
                        fmtMoney(c.repeated_services_value)
                      )}
                    </Td>
                    <Td className="text-muted-foreground text-[11px]">
                      {canEdit ? (
                        <EditableSelect
                          value={c.payment_status ?? ""}
                          options={[
                            { value: "", label: "—" },
                            { value: "Complete", label: "Complete" },
                            { value: "Installments", label: "Installments" },
                          ]}
                          renderView={() => c.payment_status ?? "—"}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "payment_status", value: v || null },
                              "الدفع",
                            )
                          }
                        />
                      ) : (
                        c.payment_status ?? "—"
                      )}
                    </Td>
                    <Td className="text-center tabular-nums text-muted-foreground">
                      {c.total_days_computed ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {canEdit ? (
                        <EditableDate
                          value={c.end_date}
                          onCommit={(v) =>
                            commit(c.id, { field: "end_date", value: v }, "نهاية متوقعة")
                          }
                        />
                      ) : (
                        fmtDate(c.end_date)
                      )}
                    </Td>
                    <Td className="text-[11px] text-muted-foreground">
                      {c.contract_status_label ?? STATUS_LABEL[c.status] ?? c.status}
                    </Td>
                    <Td className="text-end tabular-nums text-muted-foreground">
                      {canEdit ? (
                        <EditableNumber
                          value={c.next_contract_value}
                          allowDecimal
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "next_contract_value", value: v },
                              "قيمة التجديد",
                            )
                          }
                          render={() => fmtMoney(c.next_contract_value)}
                        />
                      ) : (
                        fmtMoney(c.next_contract_value)
                      )}
                    </Td>
                    <Td className="text-end tabular-nums text-muted-foreground">
                      {canEdit ? (
                        <EditableNumber
                          value={c.renewal_paid_value}
                          allowDecimal
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "renewal_paid_value", value: v },
                              "دفعة التجديد",
                            )
                          }
                          render={() => fmtMoney(c.renewal_paid_value)}
                        />
                      ) : (
                        fmtMoney(c.renewal_paid_value)
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {canEdit ? (
                        <EditableDate
                          value={c.actual_end_date}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "actual_end_date", value: v },
                              "نهاية فعلية",
                            )
                          }
                        />
                      ) : (
                        fmtDate(c.actual_end_date)
                      )}
                    </Td>
                    <Td className="text-center tabular-nums">
                      {canEdit ? (
                        <EditableNumber
                          value={c.delay_days}
                          render={() =>
                            c.delay_days != null ? (
                              <span
                                className={cn(
                                  "inline-block min-w-[28px] rounded px-1.5 py-0.5",
                                  c.delay_days > 0
                                    ? "bg-rose-500/15 text-rose-300"
                                    : "text-muted-foreground",
                                )}
                              >
                                {c.delay_days}
                              </span>
                            ) : (
                              "—"
                            )
                          }
                          onCommit={(v) =>
                            commit(c.id, { field: "delay_days", value: v }, "تأخير")
                          }
                        />
                      ) : c.delay_days != null ? (
                        <span
                          className={cn(
                            "inline-block min-w-[28px] rounded px-1.5 py-0.5",
                            c.delay_days > 0
                              ? "bg-rose-500/15 text-rose-300"
                              : "text-muted-foreground",
                          )}
                        >
                          {c.delay_days}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <EditableSelect
                          value={c.renewed_status ?? ""}
                          options={[
                            { value: "", label: "—" },
                            { value: "YES", label: "YES" },
                            { value: "NO", label: "NO" },
                            { value: "Closed", label: "Closed" },
                          ]}
                          renderView={() =>
                            c.renewed_status ? (
                              <Pill
                                label={RENEWED_LABEL[c.renewed_status]?.label ?? c.renewed_status}
                                tone={RENEWED_LABEL[c.renewed_status]?.cls ?? "bg-zinc-500/15"}
                                size="xs"
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )
                          }
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "renewed_status", value: v || null },
                              "تجديد",
                            )
                          }
                        />
                      ) : c.renewed_status ? (
                        <Pill
                          label={RENEWED_LABEL[c.renewed_status]?.label ?? c.renewed_status}
                          tone={RENEWED_LABEL[c.renewed_status]?.cls ?? "bg-zinc-500/15"}
                          size="xs"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="text-center tabular-nums text-muted-foreground">
                      {canEdit ? (
                        <EditableNumber
                          value={c.extension_days}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "extension_days", value: v },
                              "تمديد",
                            )
                          }
                        />
                      ) : (
                        c.extension_days ?? "—"
                      )}
                    </Td>
                    <Td className="max-w-[260px]">
                      {canEdit ? (
                        <EditableText
                          value={c.notes ?? ""}
                          placeholder="—"
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "notes", value: v || null },
                              "ملاحظات",
                            )
                          }
                        />
                      ) : c.notes ? (
                        <span
                          className="block truncate text-[11px] text-muted-foreground"
                          title={c.notes}
                        >
                          {c.notes}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  className,
  sticky,
  stickyOffset,
}: {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
  stickyOffset?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 font-medium text-start whitespace-nowrap",
        sticky && "sticky z-30 bg-soft-1",
        className,
      )}
      style={sticky ? { insetInlineStart: stickyOffset ?? "0" } : undefined}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  sticky,
  stickyOffset,
}: {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
  stickyOffset?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle",
        sticky && "sticky z-10 bg-[inherit]",
        className,
      )}
      style={sticky ? { insetInlineStart: stickyOffset ?? "0" } : undefined}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Inline-edit primitives
//
// Each cell that's editable wraps its display in one of these. The view
// shows the formatted value with a subtle hover ring; clicking swaps in
// the matching input (native <select>, <input type=number|date>, or a
// growable <textarea> for notes). Commit fires on blur / Enter; cancel on
// Escape. Saves are routed through the single `commit` function so the
// optimistic + revert + toast logic stays in one place.
// ---------------------------------------------------------------------------

const editShellCls =
  "inline-flex min-h-[24px] cursor-pointer items-center gap-1 rounded px-1 -mx-1 hover:bg-soft-1 hover:ring-1 hover:ring-soft transition-colors";

function EditableSelect({
  value,
  options,
  renderView,
  onCommit,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  renderView: () => React.ReactNode;
  onCommit: (v: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [local, setLocal] = useState(value);
  // React 19 idiom: derive in render when the prop changes mid-mount,
  // instead of an effect that mutates state (causes cascading renders).
  const [lastProp, setLastProp] = useState(value);
  if (lastProp !== value) {
    setLastProp(value);
    setLocal(value);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={editShellCls}
        onClick={() => setEditing(true)}
        title="انقر للتعديل"
      >
        {renderView()}
      </button>
    );
  }

  return (
    <select
      autoFocus
      value={local}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        start(async () => {
          await onCommit(next);
          setEditing(false);
        });
      }}
      onBlur={() => setEditing(false)}
      className="h-7 rounded-md border border-cyan/40 bg-input px-1 text-[12px] outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function EditableNumber({
  value,
  onCommit,
  render,
  allowDecimal,
}: {
  value: number | null;
  onCommit: (v: number | null) => Promise<boolean>;
  render?: () => React.ReactNode;
  allowDecimal?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value == null ? "" : String(value));
  const [pending, start] = useTransition();
  const [lastProp, setLastProp] = useState(value);
  if (lastProp !== value) {
    setLastProp(value);
    setLocal(value == null ? "" : String(value));
  }

  function done() {
    const trimmed = local.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && !Number.isFinite(next)) {
      toast.error("قيمة عددية غير صالحة");
      setLocal(value == null ? "" : String(value));
      setEditing(false);
      return;
    }
    if (next === value) {
      setEditing(false);
      return;
    }
    start(async () => {
      const ok = await onCommit(next);
      if (!ok) setLocal(value == null ? "" : String(value));
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={editShellCls}
        onClick={() => setEditing(true)}
        title="انقر للتعديل"
      >
        {render ? render() : value ?? "—"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      step={allowDecimal ? "0.01" : "1"}
      value={local}
      disabled={pending}
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
      className="h-7 w-20 rounded-md border border-cyan/40 bg-input px-1 text-[12px] outline-none tabular-nums text-end"
    />
  );
}

function EditableDate({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (v: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  const [pending, start] = useTransition();
  const [lastProp, setLastProp] = useState(value);
  if (lastProp !== value) {
    setLastProp(value);
    setLocal(value ?? "");
  }

  function done() {
    const next = local.trim() || null;
    if (next === value) {
      setEditing(false);
      return;
    }
    start(async () => {
      const ok = await onCommit(next);
      if (!ok) setLocal(value ?? "");
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={editShellCls}
        onClick={() => setEditing(true)}
        title="انقر للتعديل"
      >
        {fmtDate(value)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="date"
      value={local}
      disabled={pending}
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
      className="h-7 rounded-md border border-cyan/40 bg-input px-1 text-[12px] outline-none"
    />
  );
}

function EditableText({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (v: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [lastProp, setLastProp] = useState(value);
  if (lastProp !== value) {
    setLastProp(value);
    setLocal(value);
  }
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function done() {
    const next = local.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    start(async () => {
      const ok = await onCommit(next);
      if (!ok) setLocal(value);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(editShellCls, "max-w-[260px] text-start")}
        onClick={() => setEditing(true)}
        title={value || "انقر للتعديل"}
      >
        {value ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {value}
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex items-start gap-1">
      <textarea
        ref={ref}
        value={local}
        disabled={pending}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done();
          if (e.key === "Escape") {
            setLocal(value);
            setEditing(false);
          }
        }}
        rows={2}
        className="min-h-[28px] w-[240px] resize-y rounded-md border border-cyan/40 bg-input p-1 text-[11px] outline-none"
      />
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={done}
          disabled={pending}
          title="حفظ (Ctrl+Enter)"
          className="rounded bg-cyan-dim p-1 text-cyan hover:bg-cyan-dim/80"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setLocal(value);
            setEditing(false);
          }}
          disabled={pending}
          title="إلغاء (Esc)"
          className="rounded bg-soft-1 p-1 text-muted-foreground hover:bg-soft-2"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

// Mirror the field write client-side so the row repaints instantly with
// the new value (and the row color recomputes via rowTone()).
function applyPatch(
  row: GridContract,
  patch: FieldValue,
  types: TypeOption[],
  ams: AmOption[],
): GridContract {
  const next = { ...row };
  switch (patch.field) {
    case "contract_type_id": {
      const t = types.find((x) => x.id === patch.value);
      next.contract_type_key = t?.key ?? null;
      next.contract_type_label = t?.label ?? null;
      break;
    }
    case "account_manager_id": {
      const a = ams.find((x) => x.id === patch.value);
      next.account_manager_id = patch.value;
      next.account_manager_name = a?.full_name ?? null;
      break;
    }
    case "target":
      next.target = patch.value;
      break;
    case "renewed_status":
      next.renewed_status = patch.value;
      break;
    case "payment_status":
      next.payment_status = patch.value;
      break;
    case "notes":
      next.notes = patch.value;
      break;
    case "total_value":
      next.total_value = patch.value ?? 0;
      break;
    case "paid_value":
      next.paid_value = patch.value ?? 0;
      break;
    case "next_contract_value":
      next.next_contract_value = patch.value;
      break;
    case "renewal_paid_value":
      next.renewal_paid_value = patch.value;
      break;
    case "repeated_services_value":
      next.repeated_services_value = patch.value;
      break;
    case "start_date":
      next.start_date = patch.value ?? row.start_date;
      break;
    case "end_date":
      next.end_date = patch.value;
      break;
    case "actual_end_date":
      next.actual_end_date = patch.value;
      break;
    case "duration_months":
      next.duration_months = patch.value;
      break;
    case "extension_days":
      next.extension_days = patch.value;
      break;
    case "delay_days":
      next.delay_days = patch.value;
      break;
  }
  return next;
}

function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: Array<{ value: T; count: number; label?: string }>;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-soft bg-soft-1 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded-md px-2 py-0.5 transition-colors",
          value === null
            ? "bg-cyan-dim text-cyan font-medium"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        الكل
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={cn(
            "rounded-md px-2 py-0.5 transition-colors",
            value === o.value
              ? "bg-cyan-dim text-cyan font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label ?? o.value}{" "}
          <span className="text-muted-foreground/70 tabular-nums">({o.count})</span>
        </button>
      ))}
    </div>
  );
}
