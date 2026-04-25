import { Target } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function SalesCrmPage() {
  return (
    <ComingSoonPage
      title="Sales CRM"
      description="نظام إدارة علاقات العملاء التجارية الكامل."
      icon={<Target className="size-6" />}
      phase={9}
      bullets={[
        "خط أنابيب صفقات كامل بمراحله",
        "متابعة العملاء المحتملين ومسارات التحويل",
        "تكامل مع نموذج التسليم للانتقال السلس إلى التشغيل",
        "هذه الوحدة في مرحلة لاحقة من خارطة الطريق",
      ]}
    />
  );
}
