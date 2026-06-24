import { Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import {
  categoryOf,
  typesForCategory,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/registry";
import { NotificationsList } from "./notifications-list";

const PAGE_SIZE = 30;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
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

  // The "money" (financial) category only applies to finance-facing roles —
  // hide it for everyone else (e.g. specialists/agents) so the tab list stays
  // relevant. Sky Light feedback.
  const canSeeMoney =
    hasPermission(session, "finance.view") || hasPermission(session, "contract.view");
  const visibleCategories = NOTIFICATION_CATEGORIES.filter(
    (c) => c !== "money" || canSeeMoney,
  );

  const activeCategory = (visibleCategories as string[]).includes(sp.category ?? "")
    ? (sp.category as NotificationCategory)
    : null;

  // Unread-per-category summary (cheap: only unread rows, capped).
  const summaryQuery = supabaseAdmin
    .from("notifications")
    .select("type")
    .eq("organization_id", session.orgId)
    .eq("recipient_user_id", session.userId)
    .is("read_at", null)
    .limit(500);

  let listQuery = supabaseAdmin
    .from("notifications")
    .select(
      "id, type, title, body, entity_type, entity_id, read_at, created_at",
      { count: "exact" },
    )
    .eq("organization_id", session.orgId)
    .eq("recipient_user_id", session.userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (activeCategory) listQuery = listQuery.in("type", typesForCategory(activeCategory));

  const [{ data, count }, { data: summaryRows }] = await Promise.all([listQuery, summaryQuery]);
  const list = data ?? [];
  const total = count ?? 0;

  // Bucket unread counts by category for the chips + header. Only the visible
  // categories are tallied so hidden ones (e.g. money for non-finance roles)
  // don't inflate the totals.
  const summary = Object.fromEntries(
    visibleCategories.map((c) => [c, 0]),
  ) as Record<NotificationCategory, number>;
  for (const r of (summaryRows ?? []) as Array<{ type: string }>) {
    const cat = categoryOf(r.type);
    if (cat in summary) summary[cat] += 1;
  }
  const totalUnread = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader title={tP("title")} description={tP("description")} />

      {total === 0 && totalUnread === 0 && !activeCategory ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={tE("notifications.title")}
          description={tE("notifications.description")}
        />
      ) : (
        <>
          <NotificationsList
            notifications={list}
            summary={summary}
            totalUnread={totalUnread}
            activeCategory={activeCategory}
            categories={visibleCategories}
          />
          <div className="mt-4">
            <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} />
          </div>
        </>
      )}
    </div>
  );
}
