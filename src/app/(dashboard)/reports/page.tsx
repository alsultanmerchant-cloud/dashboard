import { BarChart3 } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function ReportsPage() {
  return (
    <ComingSoonPage
      title="التقارير"
      description="ملخصات تنفيذية متعددة المستويات للإدارة."
      icon={<BarChart3 className="size-6" />}
      phase={8}
      bullets={[
        "تقارير حالة المشاريع والمهام لكل خدمة",
        "نظرة على أداء الفرق ومعدل إنجاز المهام",
        "رؤى من الأحداث الذكية: التأخيرات وأنماط المشاكل",
        "تصدير التقارير كملفات يمكن مشاركتها مع العميل",
      ]}
    />
  );
}
