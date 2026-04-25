import { Settings } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function SettingsPage() {
  return (
    <ComingSoonPage
      title="الإعدادات"
      description="إعدادات النظام والوكالة."
      icon={<Settings className="size-6" />}
      phase={8}
      bullets={[
        "بيانات الوكالة الأساسية (الاسم · الشعار · المنطقة الزمنية)",
        "إعدادات الإشعارات الافتراضية لكل دور",
        "تكامل البريد الإلكتروني والواتساب لاحقًا",
        "إعدادات الذكاء الاصطناعي والنماذج المستخدمة",
      ]}
    />
  );
}
