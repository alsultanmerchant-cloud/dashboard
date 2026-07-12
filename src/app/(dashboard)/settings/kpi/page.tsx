import { Info } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getRiskThreshold, getOverloadProjectsThreshold } from "@/lib/data/kpi-settings";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { KpiForm } from "./kpi-form";

export const dynamic = "force-dynamic";

// Editable business thresholds for the Executive Indicators (client spec §9 —
// "avoid hardcoded thresholds; use the configured value"). Persisted in
// kpi_settings (migration 0233) and read live by the dashboard cards.
export default async function KpiSettingsPage() {
  const session = await requirePagePermission("settings.manage");
  const [threshold, overloadThreshold] = await Promise.all([
    getRiskThreshold(session.orgId),
    getOverloadProjectsThreshold(session.orgId),
  ]);

  return (
    <div>
      <PageHeader
        title="عتبات المؤشرات التنفيذية"
        description="حدود العمل القابلة للضبط للمؤشرات التنفيذية في لوحة القيادة. تُستخدم القيمة المحفوظة مباشرةً في الحساب."
        breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "عتبات المؤشرات" }]}
      />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/5 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-cyan" />
        <p>
          تتبع «المؤشرات التنفيذية» مواصفات العميل: تُعرض القيمة الكبيرة كحالة لحظية، ويقارن الاتجاه
          الفترة المحددة بالفترة المكافئة السابقة. تُضبط العتبات هنا حتى لا تكون مثبّتة في الكود.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <KpiForm
            threshold={threshold}
            overloadThreshold={overloadThreshold}
            canManage={hasPermission(session, "settings.manage")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
