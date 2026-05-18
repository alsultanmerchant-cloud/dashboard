import { Building, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { listDepartments } from "@/lib/data/employees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { NewDepartmentDialog } from "./new-department-dialog";
import { EditDepartmentDialog } from "./edit-department-dialog";

async function getDepartmentsWithCounts(orgId: string) {
  const departments = await listDepartments(orgId);
  if (departments.length === 0) return [];
  const ids = departments.map((d) => d.id);
  const { data: employees } = await supabaseAdmin
    .from("employee_profiles")
    .select("department_id")
    .eq("organization_id", orgId)
    .in("department_id", ids);
  const counts: Record<string, number> = {};
  for (const e of employees ?? []) {
    if (e.department_id) counts[e.department_id] = (counts[e.department_id] ?? 0) + 1;
  }
  return departments.map((d) => ({ ...d, employeeCount: counts[d.id] ?? 0 }));
}

export default async function DepartmentsPage() {
  const session = await requirePagePermission("employees.view");
  const t = await getTranslations("OrganizationDepartmentsPage");
  const departments = await getDepartmentsWithCounts(session.orgId);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<NewDepartmentDialog />}
      />

      {departments.length === 0 ? (
        <EmptyState
          icon={<Building className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<NewDepartmentDialog />}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTableShell className="border-0">
              <DataTable>
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell>{t("table.department")}</DataTableHeaderCell>
                    <DataTableHeaderCell>{t("table.slug")}</DataTableHeaderCell>
                    <DataTableHeaderCell>{t("table.description")}</DataTableHeaderCell>
                    <DataTableHeaderCell>{t("table.employeeCount")}</DataTableHeaderCell>
                    <DataTableHeaderCell>{t("table.edit")}</DataTableHeaderCell>
                  </tr>
                </DataTableHead>
                <tbody>
                  {departments.map((d) => (
                    <DataTableRow key={d.id}>
                      <DataTableCell className="font-medium">{d.name}</DataTableCell>
                      <DataTableCell className="font-mono text-xs text-muted-foreground" dir="ltr">{d.slug}</DataTableCell>
                      <DataTableCell className="text-xs text-muted-foreground">{d.description ?? "—"}</DataTableCell>
                      <DataTableCell>
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-dim px-2 py-0.5 text-xs text-cyan tabular-nums">
                          <Users className="size-3" />
                          {d.employeeCount}
                        </span>
                      </DataTableCell>
                      <DataTableCell>
                        <EditDepartmentDialog
                          department={{
                            id: d.id,
                            name: d.name,
                            slug: d.slug,
                            description: d.description ?? null,
                          }}
                        />
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </tbody>
              </DataTable>
            </DataTableShell>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
