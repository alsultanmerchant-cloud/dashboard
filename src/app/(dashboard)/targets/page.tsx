import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeTargetForm, DepartmentTargetForm } from "./targets-forms";

function firstOfThisMonth(): string {
  const now = new Date();
  const m = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${m}-01`;
}

export default async function TargetsPage() {
  const session = await requirePagePermission("target.view");
  const defaultMonth = firstOfThisMonth();

  const [{ data: members }, { data: depts }] = await Promise.all([
    supabaseAdmin
      .from("employee_profiles")
      .select("id, full_name")
      .eq("organization_id", session.orgId)
      .order("full_name", { ascending: true }),
    supabaseAdmin
      .from("departments")
      .select("id, name")
      .eq("organization_id", session.orgId)
      .order("name", { ascending: true }),
  ]);

  return (
    <div>
      <PageHeader title="الأهداف الشهرية" description="تحديد أهداف الموظفين والأقسام لاحتساب الإنجاز مقابل الهدف" />

      <section className="mb-8">
        <SectionTitle title="هدف موظف" description="يظهر في تقرير الإقفال الشهري كنسبة إنجاز" />
        <Card>
          <CardContent className="p-4">
            <EmployeeTargetForm members={members ?? []} defaultMonth={defaultMonth} />
          </CardContent>
        </Card>
      </section>

      <section className="mb-8">
        <SectionTitle title="هدف قسم" description="أهداف على مستوى القسم" />
        <Card>
          <CardContent className="p-4">
            <DepartmentTargetForm depts={depts ?? []} defaultMonth={defaultMonth} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
