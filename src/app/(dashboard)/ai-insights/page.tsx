import { Sparkles } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function AiInsightsPage() {
  return (
    <ComingSoonPage
      title="الرؤى الذكية"
      description="ملخصات وأنماط مستخرجة تلقائيًا من نشاط الفريق والأحداث الذكية."
      icon={<Sparkles className="size-6" />}
      phase={6}
      bullets={[
        "بطاقات رؤى يومية: المخاطر، التأخيرات، صحة المشاريع، نشاط الفريق",
        "اقتراحات إجراءات قابلة للتنفيذ بناءً على البيانات",
        "تحليل أنماط متكررة في تأخر التسليم أو تكرار التعليقات",
        "هذه المرحلة الأساسية تجمع الأحداث الذكية ai_events لتغذية الذكاء الاصطناعي لاحقًا",
      ]}
    />
  );
}
