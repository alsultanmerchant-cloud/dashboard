import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building2, Phone, Mail, Briefcase, ChevronLeft, Globe, Merge } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { listLiveClientsPaged } from "@/lib/odoo/live";
import { getClientFinanceMapByOdooId } from "@/lib/data/client-finance";
import { ClientFinanceBadges } from "@/components/client-finance-badges";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { Pagination } from "@/components/pagination";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";

const PAGE_SIZE = 25;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePagePermission("clients.view");
  const canManage = hasPermission(session, "clients.manage");
  const t = await getTranslations("ClientsPage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows: clients, total, totals }, financeMap] = await Promise.all([
    listLiveClientsPaged({ page, pageSize: PAGE_SIZE }),
    getClientFinanceMapByOdooId(session.orgId),
  ]);

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

      {total > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={t("stats.totalClients")}
            value={totals.clients}
            icon={<Building2 className="size-5" />}
            tone="default"
          />
          <MetricCard
            label={t("stats.activeClients")}
            value={totals.activeClients}
            hint={t("stats.activeClientsHint")}
            icon={<Briefcase className="size-5" />}
            tone="success"
          />
          <MetricCard
            label={t("stats.totalProjects")}
            value={totals.activeProjects}
            tone="info"
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
                <DataTableHeaderCell>{t("table.projects")}</DataTableHeaderCell>
                <DataTableHeaderCell aria-label={t("table.actions")} />
              </tr>
            </DataTableHead>
            <tbody>
              {clients.map((c) => (
                <DataTableRow key={c.odooId}>
                  <DataTableCell className="font-medium">
                    <Link
                      href={`/clients/odoo/${c.odooId}`}
                      className="hover:text-cyan transition-colors"
                    >
                      {c.name}
                    </Link>
                    <ClientFinanceBadges
                      badge={financeMap[String(c.odooId)]}
                      className="mt-1 block"
                    />
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
                  <DataTableCell className="tabular-nums">{c.projectCount}</DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`/clients/odoo/${c.odooId}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground transition-colors"
                      aria-label={t("openClient")}
                    >
                      <ChevronLeft className="size-3.5 icon-flip-rtl" />
                    </Link>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}

      {total > 0 && (
        <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} />
      )}
    </div>
  );
}
