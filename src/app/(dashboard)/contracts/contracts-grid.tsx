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

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GridContract } from "@/lib/data/contracts";

type Props = {
  rows: GridContract[];
  meEmployeeId: string | null;
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

export function ContractsGrid({ rows, meEmployeeId }: Props) {
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");

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
                      {c.account_manager_name ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmtDate(c.start_date)}
                    </Td>
                    <Td>
                      <Pill
                        label={c.target}
                        tone={TARGET_TONE[c.target] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"}
                      />
                    </Td>
                    <Td>
                      {c.contract_type_key ? (
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
                      {c.duration_months ?? "—"}
                    </Td>
                    <Td className="text-end tabular-nums">{fmtMoney(c.paid_value)}</Td>
                    <Td className="text-end tabular-nums text-muted-foreground">
                      {fmtMoney(c.repeated_services_value)}
                    </Td>
                    <Td className="text-muted-foreground text-[11px]">
                      {c.payment_status ?? "—"}
                    </Td>
                    <Td className="text-center tabular-nums text-muted-foreground">
                      {c.total_days_computed ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmtDate(c.end_date)}
                    </Td>
                    <Td className="text-[11px] text-muted-foreground">
                      {c.contract_status_label ?? STATUS_LABEL[c.status] ?? c.status}
                    </Td>
                    <Td className="text-end tabular-nums text-muted-foreground">
                      {fmtMoney(c.next_contract_value)}
                    </Td>
                    <Td className="text-end tabular-nums text-muted-foreground">
                      {fmtMoney(c.renewal_paid_value)}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmtDate(c.actual_end_date)}
                    </Td>
                    <Td className="text-center tabular-nums">
                      {c.delay_days != null ? (
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
                      {c.renewed_status ? (
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
                      {c.extension_days ?? "—"}
                    </Td>
                    <Td className="max-w-[260px]">
                      {c.notes ? (
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
