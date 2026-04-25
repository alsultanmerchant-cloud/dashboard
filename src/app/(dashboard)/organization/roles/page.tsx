import { Shield } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function RolesPage() {
  return (
    <ComingSoonPage
      title="الأدوار والصلاحيات"
      description="مصفوفة الصلاحيات لكل دور وظيفي في الوكالة."
      icon={<Shield className="size-6" />}
      phase={7}
      bullets={[
        "8 أدوار افتراضية: مالك · مسؤول نظام · مدير · مبيعات · مدير حساب · متخصص · مصمم · قارئ",
        "16 صلاحية مقسّمة على وحدات النظام (عملاء · مشاريع · مهام · تسليم · إعدادات …)",
        "عرض المصفوفة كاملة وتعديل صلاحيات أدوار المنظمة",
        "تعيين أدوار متعددة للموظف الواحد عند الحاجة",
      ]}
    />
  );
}
