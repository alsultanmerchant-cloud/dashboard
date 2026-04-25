import { Building2 } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function ClientsPage() {
  return (
    <ComingSoonPage
      title="العملاء"
      description="إدارة قاعدة العملاء وملفاتهم والمشاريع المرتبطة بكل عميل."
      icon={<Building2 className="size-6" />}
      phase={4}
      bullets={[
        "قائمة بكل العملاء مع البحث والتصفية بالحالة (نشط · محتمل · غير نشط)",
        "شاشة تفاصيل كل عميل تعرض مشاريعه ومسؤولي الحساب",
        "إنشاء عميل جديد مباشرة أو من خلال نموذج التسليم من المبيعات",
        "ربط تلقائي بسجل الأحداث الذكية والملاحظات والمراسلات",
      ]}
    />
  );
}
