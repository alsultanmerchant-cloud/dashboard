import { Users } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function EmployeesPage() {
  return (
    <ComingSoonPage
      title="الموظفون"
      description="بيانات أعضاء فريق الوكالة، أقسامهم، وأدوارهم في النظام."
      icon={<Users className="size-6" />}
      phase={7}
      bullets={[
        "إضافة موظف جديد مع إنشاء حساب الوصول وتعيين الدور",
        "تعديل البيانات الشخصية وقسم العمل والمسمى الوظيفي",
        "تصفية بالقسم والحالة (على رأس العمل · في إجازة · …)",
        "ربط مباشر بنموذج التسليم لتعيين مدير الحساب",
      ]}
    />
  );
}
