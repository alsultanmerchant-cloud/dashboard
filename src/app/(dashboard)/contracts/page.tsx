import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSignature, ScrollText, Table2, TrendingUp } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import {
  listContractsGrid,
  listContractTypes,
  getMonthlyDashboard,
  getContractsRoster,
  listDashboardMonths,
  getAmTargets,
  getMonthTargetBuckets,
  getCeoClientInsights,
  getContractsSyncedAt,
  refreshMonthlyDashboard,
  type GridContract,
} from "@/lib/data/contracts";
import { listAccountManagers } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { getTranslations, getLocale } from "next-intl/server";
import type { ContractGridFilters } from "./contracts-grid";

// Contracts module — two sections on one page, switched by ?view=:
//   • table     → the sheet-parity editable grid (default)
//   • dashboard → the CEO monthly revenue dashboard (target engine)
// Mirrors the team's mental model of the Google Sheet tabs, but in one place.
//
// Source of truth: dashboard. The sheet is archived; all edits happen here.

// "Pull from Sheet" (syncGoogleSheetAction) runs from this route and downloads
// + parses the whole Google workbook + writes contracts/installments/logs/
// dashboard tabs. At 60s it hit FUNCTION_INVOCATION_TIMEOUT. The identical sync
// runs from /api/cron/contracts-google-sheet-sync at maxDuration=300, so match
// it here (Vercel Pro ceiling) — paired with the parse-the-workbook-once fix in
// google-sheets-sync.ts.
export const maxDuration = 300;

const CONTRACT_TARGET_FILTERS = new Set(["Overdue", "Sales Deposit", "On Target", "Closed"]);
const CONTRACT_STATUS_FILTERS = new Set(["Active", "Expired", "SOON", "Closed"]);
const CONTRACT_TYPE_FILTERS = new Set(["New", "Renew", "UPSELL", "Hold", "WinBack"]);
const CONTRACT_PAYMENT_FILTERS = new Set(["Installments", "Complete"]);

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCsvParam(value: string | string[] | undefined, allowed?: Set<string>): string[] | undefined {
  const raw = firstParam(value);
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "all") return [];
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => !allowed || allowed.has(item));
  return values.length > 0 ? values : [];
}

function parseContractGridFilters(
  sp: Record<string, string | string[] | undefined>,
): ContractGridFilters {
  return {
    search: firstParam(sp.q)?.trim() || undefined,
    targets: parseCsvParam(sp.target, CONTRACT_TARGET_FILTERS),
    statuses: parseCsvParam(sp.status, CONTRACT_STATUS_FILTERS),
    types: parseCsvParam(sp.type, CONTRACT_TYPE_FILTERS),
    packages: parseCsvParam(sp.package),
    payments: parseCsvParam(sp.payment, CONTRACT_PAYMENT_FILTERS),
    scope: firstParam(sp.scope) === "mine" ? "mine" : undefined,
  };
}

function contractGridFilterKey(filters: ContractGridFilters): string {
  return JSON.stringify(filters);
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePagePermission("contract.view");
  const t = await getTranslations("ContractsPage");
  const canEdit = hasPermission(session, "contract.manage");
  // The CEO revenue dashboard (targets, income, achievement) is financial data.
  // The roster table + logs are operational and stay visible to contract.view.
  const canFinance = hasPermission(session, "finance.view");
  const sp = await searchParams;
  const view = sp.view === "dashboard" ? "dashboard" : sp.view === "logs" ? "logs" : "table";
  if (view === "dashboard" && !canFinance) {
    redirect("/contracts?view=table");
  }

  // "Last synced" shown beside the Pull-from-Sheet button. Format server-side in
  // the agency's timezone (Vercel runs UTC, so an unzoned format would read ~3h
  // behind Saudi local time) — a fixed string also avoids client hydration drift.
  const locale = await getLocale();
  const syncedIso =
    view === "dashboard" && canEdit
      ? await getContractsSyncedAt(session.orgId)
      : null;
  const lastSyncedLabel = syncedIso
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Riyadh",
      }).format(new Date(syncedIso))
    : null;

  const tabs = (
    <div className="inline-flex rounded-[var(--radius-md)] border border-border/80 bg-card/95 p-1 text-xs shadow-[var(--surface-elev)]">
      <Link
        href="/contracts?view=table"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 transition-colors",
          view === "table"
            ? "bg-cyan-dim text-cyan font-medium"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Table2 className="size-3.5" />
        {t("tabs.table")}
      </Link>
      {canFinance && (
        <Link
          href="/contracts?view=dashboard"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 transition-colors",
            view === "dashboard"
              ? "bg-cyan-dim text-cyan font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <TrendingUp className="size-3.5" />
          {t("tabs.dashboard")}
        </Link>
      )}
      <Link
        href="/contracts?view=logs"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 transition-colors",
          view === "logs"
            ? "bg-cyan-dim text-cyan font-medium"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ScrollText className="size-3.5" />
        {t("tabs.logs")}
      </Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {tabs}
        {view === "table" && canEdit && (
          <ContractsHeaderActions />
        )}
        {view === "dashboard" && canEdit && (
          <DashboardHeaderActions
            lastSyncedLabel={lastSyncedLabel}
            importLabel={t("header.import")}
          />
        )}
      </div>

      {view === "dashboard" ? (
        <DashboardSection
          orgId={session.orgId}
          month={typeof sp.m === "string" ? sp.m : undefined}
        />
      ) : view === "logs" ? (
        <ContractLogsSection orgId={session.orgId} searchParams={sp} />
      ) : (
        <TableSection
          orgId={session.orgId}
          canEdit={canEdit}
          meEmployeeId={session.employeeId ?? null}
          initialFilters={parseContractGridFilters(sp)}
        />
      )}
    </div>
  );
}

// --- Table section ---------------------------------------------------------

async function TableSection({
  orgId,
  canEdit,
  meEmployeeId,
  initialFilters,
}: {
  orgId: string;
  canEdit: boolean;
  meEmployeeId: string | null;
  initialFilters: ContractGridFilters;
}) {
  const [{ ContractsGrid }, rows, types, ams] = await Promise.all([
    import("./contracts-grid"),
    listContractsGrid(orgId),
    listContractTypes(orgId),
    listAccountManagers(orgId),
  ]);
  const t = await getTranslations("ContractsPage");

  const typeOptions = types.map((t) => ({ id: t.id, key: t.key, label: t.name_ar }));
  const amOptions = ams.map((a) => ({ id: a.id, full_name: a.full_name }));

  if ((rows as GridContract[]).length === 0) {
    return (
      <EmptyState
        icon={<FileSignature className="size-6" />}
        title={t("empty.listTitle")}
        description={t("empty.listDescription")}
      />
    );
  }

  return (
    <ContractsGrid
      key={contractGridFilterKey(initialFilters)}
      rows={rows}
      meEmployeeId={meEmployeeId}
      canEdit={canEdit}
      contractTypes={typeOptions}
      accountManagers={amOptions}
      initialFilters={initialFilters}
    />
  );
}

// The button bundle loads with the table, but its large option lists are fetched
// only after the user opens the dialog.
async function ContractsHeaderActions() {
  const { NewContractButton } = await import("./new-contract-dialog");
  return <NewContractButton />;
}

async function ContractLogsSection({
  orgId,
  searchParams,
}: {
  orgId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { LogsSection } = await import("./logs-section");
  return <LogsSection orgId={orgId} searchParams={searchParams} />;
}

async function DashboardHeaderActions({
  lastSyncedLabel,
  importLabel,
}: {
  lastSyncedLabel: string | null;
  importLabel: string;
}) {
  const { SheetSyncButton } = await import("./sheet-sync-button");
  return (
    <div className="flex items-center gap-2">
      <SheetSyncButton lastSyncedLabel={lastSyncedLabel} />
      <Link
        href="/contracts/import"
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-border/80 bg-card/95 px-3 text-xs font-semibold text-muted-foreground shadow-[var(--surface-elev)] transition-colors hover:bg-muted hover:text-foreground"
      >
        {importLabel}
      </Link>
    </div>
  );
}

// --- Dashboard section -----------------------------------------------------

async function DashboardSection({
  orgId,
  month,
}: {
  orgId: string;
  month?: string;
}) {
  const t = await getTranslations("ContractsPage");
  const months = await listDashboardMonths(orgId);
  const selected = month ?? months[0]?.month ?? undefined;
  const selectedMonth = months.find((item) => item.month === selected);

  // Frozen months are immutable and need no write RPC during navigation.
  // Live months run both recomputations once, in parallel, before their rows
  // are read.
  if (selected && !selectedMonth?.is_frozen) {
    await refreshMonthlyDashboard(orgId, selected);
  }

  const [{ CeoDashboard }, dashboard, roster, amTargets, buckets, clientInsights] =
    await Promise.all([
      import("./ceo-dashboard"),
      getMonthlyDashboard(orgId, selected),
      getContractsRoster(orgId),
      getAmTargets(orgId, selected),
      getMonthTargetBuckets(orgId, selected),
      getCeoClientInsights(orgId, selected, 50),
    ]);

  if (!dashboard) {
    return (
      <div className="rounded-2xl border border-dashed border-soft-2 bg-soft-1/40 px-4 py-16 text-center">
        <TrendingUp className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("empty.dashboardDescription")}</p>
      </div>
    );
  }

  // For sheet-imported months, show the sheet's own "Client Status Overview"
  // counts (parity) instead of the live Supabase roster, which counts on a
  // different basis and disagrees with the sheet.
  const rosterForView =
    dashboard.source === "sheet_import"
      ? {
          total: dashboard.cnt_total_clients,
          cnt_new: dashboard.cnt_roster_new,
          cnt_renew: dashboard.cnt_roster_renew,
          cnt_upsell: dashboard.cnt_roster_upsell,
          cnt_winback: dashboard.cnt_roster_winback,
          cnt_hold: dashboard.cnt_roster_hold,
          cnt_switch: 0,
          cnt_untyped: 0,
        }
      : roster;

  return (
    <CeoDashboard
      dashboard={dashboard}
      roster={rosterForView}
      amTargets={amTargets}
      buckets={buckets}
      clientInsights={clientInsights}
      months={months}
      selectedMonth={selected ?? dashboard.month}
    />
  );
}
