import { Banknote } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function FinancePage() {
  return (
    <ComingSoonPage
      title="المالية"
      description="إدارة مالية شاملة — الفواتير والمصروفات والإيرادات."
      icon={<Banknote className="size-6" />}
      phase={9}
      bullets={[
        "إصدار الفواتير وربطها بالمشاريع",
        "متابعة المصروفات الشهرية والسنوية",
        "تقارير ربحية لكل عميل ولكل خدمة",
        "هذه الوحدة في مرحلة لاحقة من خارطة الطريق",
      ]}
    />
  );
}
