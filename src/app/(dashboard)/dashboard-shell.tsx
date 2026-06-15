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
import { NotificationPanel } from "@/components/layout/notification-panel";
import { emojiFor } from "@/lib/notifications/registry";
import { markAllNotificationsReadAction } from "@/app/(dashboard)/notifications/_actions";
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

// Global "select text → ask/teach the AI" overlay. Watches selections inside
// the main content area ([data-dashboard-root]) across every dashboard route.
const DashboardSelectionAssistant = dynamic(
  () =>
    import("@/components/executive/dashboard-selection-assistant").then((mod) => ({
      default: mod.DashboardSelectionAssistant,
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

function rowToNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: "crud_action",
    notifType: row.type,
    icon: emojiFor(row.type),
    message: row.body ? `${row.title} — ${row.body}` : row.title,
    title: row.title,
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
  reloadToken,
}: {
  onLoad: (n: AppNotification[]) => void;
  // Bumping this forces an immediate refetch (e.g. when the bell is opened).
  reloadToken: number;
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

    // Keep the bell badge fresh — poll every 60s (same cadence as DM unread).
    const poll = window.setInterval(loadNotifications, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [user?.id, user?.orgId, onLoad, reloadToken]);

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
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Upsert by id (not append-only) so a refetch reflects updated read state —
  // marking read/all-read changes read_at on rows we've already seen.
  const addNotifications = useCallback((next: AppNotification[]) => {
    setNotifications((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      for (const n of next) byId.set(n.id, n);
      return [...byId.values()].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    });
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const openBell = useCallback(() => {
    setBellOpen((o) => !o);
    setReloadToken((t) => t + 1); // refetch on open
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await markAllNotificationsReadAction();
    setReloadToken((t) => t + 1);
  }, []);

  const isAgentPage = pathname === "/agent";

  return (
    <OrgProvider>
      <AuthProvider initialUser={initialUser}>
        <TopbarProvider>
          <StackedSheetProvider>
          <CommandPaletteProvider />
          <NotificationsLoader onLoad={addNotifications} reloadToken={reloadToken} />
          <DmUnreadLoader onChange={setDmUnreadCount} />
          <div className="min-h-screen bg-background panel-grid">
            <Sidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              onDesktopExpandedChange={setDesktopSidebarExpanded}
            />

            <div
              className={`min-h-screen transition-[padding] duration-300 ease-in-out ${
                desktopSidebarExpanded
                  ? "lg:rtl:pr-[276px] lg:ltr:pl-[276px]"
                  : "lg:rtl:pr-[82px] lg:ltr:pl-[82px]"
              }`}
            >
              <Topbar
                unreadCount={unreadCount}
                dmUnreadCount={dmUnreadCount}
                onBellClick={openBell}
                onMenuClick={() => setSidebarOpen(true)}
                notificationPanel={
                  bellOpen ? (
                    <NotificationPanel
                      notifications={notifications}
                      onClose={() => setBellOpen(false)}
                      onMarkAllRead={handleMarkAllRead}
                    />
                  ) : null
                }
              />
              <ModuleTabs />
              <main className="px-4 sm:px-6 pb-12 pt-4" data-dashboard-root>
                {children}
              </main>
            </div>

            <RightRail />

            {!isAgentPage && (
              <AIChatFAB onClick={() => router.push("/agent")} />
            )}
            <DashboardSelectionAssistant />
          </div>
          </StackedSheetProvider>
        </TopbarProvider>
      </AuthProvider>
    </OrgProvider>
  );
}
