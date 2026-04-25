import { UserSearch } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function LeadsPage() {
  return (
    <ComingSoonPage
      title="العملاء المحتملون"
      description="قائمة العملاء المحتملين قبل الإغلاق وتحويلهم إلى عملاء نشطين."
      icon={<UserSearch className="size-6" />}
      phase={9}
    />
  );
}
