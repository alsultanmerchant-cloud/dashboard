"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { TopbarProvider } from "@/components/layout/topbar-context";
import { StackedSheetProvider } from "@/components/ui/stacked-sheet";
import { ModuleTabs } from "@/components/layout/module-tabs";
import { RightRail } from "@/components/layout/right-rail";
import { AuthProvider, useAuth, type AuthInitialUser } from "@/lib/auth-context";
import { OrgProvider } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/types";

const AIChatFAB = dynamic(
  () =>
    import("@/components/ai/ai-chat-fab").then((mod) => ({
      default: mod.AIChatFAB,
    })),
);

const CommandPaletteProvider = dynamic(
  () =>
    import("@/components/command-palette").then((mod) => ({
      default: mod.CommandPaletteProvider,
    })),
);

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_ICONS: Record<string, string> = {
  HANDOVER_SUBMITTED: "📨",
  PROJECT_CREATED: "🗂️",
  TASK_CREATED: "📋",
  TASK_STATUS_CHANGED: "🔄",
  TASK_COMMENT_ADDED: "💬",
  MENTION_CREATED: "💬",
  TASK_OVERDUE_DETECTED: "⏰",
  default: "🔔",
};

function rowToNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: "crud_action",
    icon: TYPE_ICONS[row.type] ?? TYPE_ICONS.default,
    message: row.body ? `${row.title} — ${row.body}` : row.title,
    section: row.entity_type ?? "notification",
    entityType: row.entity_type,
    entityId: row.entity_id,
    timestamp: row.created_at,
    isRead: !!row.read_at,
  };
}

// Poll DM unread for the current user. Used to badge the chat icon in the
// topbar so the user knows when someone DM'd them without opening /messages.
function DmUnreadLoader({
  onChange,
}: {
  onChange: (count: number) => void;
}) {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id || !user.orgId) return;
    let cancelled = false;
    const supabase = createClient();
    const load = () => {
      void supabase
        .from("direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", user.orgId)
        .eq("recipient_user_id", user.id)
        .is("read_at", null)
        .then(({ count }) => {
          if (!cancelled) onChange(count ?? 0);
        });
    };
    load();
    // Cheap re-check every 60s — same cadence the notification panel uses
    // implicitly via realtime; DM channel events would be more responsive
    // but a poll is enough to badge the icon.
    const t = window.setInterval(load, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [user?.id, user?.orgId, onChange]);
  return null;
}

function NotificationsLoader({
  onLoad,
}: {
  onLoad: (n: AppNotification[]) => void;
}) {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id || !user.orgId) return;

    let cancelled = false;
    const supabase = createClient();
    const loadNotifications = () => {
      void supabase
        .from("notifications")
        .select("id, type, title, body, entity_type, entity_id, read_at, created_at")
        .eq("organization_id", user.orgId)
        .eq("recipient_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data }) => {
          if (cancelled || !data) return;
          onLoad((data as NotificationRow[]).map(rowToNotification));
        });
    };

    let timeoutId: number | null = null;
    let idleId: number | null = null;

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(loadNotifications, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(loadNotifications, 250);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [user?.id, user?.orgId, onLoad]);

  return null;
}

export function DashboardShell({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: AuthInitialUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);

  const addNotifications = useCallback((next: AppNotification[]) => {
    setNotifications((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      const fresh = next.filter((n) => !seen.has(n.id));
      return [...fresh, ...prev];
    });
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const isAgentPage = pathname === "/agent";

  return (
    <OrgProvider>
      <AuthProvider initialUser={initialUser}>
        <TopbarProvider>
          <StackedSheetProvider>
          <CommandPaletteProvider />
          <NotificationsLoader onLoad={addNotifications} />
          <DmUnreadLoader onChange={setDmUnreadCount} />
          <div className="min-h-screen bg-background panel-grid">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <div className="min-h-screen">
              <Topbar
                unreadCount={unreadCount}
                dmUnreadCount={dmUnreadCount}
                onBellClick={() => router.push("/notifications")}
                onMenuClick={() => setSidebarOpen(true)}
              />
              <ModuleTabs />
              <main className="px-4 sm:px-6 pb-12 pt-4">
                {children}
              </main>
            </div>

            <RightRail />

            {!isAgentPage && (
              <AIChatFAB onClick={() => router.push("/agent")} />
            )}
          </div>
          </StackedSheetProvider>
        </TopbarProvider>
      </AuthProvider>
    </OrgProvider>
  );
}
