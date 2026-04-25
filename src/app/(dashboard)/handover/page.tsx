import { Send } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function HandoverPage() {
  return (
    <ComingSoonPage
      title="التسليم من المبيعات"
      description="نموذج تسليم العميل من فريق المبيعات إلى مدير الحساب — مع إنشاء المشروع والمهام تلقائيًا."
      icon={<Send className="size-6" />}
      phase={5}
      bullets={[
        "نموذج موحّد لإرسال بيانات العميل والخدمات المتفق عليها",
        "إنشاء أو ربط ملف العميل تلقائيًا عند الإرسال",
        "إنشاء المشروع وربطه بالخدمات المختارة",
        "توليد المهام تلقائيًا من قوالب المهام الخاصة بكل خدمة",
        "تنبيه فوري لمدير الحساب وتسجيل حدث ذكي للمتابعة",
      ]}
    />
  );
}
