import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { listEmployees, listDepartments } from "@/lib/data/employees";
import { listOrgRoleOptions } from "@/lib/data/organization";
import { listPositions } from "@/lib/data/positions";
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
  const t = await getTranslations("OrganizationEmployeesPage");
  const tRoles = await getTranslations("RoleLabels");
  const canManage = hasPermission(session, "employees.manage");

  const [employees, departments, roleOptions, positions] = await Promise.all([
    listEmployees(session.orgId),
    listDepartments(session.orgId),
    listOrgRoleOptions(session.orgId),
    listPositions(session.orgId),
  ]);

  // Build a deptId → name lookup + manager_employee_id → full_name lookup so
  // the table can show resolved labels without extra round trips.
  const deptById = new Map<string, string>(
    departments.map((d) => [d.id, d.name]),
  );
  const empById = new Map<string, string>(
    employees.map((e) => [e.id, e.full_name]),
  );
  // #11: department-head lookup so each employee row can resolve "رئيس القسم"
  // from their department's head_employee_id.
  const deptHeadById = new Map<string, string | null>(
    departments.map((d) => [d.id, d.head_employee_id ?? null]),
  );

  const rows: EmployeeRow[] = employees.map((e) => {
    const teamLeaderId =
      (e as { team_leader_employee_id?: string | null }).team_leader_employee_id ?? null;
    const deptHeadId = e.department_id
      ? (deptHeadById.get(e.department_id) ?? null)
      : null;
    return {
      id: e.id,
      user_id: e.user_id ?? null,
      full_name: e.full_name,
      email: e.email ?? null,
      phone: e.phone ?? null,
      job_title: e.job_title ?? null,
      position: (e as { position?: string | null }).position ?? null,
      position_id: (e as { position_id?: string | null }).position_id ?? null,
      employment_status: e.employment_status ?? "active",
      department_id: e.department_id ?? null,
      department_name: e.department_id ? (deptById.get(e.department_id) ?? null) : null,
      manager_employee_id:
        (e as { manager_employee_id?: string | null }).manager_employee_id ?? null,
      manager_name: (e as { manager_employee_id?: string | null }).manager_employee_id
        ? (empById.get((e as { manager_employee_id?: string }).manager_employee_id!) ?? null)
        : null,
      team_leader_employee_id: teamLeaderId,
      team_leader_name: teamLeaderId ? (empById.get(teamLeaderId) ?? null) : null,
      department_head_name: deptHeadId ? (empById.get(deptHeadId) ?? null) : null,
      external_source: (e as { external_source?: string | null }).external_source ?? null,
    };
  });

  const deptOptions: DeptOption[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
    head_employee_id: d.head_employee_id ?? null,
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
        label: tRoles.has(r.key) ? tRoles(r.key) : ROLE_LABELS[r.key] ?? r.name,
      }))}
      positions={positions}
    />
  );

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canManage ? inviteButton : null}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={canManage ? inviteButton : null}
        />
      ) : (
        <EmployeesAdmin
          rows={rows}
          departments={deptOptions}
          positions={positions}
          canManage={canManage}
        />
      )}
    </div>
  );
}
