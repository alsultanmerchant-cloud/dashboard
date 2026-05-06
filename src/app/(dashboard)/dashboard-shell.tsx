"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { TopbarProvider } from "@/components/layout/topbar-context";
import { ModuleTabs } from "@/components/layout/module-tabs";
import { NotificationPanel } from "@/components/layout/notification-panel";
import { AIChatFAB } from "@/components/ai/ai-chat-fab";
import { CommandPaletteProvider } from "@/components/command-palette";
import { AuthProvider, useAuth, type AuthInitialUser } from "@/lib/auth-context";
import { OrgProvider } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/types";

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
    timestamp: row.created_at,
    isRead: !!row.read_at,
  };
}

function NotificationsLoader({
  onLoad,
}: {
  onLoad: (n: AppNotification[]) => void;
}) {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id || !user.orgId) return;
    const supabase = createClient();
    supabase
      .from("notifications")
      .select("id, type, title, body, entity_type, entity_id, read_at, created_at")
      .eq("organization_id", user.orgId)
      .eq("recipient_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!data) return;
        onLoad((data as NotificationRow[]).map(rowToNotification));
      });
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
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

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
          <CommandPaletteProvider />
          <NotificationsLoader onLoad={addNotifications} />
          <div className="min-h-screen bg-background panel-grid">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <div className="min-h-screen">
              <Topbar
                unreadCount={unreadCount}
                onBellClick={() => setNotifOpen((p) => !p)}
                onMenuClick={() => setSidebarOpen(true)}
                notificationPanel={
                  notifOpen ? (
                    <NotificationPanel
                      notifications={notifications}
                      onClose={() => setNotifOpen(false)}
                      onMarkAllRead={() =>
                        setNotifications((prev) =>
                          prev.map((n) => ({ ...n, isRead: true })),
                        )
                      }
                      onClearAll={() => {
                        setNotifications([]);
                        setNotifOpen(false);
                      }}
                    />
                  ) : null
                }
              />
              <ModuleTabs />
              <main className="px-4 sm:px-6 pb-12 pt-4">
                {children}
              </main>
            </div>

            {!isAgentPage && (
              <AIChatFAB onClick={() => router.push("/agent")} />
            )}
          </div>
        </TopbarProvider>
      </AuthProvider>
    </OrgProvider>
  );
}
