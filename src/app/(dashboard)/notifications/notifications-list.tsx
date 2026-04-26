"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Inbox, Send, Briefcase, ListTodo, MessageSquare, AtSign, Bell,
  CheckCheck, Loader2, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { copy } from "@/lib/copy";
import { relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
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

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  HANDOVER_SUBMITTED: Send,
  PROJECT_CREATED: Briefcase,
  TASK_CREATED: ListTodo,
  TASK_STATUS_CHANGED: ListTodo,
  TASK_COMMENT_ADDED: MessageSquare,
  MENTION: AtSign,
  MENTION_CREATED: AtSign,
  EMPLOYEE_INVITED: Sparkles,
};

function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "project": return `/projects/${entityId}`;
    case "task": return `/tasks/${entityId}`;
    case "client": return `/clients`;
    case "handover": return `/handover`;
    case "employee": return `/organization/employees`;
    default: return null;
  }
}

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "unread", label: "غير مقروءة" },
  { key: "read", label: "مقروءة" },
] as const;

export function NotificationsList({
  notifications: initial,
}: {
  notifications: Notification[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [pendingAll, startAll] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const list = initial.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read_at;
    if (filter === "read") return !!n.read_at;
    return true;
  });
  const unreadCount = initial.filter((n) => !n.read_at).length;

  function handleClick(n: Notification) {
    const href = entityHref(n.entity_type, n.entity_id);
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
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(`تم تعليم ${res.updated} تنبيهًا كمقروء`);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-card/60 px-3 py-2.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-cyan/30 bg-cyan-dim text-cyan"
                : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {f.key === "unread" && unreadCount > 0 && (
              <span className="ms-1.5 rounded-full bg-cc-red/20 px-1.5 text-[10px] text-cc-red">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">
          {list.length} تنبيه{list.length === 1 ? "" : "ًا"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={pendingAll || unreadCount === 0}
          onClick={handleMarkAll}
        >
          {pendingAll ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
          {copy.actions.markAllRead}
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" />}
          title={copy.empty.notifications.title}
          description={copy.empty.notifications.description}
        />
      ) : (
        <div className="space-y-2">
          {list.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const unread = !n.read_at;
            const href = entityHref(n.entity_type, n.entity_id);
            const isPending = pendingId === n.id;
            return (
              <Card
                key={n.id}
                className={cn(
                  "transition-all cursor-pointer",
                  unread && "border-cyan/30 bg-card",
                  !unread && "opacity-70",
                )}
              >
                <CardContent className="p-4">
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className="flex w-full items-start gap-3 text-start"
                  >
                    <div className={cn(
                      "flex size-9 items-center justify-center rounded-xl shrink-0",
                      unread ? "bg-cyan-dim text-cyan ring-1 ring-cyan/30" : "bg-white/[0.04] text-muted-foreground",
                    )}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          "text-sm leading-snug",
                          unread ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}>
                          {n.title}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                          {unread && <span className="size-2 rounded-full bg-cyan animate-pulse" aria-hidden />}
                        </div>
                      </div>
                      {n.body && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{n.body}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{relativeTimeAr(n.created_at)}</span>
                        {href && (
                          <>
                            <span>·</span>
                            <Link href={href} className="text-cyan hover:underline" onClick={(e) => e.stopPropagation()}>
                              فتح
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
