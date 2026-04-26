import { Building2, Phone, Mail } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listClients } from "@/lib/data/clients";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ClientStatusBadge } from "@/components/status-badges";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicDate } from "@/lib/utils-format";
import { copy } from "@/lib/copy";
import { NewClientDialog } from "./new-client-dialog";

export default async function ClientsPage() {
  const session = await requirePagePermission("clients.view");
  const clients = await listClients(session.orgId);

  return (
    <div>
      <PageHeader
        title="العملاء"
        description="إدارة قاعدة العملاء وملفاتهم. كل عميل يمكن أن يحمل عدة مشاريع."
        actions={<NewClientDialog />}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title={copy.empty.clients.title}
          description={copy.empty.clients.description}
          action={<NewClientDialog />}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>جهة الاتصال</DataTableHeaderCell>
                <DataTableHeaderCell>التواصل</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                <DataTableHeaderCell>عدد المشاريع</DataTableHeaderCell>
                <DataTableHeaderCell>تاريخ الإضافة</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {clients.map((c) => {
                const projectCount = Array.isArray(c.projects) ? c.projects[0]?.count ?? 0 : 0;
                return (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="font-medium">{c.name}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {c.contact_name || "—"}
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
                    <DataTableCell>
                      <ClientStatusBadge status={c.status} />
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{projectCount}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {formatArabicDate(c.created_at)}
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}
    </div>
  );
}
