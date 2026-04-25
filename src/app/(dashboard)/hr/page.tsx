import { Heart } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function HrPage() {
  return (
    <ComingSoonPage
      title="الموارد البشرية"
      description="إدارة شاملة للموارد البشرية — الإجازات، التقييمات، التوظيف."
      icon={<Heart className="size-6" />}
      phase={9}
      bullets={[
        "إدارة الإجازات وأرصدتها لكل موظف",
        "تقييمات الأداء الدورية",
        "إدارة الرواتب والمكافآت",
        "هذه الوحدة في مرحلة لاحقة",
      ]}
    />
  );
}
