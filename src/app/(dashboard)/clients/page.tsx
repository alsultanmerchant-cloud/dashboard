import Link from "next/link";
import { Building2, Phone, Mail, Briefcase, ChevronLeft, Globe } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listLiveClients } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";

export default async function ClientsPage() {
  await requirePagePermission("clients.view");
  const clients = await listLiveClients();

  const withProjects = clients.filter((c) => c.projectCount > 0).length;
  const totalProjects = clients.reduce((sum, c) => sum + c.projectCount, 0);
  const reachable = clients.filter((c) => c.email || c.phone).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="العملاء"
        description="قاعدة عملاء الوكالة — مباشرة من Odoo."
      />

      {clients.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="إجمالي العملاء"
            value={clients.length}
            icon={<Building2 className="size-5" />}
            tone="default"
          />
          <MetricCard
            label="عملاء نشطون"
            value={withProjects}
            hint="لديهم مشاريع"
            icon={<Briefcase className="size-5" />}
            tone="success"
          />
          <MetricCard
            label="إجمالي المشاريع"
            value={totalProjects}
            tone="info"
          />
          <MetricCard
            label="بيانات تواصل"
            value={reachable}
            hint={`${clients.length - reachable} بدون`}
            icon={<Mail className="size-5" />}
            tone={reachable === clients.length ? "success" : "warning"}
          />
        </div>
      )}

      {clients.length === 0 ? (
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
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
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
    </div>
  );
}
