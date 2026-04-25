import { Megaphone } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function SalesTeamPage() {
  return (
    <ComingSoonPage
      title="الفريق التجاري"
      description="أداء فريق المبيعات والتيلي سيلز."
      icon={<Megaphone className="size-6" />}
      phase={9}
    />
  );
}
