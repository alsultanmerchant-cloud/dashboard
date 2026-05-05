import { Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { NotificationsList } from "./notifications-list";

const PAGE_SIZE = 30;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePagePermission("notifications.view");
  const [sp, tP, tE] = await Promise.all([
    searchParams,
    getTranslations("NotificationsPage"),
    getTranslations("Empty"),
  ]);
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count } = await supabaseAdmin
    .from("notifications")
    .select(
      "id, type, title, body, entity_type, entity_id, read_at, created_at",
      { count: "exact" },
    )
    .eq("organization_id", session.orgId)
    .eq("recipient_user_id", session.userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  const list = data ?? [];
  const total = count ?? 0;

  return (
    <div>
      <PageHeader
        title={tP("title")}
        description={tP("description")}
      />

      {total === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={tE("notifications.title")}
          description={tE("notifications.description")}
        />
      ) : (
        <>
          <NotificationsList notifications={list} />
          <div className="mt-4">
            <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} />
          </div>
        </>
      )}
    </div>
  );
}
