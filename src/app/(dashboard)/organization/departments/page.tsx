import { Building, Users } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
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
  const session = await requireSession();
  const departments = await getDepartmentsWithCounts(session.orgId);

  return (
    <div>
      <PageHeader
        title="الأقسام"
        description="هيكل الوكالة وتقسيمات الفرق."
        actions={<NewDepartmentDialog />}
      />

      {departments.length === 0 ? (
        <EmptyState
          icon={<Building className="size-6" />}
          title="لا توجد أقسام بعد"
          description="ابدأ بإضافة الأقسام الأساسية في الوكالة."
          action={<NewDepartmentDialog />}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTableShell className="border-0">
              <DataTable>
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell>القسم</DataTableHeaderCell>
                    <DataTableHeaderCell>المعرّف</DataTableHeaderCell>
                    <DataTableHeaderCell>الوصف</DataTableHeaderCell>
                    <DataTableHeaderCell>عدد الموظفين</DataTableHeaderCell>
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
