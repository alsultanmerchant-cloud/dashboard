import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { HolidaysForm, type HolidayRow } from "./holidays-form";

export const dynamic = "force-dynamic";

export default async function HolidaysPage() {
  const session = await requirePagePermission("settings.manage");

  const { data } = await supabaseAdmin
    .from("holidays")
    .select("id, holiday_date, name, recurring")
    .eq("organization_id", session.orgId)
    .order("holiday_date", { ascending: true });

  const rows = ((data ?? []) as HolidayRow[]);

  return (
    <div>
      <PageHeader
        title="الإجازات الرسمية"
        description="تُستخدم في حسابات الجدولة (مخطط جانت، حساب التواريخ، التذكيرات) لتخطّي أيام العطل. أسبوع العمل: الأحد–الخميس."
        breadcrumbs={[
          { label: "الإعدادات", href: "/settings" },
          { label: "الإجازات الرسمية" },
        ]}
      />
      <Card>
        <CardContent className="p-4">
          <HolidaysForm
            rows={rows}
            canManage={hasPermission(session, "projects.manage")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
