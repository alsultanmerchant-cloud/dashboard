import { Briefcase } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function ProjectsPage() {
  return (
    <ComingSoonPage
      title="المشاريع"
      description="متابعة كل مشاريع الوكالة، الخدمات المقدمة، فريق التنفيذ، والمهام المرتبطة."
      icon={<Briefcase className="size-6" />}
      phase={4}
      bullets={[
        "قائمة المشاريع مع حالة كل مشروع وتاريخ البدء والتسليم",
        "شاشة تفاصيل تعرض الخدمات المتفق عليها وأعضاء الفريق",
        "ملخص حالة المهام لكل مشروع (مكتملة · قيد التنفيذ · متأخرة)",
        "تنبيهات للمدير عند تأخر مرحلة أو اكتمال خدمة",
      ]}
    />
  );
}
