import Link from "next/link";
import { Building2, Phone, Mail, Briefcase, ChevronLeft, Globe } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listLiveClientsPaged } from "@/lib/odoo/live";
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
  await requirePagePermission("clients.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows: clients, total, totals } = await listLiveClientsPaged({
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="العملاء"
        description="قاعدة عملاء الوكالة — مباشرة من Odoo."
      />

      {total > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="إجمالي العملاء"
            value={totals.clients}
            icon={<Building2 className="size-5" />}
            tone="default"
          />
          <MetricCard
            label="عملاء نشطون"
            value={totals.activeClients}
            hint="لديهم مشاريع"
            icon={<Briefcase className="size-5" />}
            tone="success"
          />
          <MetricCard
            label="إجمالي المشاريع"
            value={totals.activeProjects}
            tone="info"
          />
          <MetricCard
            label="بيانات تواصل"
            value={totals.reachable}
            hint={`${totals.clients - totals.reachable} بدون`}
            icon={<Mail className="size-5" />}
            tone={totals.reachable === totals.clients ? "success" : "warning"}
          />
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="لا يوجد عملاء"
          description="لا توجد شركاء عملاء في Odoo حالياً."
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>التواصل</DataTableHeaderCell>
                <DataTableHeaderCell>الموقع</DataTableHeaderCell>
                <DataTableHeaderCell>المشاريع</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="إجراءات" />
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
                      aria-label="فتح"
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
