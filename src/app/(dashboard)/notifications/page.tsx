import { Bell } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function NotificationsPage() {
  return (
    <ComingSoonPage
      title="التنبيهات"
      description="كل الإشارات والتسليمات وتحديثات المهام في مكان واحد."
      icon={<Bell className="size-6" />}
      phase={3}
      bullets={[
        "قائمة كاملة بالتنبيهات مع تصفية بالنوع والحالة",
        "تعليم الكل كمقروء أو حذف مجموعة دفعة واحدة",
        "نقر التنبيه يأخذك مباشرة للكيان المرتبط (مشروع · مهمة · تسليم)",
        "تنبيهات فورية من نظام الإشارات @ ومن سير عمل التسليم",
      ]}
    />
  );
}
