import { Info } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getSlaRules } from "@/lib/data/sla";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SlaForm } from "./sla-form";

export const dynamic = "force-dynamic";

// Editable per-stage SLA targets. These drive the "on-time rate" — 60% of the
// accountability score — so they belong to the heads, not to seeded defaults.
export default async function SlaSettingsPage() {
  const session = await requirePagePermission("settings.manage");
  const rows = await getSlaRules(session.orgId);

  return (
    <div>
      <PageHeader
        title="معايير الالتزام بالمواعيد (SLA)"
        description="الزمن المسموح لكل مرحلة قبل اعتبارها متأخرة. تُحرّك «نسبة الالتزام بالموعد» التي تمثّل ٦٠٪ من نتيجة الأداء في نبض الفريق والمساءلة."
        breadcrumbs={[
          { label: "الإعدادات", href: "/settings" },
          { label: "معايير الالتزام (SLA)" },
        ]}
      />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/5 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-cyan" />
        <p>
          القيم الحالية هي افتراضات داخلية (هجرة 0147) وليست مستندة إلى وثيقة معتمدة من العميل. تُحسب
          المدة بدقائق العمل (مع تخطّي العطل والإجازات عند تفعيل «ساعات العمل فقط»). المراحل «جديد» و«قيد
          التنفيذ» لا تملك معيارًا عامًا — تُضبط لكل مهمة من القالب. أي تعديل يُعيد احتساب بطاقات الأداء فورًا.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <SlaForm rows={rows} canManage={hasPermission(session, "settings.manage")} />
        </CardContent>
      </Card>
    </div>
  );
}
