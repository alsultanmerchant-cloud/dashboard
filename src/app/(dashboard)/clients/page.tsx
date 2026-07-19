import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building2, Phone, Mail, Briefcase, ChevronLeft, Globe, Merge, FileText } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { listClientsPage, type ClientSource } from "@/lib/data/clients";
import { getClientFinanceMap } from "@/lib/data/client-finance";
import { ClientFinanceBadges } from "@/components/client-finance-badges";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { Pagination } from "@/components/pagination";
import { cn } from "@/lib/utils";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { ConnectLinksDialog } from "./connect-links-dialog";

const PAGE_SIZE = 25;

const SOURCE_FILTERS = ["all", "contracts", "delivery", "both"] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];

// Per-source chip styling for the "which world is this client from" badge.
const SOURCE_STYLE: Record<ClientSource, string> = {
  contracts: "border-cyan/30 bg-cyan-dim text-cyan",
  delivery: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  both: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  other: "border-soft bg-soft-1 text-muted-foreground",
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; source?: string }>;
}) {
  const session = await requirePagePermission("clients.view");
  const canManage = hasPermission(session, "clients.manage");
  const t = await getTranslations("ClientsPage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const source = (SOURCE_FILTERS.includes(sp.source as SourceFilter)
    ? sp.source
    : "all") as SourceFilter;

  const [{ rows: clients, total, totals }, financeMap] = await Promise.all([
    listClientsPage(session.orgId, { page, pageSize: PAGE_SIZE, source }),
    getClientFinanceMap(session.orgId),
  ]);

  // Build the source-filter tab hrefs (reset to page 1 on switch).
  const tabHref = (s: SourceFilter) =>
    s === "all" ? "/clients" : `/clients?source=${s}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage ? (
            <Link
              href="/clients/merge"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              <Merge className="size-3.5" />
              دمج المكررين
            </Link>
          ) : null
        }
      />

      {totals.clients > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={t("stats.totalClients")}
            value={totals.clients}
            icon={<Building2 className="size-5" />}
            tone="default"
          />
          <MetricCard
            label={t("stats.contractsClients")}
            value={totals.contracts}
            hint={t("stats.contractsClientsHint")}
            icon={<FileText className="size-5" />}
            tone="info"
          />
          <MetricCard
            label={t("stats.deliveryClients")}
            value={totals.delivery}
            hint={t("stats.deliveryClientsHint")}
            icon={<Briefcase className="size-5" />}
            tone="success"
          />
          <MetricCard
            label={t("stats.contactData")}
            value={totals.reachable}
            hint={t("stats.contactDataHint", { count: totals.clients - totals.reachable })}
            icon={<Mail className="size-5" />}
            tone={totals.reachable === totals.clients ? "success" : "warning"}
          />
        </div>
      )}

      {totals.clients > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {SOURCE_FILTERS.map((s) => (
            <Link
              key={s}
              href={tabHref(s)}
              className={cn(
                "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors",
                source === s
                  ? "border-cyan/40 bg-cyan-dim text-cyan"
                  : "border-soft bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`filter.${s}`)}
            </Link>
          ))}
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>{t("table.client")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.contact")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.location")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.contracts")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.projects")}</DataTableHeaderCell>
                <DataTableHeaderCell aria-label={t("table.actions")} />
              </tr>
            </DataTableHead>
            <tbody>
              {clients.map((c) => {
                // Every client has a unified detail page at /clients/[id] keyed by
                // the Supabase UUID (contracts list + activity feed + composer).
                const detailHref = `/clients/${c.id}`;
                return (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link href={detailHref} className="hover:text-cyan transition-colors" data-private="client">
                          {c.name}
                        </Link>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                            SOURCE_STYLE[c.source],
                          )}
                        >
                          {t(`source.${c.source}`)}
                        </span>
                      </div>
                      <ClientFinanceBadges badge={financeMap[c.id]} className="mt-1 block" />
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      <div className="flex flex-col gap-1 text-xs">
                        {c.phone && (
                          <span className="inline-flex items-center gap-1.5" dir="ltr">
                            <Phone className="size-3" /> {c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="inline-flex items-center gap-1.5" dir="ltr">
                            <Mail className="size-3" /> {c.email}
                          </span>
                        )}
                        {!c.phone && !c.email && "—"}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {c.website ? (
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <Globe className="size-3" /> {c.website}
                        </span>
                      ) : (
                        "—"
                      )}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{c.contracts || "—"}</DataTableCell>
                    <DataTableCell className="tabular-nums">{c.projects || "—"}</DataTableCell>
                    <DataTableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <ConnectLinksDialog clientId={c.id} clientName={c.name} variant="icon" />
                        )}
                        <Link
                          href={detailHref}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground transition-colors"
                          aria-label={t("openClient")}
                        >
                          <ChevronLeft className="size-3.5 icon-flip-rtl" />
                        </Link>
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}

      {total > PAGE_SIZE && (
        <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} />
      )}
    </div>
  );
}
