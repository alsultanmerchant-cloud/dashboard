import { Users, Mail, Phone } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listEmployees, listDepartments } from "@/lib/data/employees";
import { listOrgRoleOptions, getEmployeeRoleAssignments } from "@/lib/data/organization";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { EmploymentStatusBadge } from "@/components/status-badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { ROLE_LABELS } from "@/lib/labels";
import { InviteEmployeeDialog } from "./invite-employee-dialog";

export default async function EmployeesPage() {
  const session = await requirePagePermission("employees.view");
  const [employees, departments, roleOptions] = await Promise.all([
    listEmployees(session.orgId),
    listDepartments(session.orgId),
    listOrgRoleOptions(session.orgId),
  ]);

  const userIds = employees.map((e) => e.user_id).filter((x): x is string => !!x);
  const roleMap = await getEmployeeRoleAssignments(session.orgId, userIds);

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
        description="فريق الوكالة، أقسامهم، أدوارهم في النظام."
        actions={inviteButton}
      />

      {employees.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="لا يوجد موظفون بعد"
          description="ابدأ بدعوة أول موظف لإنشاء حساب وصوله."
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
                <DataTableHeaderCell>التواصل</DataTableHeaderCell>
                <DataTableHeaderCell>الأدوار</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {employees.map((e) => {
                const dept = Array.isArray(e.department) ? e.department[0] : e.department;
                const roles = (e.user_id ? roleMap.get(e.user_id) : undefined) ?? [];
                return (
                  <DataTableRow key={e.id}>
                    <DataTableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar size="sm">
                          <AvatarFallback>{e.full_name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{e.full_name}</p>
                          {e.email && (
                            <p className="text-[11px] text-muted-foreground" dir="ltr">{e.email}</p>
                          )}
                        </div>
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{e.job_title ?? "—"}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{dept?.name ?? "—"}</DataTableCell>
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
                      <div className="flex flex-wrap gap-1">
                        {roles.length === 0 ? (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        ) : (
                          roles.map((r, i) => (
                            <Badge
                              key={i}
                              variant={r.roleKey === "owner" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {r.roleName}
                            </Badge>
                          ))
                        )}
                      </div>
                    </DataTableCell>
                    <DataTableCell>
                      <EmploymentStatusBadge status={e.employment_status} />
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
