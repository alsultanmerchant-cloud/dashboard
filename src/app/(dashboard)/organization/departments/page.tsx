import { Building } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function DepartmentsPage() {
  return (
    <ComingSoonPage
      title="الأقسام"
      description="هيكل الوكالة وتقسيمات الفرق (مبيعات · حسابات · سوشيال · SEO · ميديا · تصميم …)."
      icon={<Building className="size-6" />}
      phase={7}
      bullets={[
        "إنشاء الأقسام وتعيين رئيس قسم لكل قسم",
        "هيكل هرمي يدعم الأقسام الفرعية إذا احتجناها لاحقًا",
        "ربط الموظفين والقوالب بالأقسام لأتمتة التوزيع",
      ]}
    />
  );
}
