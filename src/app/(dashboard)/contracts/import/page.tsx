import { FileSpreadsheet } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ImportForm } from "./import-form";

export default async function ImportContractsPage() {
  await requirePagePermission("contract.manage");

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="استيراد ملف العقود"
        description="ارفع ملف Acc SHEET الحالي وستُنقل البيانات إلى لوحة التحكم تلقائياً."
        breadcrumbs={[
          { label: "العقود", href: "/contracts" },
          { label: "استيراد" },
        ]}
      />

      <Card className="border-cyan/20 bg-cyan-dim/10">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="size-5 text-cyan shrink-0 mt-0.5" />
            <div className="text-xs text-foreground/90 leading-relaxed space-y-1.5">
              <p>
                <strong>كيف يعمل:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                <li>ارفع ملف Excel بصيغة .xlsx (نفس الملف الحالي)</li>
                <li>راجع المعاينة — ستظهر أعداد العملاء والعقود والدفعات</li>
                <li>اضغط &quot;حفظ&quot; — ستظهر البيانات في لوحات المالية والعقود فوراً</li>
              </ol>
              <p className="text-[11px] mt-2">
                النظام يستخدم عمود <code>Key</code> (مثل <code>C83|20250906</code>) لتمييز العقود.
                إعادة الاستيراد <strong>آمنة</strong> — تُحدّث القيم ولا تُكرّر الصفوف.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ImportForm />
    </div>
  );
}
