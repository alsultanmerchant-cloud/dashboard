"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { TopbarProvider } from "@/components/layout/topbar-context";
import { NotificationPanel } from "@/components/layout/notification-panel";
import { AIChatFAB } from "@/components/ai/ai-chat-fab";
import { AIAlertsBanner } from "@/components/ai/ai-alerts-banner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { OrgProvider } from "@/lib/org-context";
import { Skeleton } from "@/components/ui/skeleton";
import { DEMO_TICKETS, DEMO_PROJECTS, DEMO_PARTNERSHIPS } from "@/lib/demo-data";
import { fetchDeals, fetchSalesTargets, fetchSalesActivities, fetchTickets, fetchMentionNotifications, markMentionNotificationsRead } from "@/lib/supabase/db";
import type { AppNotification } from "@/types";

const PAGE_SLUG_MAP: Record<string, string> = {
  "/dashboard": "dashboard",
  "/sales": "sales",
  "/renewals": "renewals",
  "/satisfaction": "satisfaction",
  "/support": "support",
  "/development": "development",
  "/partnerships": "partnerships",
  "/team": "team",
  "/finance": "finance",
  "/upload": "upload",
  "/agent": "agent",
  "/users": "users",
  "/weekly": "weekly",
};

function MentionNotifLoader({ onLoad }: { onLoad: (n: AppNotification[]) => void }) {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.name) return;
    fetchMentionNotifications(user.name).then((mentions) => {
      const notifs: AppNotification[] = mentions
        .filter((m) => !m.is_read)
        .map((m) => ({
          id: `mention-${m.id}`,
          type: "crud_action" as const,
          icon: "💬",
          message: `${m.author_name} أشار إليك في متابعة "${m.entity_name}": ${m.note_text.slice(0, 60)}...`,
          section: m.entity_type === "deal" ? "sales" : "renewals",
          timestamp: m.created_at,
          isRead: false,
        }));
      if (notifs.length > 0) onLoad(notifs);
    }).catch(console.error);
  }, [user?.name, onLoad]);
  return null;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Redirect if user doesn't have access to current page
  useEffect(() => {
    if (!loading && user && !user.isSuperAdmin) {
      const slug = PAGE_SLUG_MAP[pathname] || pathname.split("/")[1];
      if (slug && !user.allowedPages.includes(slug)) {
        const firstAllowed = user.allowedPages[0] || "dashboard";
        router.replace(`/${firstAllowed}`);
      }
    }
  }, [loading, user, pathname, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4 w-full max-w-md px-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function generateDemoNotifications(): AppNotification[] {
  const now = new Date().toISOString();
  const notifications: AppNotification[] = [];

  // Urgent tickets (demo)
  DEMO_TICKETS.filter((t) => t.priority === "عاجل" && t.status !== "محلول").forEach((t) => {
    notifications.push({
      id: `notif-ticket-${t.id}`,
      type: "urgent_ticket",
      icon: "🚨",
      message: `تذكرة عاجلة: "${t.issue}" من ${t.client_name}`,
      section: "support",
      timestamp: now,
      isRead: false,
    });
  });

  // Overdue projects
  DEMO_PROJECTS.filter((p) => p.status_tag === "متأخر").forEach((p) => {
    notifications.push({
      id: `notif-project-${p.id}`,
      type: "overdue_project",
      icon: "⏰",
      message: `مشروع متأخر: "${p.name}" — تقدم ${p.progress}%`,
      section: "development",
      timestamp: now,
      isRead: false,
    });
  });

  // Near-complete projects (90%+)
  DEMO_PROJECTS.filter((p) => p.progress >= 85 && p.status_tag !== "متأخر").forEach((p) => {
    notifications.push({
      id: `notif-near-${p.id}`,
      type: "near_complete",
      icon: "🎯",
      message: `مشروع يقترب من الاكتمال: "${p.name}" — ${p.progress}%`,
      section: "development",
      timestamp: now,
      isRead: true,
    });
  });

  // Negotiating partnerships
  DEMO_PARTNERSHIPS.filter((p) => p.status === "قيد التفاوض").forEach((p) => {
    notifications.push({
      id: `notif-partner-${p.id}`,
      type: "negotiating",
      icon: "◇",
      message: `شراكة قيد التفاوض: ${p.name}`,
      section: "partnerships",
      timestamp: now,
      isRead: true,
    });
  });

  return notifications;
}

async function generateLiveNotifications(): Promise<AppNotification[]> {
  const now = new Date().toISOString();
  const notifications: AppNotification[] = [];

  try {
    const [deals, targets, activities, tickets] = await Promise.allSettled([
      fetchDeals(),
      fetchSalesTargets(),
      fetchSalesActivities(),
      fetchTickets(),
    ]);

    // Unsolved urgent tickets from DB
    if (tickets.status === "fulfilled") {
      tickets.value
        .filter((t) => t.priority === "عاجل" && t.status !== "محلول")
        .forEach((t) => {
          notifications.push({
            id: `live-ticket-${t.id}`,
            type: "urgent_ticket",
            icon: "🚨",
            message: `تذكرة عاجلة لم تُغلق: "${t.issue}" من ${t.client_name}`,
            section: "support",
            timestamp: now,
            isRead: false,
          });
        });

      // Open tickets older than 3 days
      tickets.value
        .filter((t) => {
          if (t.status === "محلول") return false;
          const created = new Date(t.created_at);
          const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
          return diffDays > 3;
        })
        .forEach((t) => {
          notifications.push({
            id: `live-old-ticket-${t.id}`,
            type: "urgent_ticket",
            icon: "⚠️",
            message: `تذكرة مفتوحة منذ أكثر من 3 أيام: "${t.issue}"`,
            section: "support",
            timestamp: now,
            isRead: false,
          });
        });
    }

    // Stale deals (stuck in pipeline > 14 days)
    if (deals.status === "fulfilled") {
      deals.value
        .filter((d) => {
          if (d.stage === "مكتملة" || d.stage === "مرفوض مع سبب") return false;
          return d.cycle_days > 14;
        })
        .slice(0, 5)
        .forEach((d) => {
          notifications.push({
            id: `live-stale-deal-${d.id}`,
            type: "urgent_ticket",
            icon: "⏳",
            message: `صفقة راكدة: "${d.client_name}" — ${d.cycle_days} يوم في مرحلة ${d.stage}`,
            section: "sales",
            timestamp: now,
            isRead: false,
          });
        });

      // High-value deals awaiting payment
      deals.value
        .filter((d) => d.stage === "انتظار الدفع" && d.deal_value >= 30000)
        .forEach((d) => {
          notifications.push({
            id: `live-payment-${d.id}`,
            type: "urgent_ticket",
            icon: "💰",
            message: `صفقة بانتظار الدفع: "${d.client_name}" — ${d.deal_value.toLocaleString()} ر.س`,
            section: "sales",
            timestamp: now,
            isRead: false,
          });
        });
    }

    // Unmet daily targets
    if (targets.status === "fulfilled" && activities.status === "fulfilled") {
      const todayStr = new Date().toISOString().split("T")[0];
      const todayActivities = activities.value.filter((a) => a.activity_date === todayStr);

      const dailyTargets = targets.value.filter((t) => t.period_type === "daily");
      dailyTargets.forEach((t) => {
        let actual = 0;
        if (t.target_key === "calls") {
          actual = todayActivities.filter((a) => a.activity_type === "call").length;
        } else if (t.target_key === "followups") {
          actual = todayActivities.filter((a) => a.activity_type === "followup").length;
        }
        if (actual < t.min_value && t.min_value > 0) {
          notifications.push({
            id: `live-target-${t.id}`,
            type: "urgent_ticket",
            icon: "🎯",
            message: `هدف لم يتحقق: ${t.label_ar || t.target_key} — ${actual}/${t.min_value} (الحد الأدنى)`,
            section: "sales-guide",
            timestamp: now,
            isRead: false,
          });
        }
      });
    }
  } catch {
    // Silently fail — demo notifications will still show
  }

  return notifications;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => generateDemoNotifications());

  // Load live notifications from DB
  useEffect(() => {
    generateLiveNotifications().then((live) => {
      if (live.length > 0) {
        setNotifications((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));
          const newOnes = live.filter((n) => !existingIds.has(n.id));
          return [...newOnes, ...prev];
        });
      }
    });
  }, []);

  // Expose addNotifications for child components
  const addNotifications = useCallback((newNotifs: AppNotification[]) => {
    setNotifications((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const fresh = newNotifs.filter((n) => !existingIds.has(n.id));
      return [...fresh, ...prev];
    });
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  const isAgentPage = pathname === "/agent";

  return (
    <OrgProvider>
    <AuthProvider>
    <TopbarProvider>
      <MentionNotifLoader onLoad={addNotifications} />
      <div className="min-h-screen bg-background panel-grid">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Content area — has margin on lg+ for sidebar, full-width on mobile/tablet */}
        <div className="lg:mr-[260px] min-h-screen">
          <Topbar
            unreadCount={unreadCount}
            onBellClick={() => setNotifOpen((prev) => !prev)}
            onMenuClick={() => setSidebarOpen(true)}
          />
          <main className="px-4 sm:px-6 pb-8 pt-5">
            <AuthGate>
              <AIAlertsBanner />
              {children}
            </AuthGate>
          </main>
        </div>

        {/* Notification Panel */}
        {notifOpen && (
          <NotificationPanel
            notifications={notifications}
            onClose={() => setNotifOpen(false)}
            onMarkAllRead={() =>
              setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
            }
            onClearAll={() => {
              setNotifications([]);
              setNotifOpen(false);
            }}
          />
        )}

        {/* AI Chat — hidden on agent page */}
        {!isAgentPage && (
          <AIChatFAB onClick={() => router.push("/agent")} />
        )}
      </div>
    </TopbarProvider>
    </AuthProvider>
    </OrgProvider>
  );
}
