import { Inbox } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { copy } from "@/lib/copy";
import { NotificationsList } from "./notifications-list";

export default async function NotificationsPage() {
  const session = await requireSession();
  const { data } = await supabaseAdmin
    .from("notifications")
    .select("id, type, title, body, entity_type, entity_id, read_at, created_at")
    .eq("organization_id", session.orgId)
    .eq("recipient_user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(200);
  const list = data ?? [];

  return (
    <div>
      <PageHeader
        title="التنبيهات"
        description="كل الإشارات والتسليمات وتحديثات المهام في مكان واحد. اضغط على أي تنبيه لفتحه ووسمه كمقروء."
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={copy.empty.notifications.title}
          description={copy.empty.notifications.description}
        />
      ) : (
        <NotificationsList notifications={list} />
      )}
    </div>
  );
}
