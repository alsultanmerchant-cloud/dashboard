import { ListTodo } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function TasksPage() {
  return (
    <ComingSoonPage
      title="المهام"
      description="كل مهام الفرق مع حالات الإنجاز والأولوية والتعليقات والإشارات."
      icon={<ListTodo className="size-6" />}
      phase={4}
      bullets={[
        "قائمة موحّدة لكل مهام الوكالة مع تصفية ذكية بالحالة والأولوية والمشروع",
        "تحديث الحالة بنقرة واحدة مع سجل أحداث ذكية تلقائي",
        "تعليقات ومتابعات داخلية مع نظام إشارات @لزملاء الفريق",
        "تنبيهات تلقائية عند الاقتراب من تاريخ التسليم أو التأخر",
      ]}
    />
  );
}
