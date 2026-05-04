import Link from "next/link";
import { Users, Mail, Phone, ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listLiveEmployeesPaged } from "@/lib/odoo/live";
import { listDepartments } from "@/lib/data/employees";
import { listOrgRoleOptions } from "@/lib/data/organization";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { ROLE_LABELS } from "@/lib/labels";
import { InviteEmployeeDialog } from "./invite-employee-dialog";

const PAGE_SIZE = 25;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePagePermission("employees.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows: employees, total }, departments, roleOptions] = await Promise.all([
    listLiveEmployeesPaged({ page, pageSize: PAGE_SIZE }),
    listDepartments(session.orgId),
    listOrgRoleOptions(session.orgId),
  ]);

  const inviteButton = (
    <InviteEmployeeDialog
      departments={departments.map((d) => ({
        id: d.id,
        label: d.name,
        kind: d.kind,
        parent_department_id: d.parent_department_id,
      }))}
      roles={roleOptions.map((r) => ({ id: r.id, label: ROLE_LABELS[r.key] ?? r.name }))}
    />
  );

  return (
    <div>
      <PageHeader
        title="الموظفون"
        description="فريق الوكالة من Odoo — الأقسام والمسميات الوظيفية."
        actions={inviteButton}
      />

      {total === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="لا يوجد موظفون"
          description="لا يوجد موظفون نشطون في Odoo حالياً."
          action={inviteButton}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>الموظف</DataTableHeaderCell>
                <DataTableHeaderCell>المسمى</DataTableHeaderCell>
                <DataTableHeaderCell>القسم</DataTableHeaderCell>
                <DataTableHeaderCell>المدير المباشر</DataTableHeaderCell>
                <DataTableHeaderCell>التواصل</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="إجراءات" />
              </tr>
            </DataTableHead>
            <tbody>
              {employees.map((e) => (
                <DataTableRow key={e.odooId}>
                  <DataTableCell>
                    <Link
                      href={`/organization/employees/odoo/${e.odooId}`}
                      className="flex items-center gap-2.5 hover:text-cyan transition-colors"
                    >
                      <Avatar size="sm">
                        <AvatarFallback>{e.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.name}</p>
                        {e.email && (
                          <p className="text-[11px] text-muted-foreground" dir="ltr">{e.email}</p>
                        )}
                      </div>
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {e.jobTitle ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {e.departmentName ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {e.managerName ?? "—"}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-col gap-1 text-[11px]">
                      {e.phone && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground" dir="ltr">
                          <Phone className="size-3" /> {e.phone}
                        </span>
                      )}
                      {e.email && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground" dir="ltr">
                          <Mail className="size-3" /> {e.email}
                        </span>
                      )}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`/organization/employees/odoo/${e.odooId}`}
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

      {total > 0 && (
        <div className="mt-4">
          <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} />
        </div>
      )}
    </div>
  );
}
