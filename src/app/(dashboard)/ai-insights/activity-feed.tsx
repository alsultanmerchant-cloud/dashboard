"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Sparkles, AlertTriangle, Activity, Inbox, ListTodo, MessageSquare,
  AtSign, Bell, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_EVENT_LABELS } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { loadMoreActivity, type ActivityRow } from "./_actions";

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  HANDOVER_SUBMITTED: Inbox,
  PROJECT_CREATED: Sparkles,
  PROJECT_SERVICE_ATTACHED: TrendingUp,
  TASK_CREATED: ListTodo,
  TASK_STATUS_CHANGED: Activity,
  TASK_COMMENT_ADDED: MessageSquare,
  MENTION_CREATED: AtSign,
  NOTIFICATION_CREATED: Bell,
  TASK_OVERDUE_DETECTED: AlertTriangle,
  CLIENT_CREATED: Sparkles,
};

export function InfiniteActivityFeed({
  initialItems,
  initialNextCursor,
}: {
  initialItems: ActivityRow[];
  initialNextCursor: string | null;
}) {
  const [items, setItems] = useState<ActivityRow[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cursor) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isPending) return;
        startTransition(async () => {
          const page = await loadMoreActivity(cursor);
          setItems((prev) => [...prev, ...page.items]);
          setCursor(page.nextCursor);
        });
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, isPending]);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <p className="py-6 text-center text-sm text-muted-foreground">لا يوجد نشاط بعد</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-white/[0.04]">
            {items.map((a) => {
              const Icon = EVENT_ICONS[a.event_type] ?? Sparkles;
              const label = AI_EVENT_LABELS[a.event_type] ?? a.event_type;
              const isHigh = a.importance === "high" || a.importance === "critical";
              return (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={cn(
                    "flex size-8 items-center justify-center rounded-lg shrink-0",
                    isHigh ? "bg-cc-red/15 text-cc-red" : "bg-cyan-dim text-cyan",
                  )}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.entity_type ?? "—"} · {a.importance ?? "—"}
                    </p>
                  </div>
                  <span
                    className="text-[11px] text-muted-foreground tabular-nums shrink-0"
                    dir="ltr"
                  >
                    {new Date(a.created_at).toLocaleTimeString("ar-SA-u-nu-latn", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {cursor && (
        <div
          ref={sentinelRef}
          className="mt-4 flex items-center justify-center py-4 text-xs text-muted-foreground"
        >
          {isPending ? "جاري التحميل..." : "مرّر للأسفل لتحميل المزيد"}
        </div>
      )}
    </>
  );
}
