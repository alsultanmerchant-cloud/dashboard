import { Users } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { listEmployees, listDepartments } from "@/lib/data/employees";
import { listOrgRoleOptions } from "@/lib/data/organization";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ROLE_LABELS } from "@/lib/labels";
import { InviteEmployeeDialog } from "./invite-employee-dialog";
import { EmployeesAdmin, type EmployeeRow, type DeptOption } from "./employees-admin";

// One-page employee management for the owner.
// • Reads local employee_profiles (not Odoo live) so it can edit them.
// • Inline edit / soft-delete (terminate) / restore / hard-delete with
//   typed confirmation — all gated on `employees.manage`.
// • Invite dialog remains for adding new staff with login.

export default async function EmployeesPage() {
  const session = await requirePagePermission("employees.view");
  const canManage = hasPermission(session, "employees.manage");

  const [employees, departments, roleOptions] = await Promise.all([
    listEmployees(session.orgId),
    listDepartments(session.orgId),
    listOrgRoleOptions(session.orgId),
  ]);

  // Build a deptId → name lookup + manager_employee_id → full_name lookup so
  // the table can show resolved labels without extra round trips.
  const deptById = new Map<string, string>(
    departments.map((d) => [d.id, d.name]),
  );
  const empById = new Map<string, string>(
    employees.map((e) => [e.id, e.full_name]),
  );

  const rows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    user_id: e.user_id ?? null,
    full_name: e.full_name,
    email: e.email ?? null,
    phone: e.phone ?? null,
    job_title: e.job_title ?? null,
    position: (e as { position?: string | null }).position ?? null,
    employment_status: e.employment_status ?? "active",
    department_id: e.department_id ?? null,
    department_name: e.department_id ? (deptById.get(e.department_id) ?? null) : null,
    manager_employee_id: (e as { manager_employee_id?: string | null }).manager_employee_id ?? null,
    manager_name: (e as { manager_employee_id?: string | null }).manager_employee_id
      ? (empById.get((e as { manager_employee_id?: string }).manager_employee_id!) ?? null)
      : null,
    external_source: (e as { external_source?: string | null }).external_source ?? null,
  }));

  const deptOptions: DeptOption[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
  }));

  const inviteButton = (
    <InviteEmployeeDialog
      departments={departments.map((d) => ({
        id: d.id,
        label: d.name,
        kind: d.kind,
        parent_department_id: d.parent_department_id,
      }))}
      roles={roleOptions.map((r) => ({
        id: r.id,
        label: ROLE_LABELS[r.key] ?? r.name,
      }))}
    />
  );

  return (
    <div>
      <PageHeader
        title="الموظفون"
        description="إدارة كاملة لفريق الوكالة — إضافة، تعديل، إنهاء خدمة، أو حذف نهائي."
        actions={canManage ? inviteButton : null}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="لا يوجد موظفون"
          description="ابدأ بإضافة أول موظف للوكالة."
          action={canManage ? inviteButton : null}
        />
      ) : (
        <EmployeesAdmin
          rows={rows}
          departments={deptOptions}
          canManage={canManage}
        />
      )}
    </div>
  );
}
