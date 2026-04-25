import { ClipboardList } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function TaskTemplatesPage() {
  return (
    <ComingSoonPage
      title="قوالب المهام"
      description="تعريف سير العمل الافتراضي لكل خدمة (سوشيال ميديا · SEO · إعلانات)."
      icon={<ClipboardList className="size-6" />}
      phase={4}
      bullets={[
        "قوالب جاهزة لكل خدمة من خدمات الوكالة الأساسية",
        "تحرير عناصر القالب مع تحديد القسم المسؤول والمدة الافتراضية",
        "تطبيق تلقائي للقالب على المشاريع الجديدة لإنشاء المهام",
        "تحديث القوالب يحدّث آلية إنشاء المهام للمشاريع المستقبلية",
      ]}
    />
  );
}
