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
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { GridContract } from "@/lib/data/contracts";
import { formatShortDate } from "@/lib/utils-format";
import { updateContractFieldAction, liftContractHoldAction } from "./_actions";
import { HoldDialog } from "./hold-dialog";

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

// ── Sheet-exact color palette ──────────────────────────────────────────────
// Lifted directly from the Skylight "Client's Contracts" tab so the grid
// reads identically to the Excel the team knows. Target / Type / Payment are
// SOLID-filled cells (not tinted pills); Package services are solid chips,
// each service its own color; rows are tinted by renewed_status.

type Swatch = { bg: string; fg: string };

const TARGET_STYLE: Record<string, Swatch> = {
  Overdue: { bg: "#E06666", fg: "#3D0000" },
  "Sales Deposit": { bg: "#B6D7A8", fg: "#1E4112" },
  "On Target": { bg: "#6FA8DC", fg: "#06283D" },
  Closed: { bg: "#B7B7B7", fg: "#2A2A2A" },
  Lost: { bg: "#EA9999", fg: "#3D0000" },
  Renewed: { bg: "#A4C2F4", fg: "#06283D" },
};

const TYPE_STYLE: Record<string, Swatch> = {
  New: { bg: "#D9EAD3", fg: "#1E4112" },
  Renew: { bg: "#9FC5E8", fg: "#06283D" },
  UPSELL: { bg: "#D9D2E9", fg: "#20124D" },
  WinBack: { bg: "#FCE5CD", fg: "#783F04" },
  Hold: { bg: "#F9CB9C", fg: "#783F04" },
  Switch: { bg: "#EAD1DC", fg: "#4C1130" },
  Lost: { bg: "#EA9999", fg: "#3D0000" },
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

// Per-service chip colors (the sheet's smart-chip palette).
const PACKAGE_STYLE: Record<string, Swatch> = {
  حملات: { bg: "#38761D", fg: "#FFFFFF" },
  "حملات lead generation": { bg: "#38761D", fg: "#FFFFFF" },
  سوشيال: { bg: "#1155CC", fg: "#FFFFFF" },
  سيو: { bg: "#B45F06", fg: "#FFFFFF" },
  نوفا: { bg: "#E69138", fg: "#3D1C00" },
  ذهبية: { bg: "#BF9000", fg: "#FFFFFF" },
  "باقة فضية": { bg: "#999999", fg: "#FFFFFF" },
  "باقة تصاميم": { bg: "#6AA84F", fg: "#FFFFFF" },
  "باقة المشاهير": { bg: "#45818E", fg: "#FFFFFF" },
  براندنج: { bg: "#7F7F7F", fg: "#FFFFFF" },
  "انشاء متجر سلة/زد": { bg: "#434343", fg: "#FFFFFF" },
  "انشاء متجر وورد بريس": { bg: "#434343", fg: "#FFFFFF" },
  "انشاء بروفايل": { bg: "#434343", fg: "#FFFFFF" },
  "🤖شات بوت": { bg: "#674EA7", fg: "#FFFFFF" },
  "تيلي سيلز b2b": { bg: "#A64D79", fg: "#FFFFFF" },
  تصوير: { bg: "#0B5394", fg: "#FFFFFF" },
  موديريشن: { bg: "#76A5AF", fg: "#FFFFFF" },
  "اعادة التهيئة": { bg: "#C27BA0", fg: "#FFFFFF" },
  "لاندينج بيدج": { bg: "#8E7CC3", fg: "#FFFFFF" },
  "اضافة منتجات": { bg: "#999999", fg: "#FFFFFF" },
  Growth: { bg: "#38761D", fg: "#FFFFFF" },
};
const PACKAGE_DEFAULT: Swatch = { bg: "#666666", fg: "#FFFFFF" };

const PAYMENT_STYLE: Record<string, Swatch> = {
  Installments: { bg: "#E69138", fg: "#3D1C00" },
  Complete: { bg: "#38761D", fg: "#FFFFFF" },
};

// AM pills — each account manager gets a stable color (the sheet assigns one
// per person). Deterministic hash so it's consistent across renders.
const AM_PALETTE = [
  "#674EA7", "#1155CC", "#783F04", "#7F6000", "#0B5394",
  "#A64D79", "#45818E", "#6AA84F", "#B45F06", "#434343",
  "#990000", "#0C343D",
];
function amColor(name: string | null): string {
  if (!name) return "#555555";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AM_PALETTE[h % AM_PALETTE.length];
}

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

function targetLabel(t: (key: string) => string, key: string): string {
  switch (key) {
    case "Overdue":
      return t("grid.targetLabels.overdue");
    case "Sales Deposit":
      return t("grid.targetLabels.salesDeposit");
    case "On Target":
      return t("grid.targetLabels.onTarget");
    case "Closed":
      return t("grid.targetLabels.closed");
    case "Lost":
      return t("grid.targetLabels.lost");
    case "Renewed":
      return t("grid.targetLabels.renewed");
    default:
      return TARGET_STYLE[key] ? key : key;
  }
}

function statusLabel(t: (key: string) => string, key: string): string {
  switch (key) {
    case "active":
      return t("grid.statusLabels.active");
    case "hold":
      return t("grid.statusLabels.hold");
    case "closed":
      return t("grid.statusLabels.closed");
    case "expired":
      return t("grid.statusLabels.expired");
    case "renewed":
      return t("grid.statusLabels.renewed");
    case "lost":
      return t("grid.statusLabels.lost");
    default:
      return STATUS_LABEL[key] ?? key;
  }
}

function typeLabel(t: (key: string) => string, key: string): string {
  switch (key) {
    case "New":
      return t("grid.typeLabels.new");
    case "Renew":
      return t("grid.typeLabels.renew");
    case "UPSELL":
      return t("grid.typeLabels.upsell");
    case "WinBack":
      return t("grid.typeLabels.winBack");
    case "Hold":
      return t("grid.typeLabels.hold");
    case "Switch":
      return t("grid.typeLabels.switch");
    case "Lost":
      return t("grid.typeLabels.lost");
    default:
      return TYPE_LABEL[key] ?? key;
  }
}

function paymentLabel(t: (key: string) => string, key: string): string {
  switch (key) {
    case "Complete":
      return t("grid.paymentLabels.complete");
    case "Installments":
      return t("grid.paymentLabels.installments");
    default:
      return key;
  }
}

function renewedLabel(t: (key: string) => string, key: string): string {
  switch (key) {
    case "YES":
      return t("grid.renewedLabels.yes");
    case "NO":
      return t("grid.renewedLabels.no");
    case "Closed":
      return t("grid.renewedLabels.closed");
    default:
      return key;
  }
}

// 4-color row rule — matches the sheet's row fills (maroon / gold / gray /
// none), tuned for the dark theme. On tinted rows we also brighten the plain-
// text cells ([&_td] override) so client names / dates / numbers stay legible;
// the colored pills use inline styles so they're unaffected.
function rowTone(c: GridContract): string {
  if (c.renewed_status === "NO")
    return "bg-[#4a1616] hover:bg-[#581a1a] [&_td]:text-rose-100/90"; // maroon
  if (c.contract_type_key === "Hold")
    return "bg-[#5f4d0f] hover:bg-[#6e5912] [&_td]:text-amber-50/90"; // gold
  if (c.renewed_status === "Closed")
    return "bg-[#3a3a3a] hover:bg-[#454545] [&_td]:text-zinc-200/90"; // gray
  // Default rows need an explicit OPAQUE fill: the sticky Client ID / العميل
  // cells inherit the row background, and without a solid color the scrolled
  // columns showed THROUGH them — the "text overlap" the team reported.
  return "bg-card hover:bg-soft-1";
}

// Solid-filled cell content matching the sheet (Target / Type / Payment).
function SolidCell({
  label,
  swatch,
  className,
}: {
  label: string;
  swatch: Swatch;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[64px] items-center justify-center rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap",
        className,
      )}
      style={{ backgroundColor: swatch.bg, color: swatch.fg }}
    >
      {label}
    </span>
  );
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(s: string | null | undefined, locale: string) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return formatShortDate(d, locale);
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

// Account-manager pill — solid colored capsule per person, like the sheet.
function AmPill({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap"
      style={{ backgroundColor: amColor(name) }}
    >
      {name}
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
  const t = useTranslations("ContractsPage");
  const locale = useLocale();
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
  // Multi-select filters (team request): each group holds an array of picked
  // values; empty array = «الكل» (no constraint). A row passes when its value
  // is in the array (OR within a group, AND across groups).
  const [targets, setTargets] = useState<string[]>([]);
  // Default = «نشط + منتهي»: both are contracts that haven't closed yet, so
  // those clients still have live work with us. The closed/lost rows stay one
  // chip-click away under «الكل».
  const [statuses, setStatuses] = useState<string[]>(["active", "expired"]);
  const [types, setTypes] = useState<string[]>([]);
  const [scope, setScope] = useState<"all" | "mine">("all");
  // Hold popup — opened when the inline type dropdown picks "Hold".
  const [holdFor, setHoldFor] = useState<GridContract | null>(null);

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
      toast.success(t("grid.toasts.saved", { label }), { duration: 1200 });
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
      if (targets.length && !targets.includes(r.target)) return false;
      if (statuses.length && !statuses.includes(r.status)) return false;
      if (types.length && (!r.contract_type_key || !types.includes(r.contract_type_key)))
        return false;
      if (!q) return true;
      return (
        (r.client_name ?? "").toLowerCase().includes(q) ||
        // «C124» matches both the sheet id and our codes C124-1 / C124-2.
        (r.contract_code ?? "").toLowerCase().includes(q) ||
        // the importer key (C124|20260226) keeps the original sheet identity
        (r.external_id ?? "").toLowerCase().includes(q) ||
        (r.client_external_id ?? "").toLowerCase().includes(q) ||
        (r.account_manager_name ?? "").toLowerCase().includes(q) ||
        r.package_names.some((p) => p.toLowerCase().includes(q)) ||
        (r.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, scope, targets, statuses, types, meEmployeeId]);

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
              placeholder={t("grid.searchPlaceholder")}
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
                {t("grid.scope.all")}
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
                {t("grid.scope.mine")}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <ChipGroup
            label={t("grid.filters.target")}
            values={targets}
            onChange={setTargets}
            options={[
              { value: "Overdue", count: counts.target["Overdue"] ?? 0, label: t("grid.targetLabels.overdue") },
              { value: "Sales Deposit", count: counts.target["Sales Deposit"] ?? 0, label: t("grid.targetLabels.salesDeposit") },
              { value: "On Target", count: counts.target["On Target"] ?? 0, label: t("grid.targetLabels.onTarget") },
              { value: "Closed", count: counts.target["Closed"] ?? 0, label: t("grid.targetLabels.closed") },
            ]}
          />
          <ChipGroup
            label={t("grid.filters.status")}
            values={statuses}
            onChange={setStatuses}
            presets={[
              { value: "open", label: t("grid.filters.openStatus"), members: ["active", "expired"] },
            ]}
            options={[
              { value: "active", count: counts.status["active"] ?? 0, label: t("grid.statusLabels.active") },
              { value: "expired", count: counts.status["expired"] ?? 0, label: t("grid.statusLabels.expired") },
              { value: "hold", count: counts.status["hold"] ?? 0, label: t("grid.statusLabels.hold") },
              { value: "closed", count: counts.status["closed"] ?? 0, label: t("grid.statusLabels.closed") },
            ]}
          />
          <ChipGroup
            label={t("grid.filters.type")}
            values={types}
            onChange={setTypes}
            options={[
              { value: "New", count: counts.type["New"] ?? 0, label: t("grid.typeLabels.new") },
              { value: "Renew", count: counts.type["Renew"] ?? 0, label: t("grid.typeLabels.renew") },
              { value: "UPSELL", count: counts.type["UPSELL"] ?? 0, label: t("grid.typeLabels.upsell") },
              { value: "Hold", count: counts.type["Hold"] ?? 0, label: t("grid.typeLabels.hold") },
              { value: "WinBack", count: counts.type["WinBack"] ?? 0, label: t("grid.typeLabels.winBack") },
            ]}
          />
        </div>

        <div className="flex items-center justify-between border-t border-soft pt-2 text-xs text-muted-foreground">
          <div>
            {t("grid.summary.contracts", { count: filtered.length })}
            {filtered.length !== rows.length && (
              <span> · {t("grid.summary.totalRows", { count: rows.length })}</span>
            )}
          </div>
          <div className="flex items-center gap-3 tabular-nums">
            <span>
              {t("grid.summary.value")}:{" "}
              <span className="text-foreground font-medium">{fmtMoney(totalValue)}</span>
            </span>
            <span>
              {t("grid.summary.paid")}:{" "}
              <span className="text-foreground font-medium">{fmtMoney(totalPaid)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-2xl border border-soft bg-card">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full border-collapse text-right text-[12px]">
            <thead className="sticky top-0 z-20 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th sticky className="text-center min-w-[64px]">{t("grid.headers.clientId")}</Th>
                <Th sticky stickyOffset="64px" className="min-w-[200px]">{t("grid.headers.client")}</Th>
                <Th>{t("grid.headers.accountManager")}</Th>
                <Th>{t("grid.headers.startDate")}</Th>
                <Th>{t("grid.headers.target")}</Th>
                <Th>{t("grid.headers.type")}</Th>
                <Th className="min-w-[200px]">{t("grid.headers.package")}</Th>
                <Th className="text-center">{t("grid.headers.duration")}</Th>
                <Th className="text-end">{t("grid.headers.paid")}</Th>
                <Th className="text-end">{t("grid.headers.repeated")}</Th>
                <Th>{t("grid.headers.payment")}</Th>
                <Th className="text-center">{t("grid.headers.days")}</Th>
                <Th>{t("grid.headers.expectedEnd")}</Th>
                <Th>{t("grid.headers.status")}</Th>
                <Th className="text-end">{t("grid.headers.renewalValue")}</Th>
                <Th className="text-end">{t("grid.headers.renewalPaid")}</Th>
                <Th>{t("grid.headers.actualEnd")}</Th>
                <Th className="text-center">{t("grid.headers.delay")}</Th>
                <Th>{t("grid.headers.renewed")}</Th>
                <Th className="text-center">{t("grid.headers.extension")}</Th>
                <Th className="min-w-[180px]">{t("grid.headers.notes")}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={21} className="px-3 py-10 text-center text-muted-foreground text-sm">
                    {t("grid.emptyFiltered")}
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
                        {c.contract_code ?? c.client_external_id ?? "—"}
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
                          renderView={() => <AmPill name={c.account_manager_name} />}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "account_manager_id", value: v || null },
                              t("grid.labels.accountManager"),
                            )
                          }
                        />
                      ) : (
                        <AmPill name={c.account_manager_name} />
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
                              t("grid.labels.startDate"),
                            )
                          }
                        />
                      ) : (
                        fmtDate(c.start_date, locale)
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <EditableSelect
                          value={c.target}
                          options={[
                            { value: "Overdue", label: t("grid.targetLabels.overdue") },
                            { value: "Sales Deposit", label: t("grid.targetLabels.salesDeposit") },
                            { value: "On Target", label: t("grid.targetLabels.onTarget") },
                            { value: "Closed", label: t("grid.targetLabels.closed") },
                          ]}
                          renderView={() => (
                            <SolidCell
                              label={targetLabel(t, c.target)}
                              swatch={TARGET_STYLE[c.target] ?? { bg: "#B7B7B7", fg: "#2A2A2A" }}
                            />
                          )}
                          onCommit={(v) =>
                            commit(c.id, { field: "target", value: v }, t("grid.labels.target"))
                          }
                        />
                      ) : (
                        <SolidCell
                          label={targetLabel(t, c.target)}
                          swatch={TARGET_STYLE[c.target] ?? { bg: "#B7B7B7", fg: "#2A2A2A" }}
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
                              <SolidCell
                                label={typeLabel(t, c.contract_type_key)}
                                swatch={TYPE_STYLE[c.contract_type_key] ?? { bg: "#B7B7B7", fg: "#2A2A2A" }}
                              />
                            ) : (
                              "—"
                            )
                          }
                          onCommit={(v) => {
                            const picked = contractTypes.find((t) => t.id === v);
                            // Picking Hold → mandatory end-date popup instead
                            // of a silent type change (sheet-parity + cron).
                            if (picked?.key === "Hold") {
                              setHoldFor(c);
                              return Promise.resolve(true);
                            }
                            // Leaving Hold → dedicated lift action: restores
                            // status, clears hold fields, logs HOLD_LIFTED
                            // with the diff vs the ON_HOLD snapshot.
                            if (c.status === "hold") {
                              return liftContractHoldAction({
                                contractId: c.id,
                                newTypeId: v || null,
                              }).then((res) => {
                                if ("error" in res) {
                                  toast.error(res.error);
                                  return false;
                                }
                                toast.success(t("grid.toasts.holdReleased"));
                                router.refresh();
                                return true;
                              });
                            }
                            return commit(
                              c.id,
                              { field: "contract_type_id", value: v || null },
                              t("grid.labels.type"),
                            );
                          }}
                        />
                      ) : c.contract_type_key ? (
                        <SolidCell
                          label={typeLabel(t, c.contract_type_key)}
                          swatch={TYPE_STYLE[c.contract_type_key] ?? { bg: "#B7B7B7", fg: "#2A2A2A" }}
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
                          {c.package_names.map((p, i) => {
                            const sw = PACKAGE_STYLE[p.trim()] ?? PACKAGE_DEFAULT;
                            return (
                              <span
                                key={`${p}-${i}`}
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                                style={{ backgroundColor: sw.bg, color: sw.fg }}
                              >
                                {p}
                              </span>
                            );
                          })}
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
                              t("grid.labels.duration"),
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
                              t("grid.labels.paid"),
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
                              t("grid.labels.repeated"),
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
                            { value: "Complete", label: t("grid.paymentLabels.complete") },
                            { value: "Installments", label: t("grid.paymentLabels.installments") },
                          ]}
                          renderView={() =>
                            c.payment_status && PAYMENT_STYLE[c.payment_status] ? (
                              <SolidCell
                                label={paymentLabel(t, c.payment_status)}
                                swatch={PAYMENT_STYLE[c.payment_status]}
                              />
                            ) : (
                              "—"
                            )
                          }
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "payment_status", value: v || null },
                              t("grid.labels.payment"),
                            )
                          }
                        />
                      ) : c.payment_status && PAYMENT_STYLE[c.payment_status] ? (
                        <SolidCell
                          label={paymentLabel(t, c.payment_status)}
                          swatch={PAYMENT_STYLE[c.payment_status]}
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
                            commit(c.id, { field: "end_date", value: v }, t("grid.labels.expectedEnd"))
                          }
                        />
                      ) : (
                        fmtDate(c.end_date, locale)
                      )}
                    </Td>
                    <Td className="text-[11px] text-muted-foreground">
                      {c.status === "hold" && c.hold_end_date ? (
                        <button
                          type="button"
                          title={t("grid.tooltips.editHold")}
                          onClick={() => canEdit && setHoldFor(c)}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 whitespace-nowrap"
                        >
                          {t("grid.holdUntil", { date: fmtDate(c.hold_end_date, locale) })}
                        </button>
                      ) : (
                        (c.contract_status_label ?? statusLabel(t, c.status))
                      )}
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
                              t("grid.labels.renewalValue"),
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
                              t("grid.labels.renewalPaid"),
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
                              t("grid.labels.actualEnd"),
                            )
                          }
                        />
                      ) : (
                        fmtDate(c.actual_end_date, locale)
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
                            commit(c.id, { field: "delay_days", value: v }, t("grid.labels.delay"))
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
                            { value: "YES", label: t("grid.renewedLabels.yes") },
                            { value: "NO", label: t("grid.renewedLabels.no") },
                            { value: "Closed", label: t("grid.renewedLabels.closed") },
                          ]}
                          renderView={() =>
                            c.renewed_status ? (
                              <Pill
                                label={renewedLabel(t, c.renewed_status)}
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
                              t("grid.labels.renewed"),
                            )
                          }
                        />
                      ) : c.renewed_status ? (
                        <Pill
                          label={renewedLabel(t, c.renewed_status)}
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
                              t("grid.labels.extension"),
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
                          placeholder={t("grid.emptyNote")}
                          onCommit={(v) =>
                            commit(
                              c.id,
                              { field: "notes", value: v || null },
                              t("grid.labels.notes"),
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

      {holdFor && (
        <HoldDialog
          contractId={holdFor.id}
          contractLabel={`${holdFor.contract_code ?? holdFor.client_external_id ?? ""} — ${holdFor.client_name ?? ""}`}
          currentHoldEnd={holdFor.status === "hold" ? holdFor.hold_end_date : null}
          onClose={() => setHoldFor(null)}
        />
      )}
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
        sticky && "sticky z-30 bg-muted",
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
  const t = useTranslations("ContractsPage");
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
        title={t("grid.tooltips.clickToEdit")}
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
      className="h-7 rounded-md border border-cyan/40 bg-popover px-1 text-[12px] text-popover-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
    >
      {options.map((o) => (
        <option
          key={o.value}
          value={o.value}
          style={{
            backgroundColor: "var(--popover)",
            color: "var(--popover-foreground)",
          }}
        >
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
  const t = useTranslations("ContractsPage");
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
      toast.error(t("grid.toasts.invalidNumber"));
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
        title={t("grid.tooltips.clickToEdit")}
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
  const t = useTranslations("ContractsPage");
  const locale = useLocale();
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
        title={t("grid.tooltips.clickToEdit")}
      >
        {fmtDate(value, locale)}
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
  const t = useTranslations("ContractsPage");
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
        title={value || t("grid.tooltips.clickToEdit")}
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
          title={t("grid.tooltips.save")}
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
          title={t("grid.tooltips.cancel")}
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

// Multi-select chip group. `values` is the picked set (empty = «الكل»).
// Toggling a chip adds/removes it; chips OR together within a group. An
// optional `presets` list renders convenience chips (e.g. «نشط + منتهي»)
// that swap the selection to an exact member set in one click.
function ChipGroup({
  label,
  values,
  onChange,
  options,
  presets,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: Array<{ value: string; count: number; label?: string }>;
  presets?: Array<{ value: string; label: string; members: string[] }>;
}) {
  const t = useTranslations("ContractsPage");
  const chipCls = (active: boolean) =>
    cn(
      "rounded-md px-2 py-0.5 transition-colors",
      active
        ? "bg-cyan-dim text-cyan font-medium"
        : "text-muted-foreground hover:text-foreground",
    );
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  function toggle(v: string) {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-soft bg-soft-1 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange([])}
        className={chipCls(values.length === 0)}
      >
        {t("grid.filters.all")}
      </button>
      {presets?.map((p) => {
        const active = sameSet(values, p.members);
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(active ? [] : p.members)}
            className={chipCls(active)}
          >
            {p.label}
          </button>
        );
      })}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => toggle(o.value)}
          className={chipCls(values.includes(o.value))}
        >
          {o.label ?? o.value}{" "}
          <span className="text-muted-foreground/70 tabular-nums">({o.count})</span>
        </button>
      ))}
    </div>
  );
}
