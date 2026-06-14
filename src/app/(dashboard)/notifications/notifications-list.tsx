"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import {
  iconFor,
  categoryOf,
  notificationHref,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/registry";
import { markNotificationReadAction, markAllNotificationsReadAction } from "./_actions";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsList({
  notifications: initial,
  summary,
  totalUnread,
  activeCategory,
}: {
  notifications: Notification[];
  summary: Record<NotificationCategory, number>;
  totalUnread: number;
  activeCategory: NotificationCategory | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tL = useTranslations("NotificationsList");
  const tA = useTranslations("Actions");
  const tE = useTranslations("Empty");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pendingAll, startAll] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const list = unreadOnly ? initial.filter((n) => !n.read_at) : initial;

  function setCategory(cat: NotificationCategory | null) {
    const sp = new URLSearchParams();
    if (cat) sp.set("category", cat);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleClick(n: Notification) {
    const href = notificationHref({ type: n.type, entityType: n.entity_type, entityId: n.entity_id });
    if (!n.read_at) {
      setPendingId(n.id);
      markNotificationReadAction(n.id).then((res) => {
        setPendingId(null);
        if ("error" in res) toast.error(res.error);
        else router.refresh();
      });
    }
    if (href) router.push(href);
  }

  function handleMarkAll() {
    startAll(async () => {
      const res = await markAllNotificationsReadAction();
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(tA("markAllRead"));
        router.refresh();
      }
    });
  }

  // Group by category when viewing everything; flat list when a category is
  // already selected.
  const grouped = !activeCategory;

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {NOTIFICATION_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(activeCategory === cat ? null : cat)}
            className={cn(
              "flex items-center justify-between rounded-xl border px-3 py-2 text-start transition-colors",
              activeCategory === cat
                ? "border-cyan/40 bg-cyan-dim"
                : "border-soft bg-card/60 hover:border-soft-2",
            )}
          >
            <span className="text-xs font-medium text-foreground">{tL(`category.${cat}`)}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                summary[cat] > 0 ? "bg-cc-red/20 text-cc-red" : "text-muted-foreground/50",
              )}
            >
              {summary[cat]}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar: All chip + unread toggle + mark-all */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
        <button
          onClick={() => setCategory(null)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            !activeCategory
              ? "border-cyan/30 bg-cyan-dim text-cyan"
              : "border-soft bg-soft-1 text-muted-foreground hover:text-foreground",
          )}
        >
          {tL("filterAll")}
        </button>
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            unreadOnly
              ? "border-cyan/30 bg-cyan-dim text-cyan"
              : "border-soft bg-soft-1 text-muted-foreground hover:text-foreground",
          )}
        >
          {tL("filterUnread")}
          {totalUnread > 0 && (
            <span className="ms-1.5 rounded-full bg-cc-red/20 px-1.5 text-[10px] text-cc-red">
              {totalUnread}
            </span>
          )}
        </button>
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">
          {tL("countLabel", { count: list.length })}
        </span>
        <Button variant="outline" size="sm" disabled={pendingAll || totalUnread === 0} onClick={handleMarkAll}>
          {pendingAll ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
          {tA("markAllRead")}
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" />}
          title={tE("notifications.title")}
          description={tE("notifications.description")}
        />
      ) : grouped ? (
        <div className="space-y-5">
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const rows = list.filter((n) => categoryOf(n.type) === cat);
            if (rows.length === 0) return null;
            return (
              <div key={cat} className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tL(`category.${cat}`)}
                </p>
                {rows.map((n) => (
                  <Row key={n.id} n={n} pendingId={pendingId} onClick={handleClick} tL={tL} />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((n) => (
            <Row key={n.id} n={n} pendingId={pendingId} onClick={handleClick} tL={tL} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  n,
  pendingId,
  onClick,
  tL,
}: {
  n: Notification;
  pendingId: string | null;
  onClick: (n: Notification) => void;
  tL: ReturnType<typeof useTranslations>;
}) {
  const Icon = iconFor(n.type);
  const unread = !n.read_at;
  const href = notificationHref({ type: n.type, entityType: n.entity_type, entityId: n.entity_id });
  const isPending = pendingId === n.id;
  return (
    <Card className={cn("transition-all cursor-pointer", unread ? "border-cyan/30 bg-card" : "opacity-70")}>
      <CardContent className="p-4">
        <button type="button" onClick={() => onClick(n)} className="flex w-full items-start gap-3 text-start">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-xl shrink-0",
              unread ? "bg-cyan-dim text-cyan ring-1 ring-cyan/30" : "bg-soft-2 text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className={cn("text-sm leading-snug", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {n.title}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                {isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                {unread && <span className="size-2 rounded-full bg-cyan animate-pulse" aria-hidden />}
              </div>
            </div>
            {n.body && <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{n.body}</p>}
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{relativeTimeAr(n.created_at)}</span>
              {href && (
                <>
                  <span>·</span>
                  <Link href={href} className="text-cyan hover:underline" onClick={(e) => e.stopPropagation()}>
                    {tL("openLink")}
                  </Link>
                </>
              )}
            </div>
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
