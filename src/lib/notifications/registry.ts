// Single source of truth for notification presentation + routing.
// Previously the type→icon and entity→href logic was duplicated across the
// topbar panel, the dashboard shell, and the /notifications page — and drifted
// (new types showed a generic bell and didn't route). Everything reads from
// here now. Client-safe (no server-only): exports lucide components.
import {
  Send,
  Briefcase,
  ListTodo,
  MessageSquare,
  AtSign,
  Bell,
  Sparkles,
  AlertTriangle,
  Link2,
  AlarmClock,
  CheckCircle2,
  Eye,
  FileClock,
  CircleDollarSign,
  Frown,
  Siren,
  type LucideIcon,
} from "lucide-react";

export type NotificationCategory =
  | "delivery"
  | "clients"
  | "money"
  | "mentions"
  | "system";

interface TypeMeta {
  category: NotificationCategory;
  emoji: string;
  icon: LucideIcon;
}

// Every notification type produced anywhere in the app (server actions + cron
// functions) should appear here. Unknown types fall back to `system` + bell.
const TYPE_META: Record<string, TypeMeta> = {
  // ---- Delivery -----------------------------------------------------------
  HANDOVER_SUBMITTED: { category: "delivery", emoji: "📨", icon: Send },
  PROJECT_CREATED: { category: "delivery", emoji: "🗂️", icon: Briefcase },
  TASK_CREATED: { category: "delivery", emoji: "📋", icon: ListTodo },
  TASK_ASSIGNED: { category: "delivery", emoji: "📋", icon: ListTodo },
  TASK_FOLLOWER: { category: "delivery", emoji: "👀", icon: Eye },
  TASK_STATUS_CHANGED: { category: "delivery", emoji: "🔄", icon: ListTodo },
  TASK_APPROVAL: { category: "delivery", emoji: "✅", icon: CheckCircle2 },
  TASK_OVERDUE: { category: "delivery", emoji: "⏰", icon: AlarmClock },
  TASK_OVERDUE_DETECTED: { category: "delivery", emoji: "⏰", icon: AlarmClock },
  TASK_ACTIVITY_DUE: { category: "delivery", emoji: "⏰", icon: AlarmClock },
  TASK_NO_DEADLINE: { category: "delivery", emoji: "🗓️", icon: ListTodo },
  AI_INSIGHT_CRITICAL: { category: "delivery", emoji: "🚨", icon: Siren },

  // ---- Clients ------------------------------------------------------------
  CLIENT_SATISFACTION_RISK: { category: "clients", emoji: "😟", icon: Frown },
  WA_PROJECT_COVERAGE: { category: "clients", emoji: "⚠️", icon: AlertTriangle },
  WA_LINK_SUGGESTIONS: { category: "clients", emoji: "🔗", icon: Link2 },

  // ---- Money --------------------------------------------------------------
  CONTRACT_RENEWAL_DUE: { category: "money", emoji: "📄", icon: FileClock },
  CONTRACT_HOLD_ENDING: { category: "money", emoji: "⏳", icon: FileClock },
  CONTRACT_HOLD_EXPIRED: { category: "money", emoji: "⌛", icon: FileClock },
  INSTALLMENT_OVERDUE: { category: "money", emoji: "💸", icon: CircleDollarSign },

  // ---- Mentions / messages ------------------------------------------------
  MENTION: { category: "mentions", emoji: "💬", icon: AtSign },
  MENTION_CREATED: { category: "mentions", emoji: "💬", icon: AtSign },
  TASK_COMMENT_ADDED: { category: "mentions", emoji: "💬", icon: MessageSquare },
  DM: { category: "mentions", emoji: "✉️", icon: MessageSquare },

  // ---- System -------------------------------------------------------------
  ESCALATION_ACKNOWLEDGED: { category: "system", emoji: "⚠️", icon: AlertTriangle },
  EMPLOYEE_INVITED: { category: "system", emoji: "✨", icon: Sparkles },
};

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "delivery",
  "clients",
  "money",
  "mentions",
  "system",
];

export function emojiFor(type: string): string {
  return TYPE_META[type]?.emoji ?? "🔔";
}

export function iconFor(type: string): LucideIcon {
  return TYPE_META[type]?.icon ?? Bell;
}

export function categoryOf(type: string): NotificationCategory {
  return TYPE_META[type]?.category ?? "system";
}

// All type strings that belong to a category — used to filter the paginated
// /notifications query server-side (category is derived, not a column).
export function typesForCategory(cat: NotificationCategory): string[] {
  return Object.entries(TYPE_META)
    .filter(([, m]) => m.category === cat)
    .map(([t]) => t);
}

// Where a notification should route on click. Type-specific overrides come
// first (analysis alerts deep-link to their analysis surface), then the
// generic entity_type routing. Section-level alerts route even with no id.
export function notificationHref(n: {
  type?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): string | null {
  const id = n.entityId ?? null;
  switch (n.type) {
    case "CLIENT_SATISFACTION_RISK":
      return id ? `/satisfaction?client=${id}` : "/satisfaction";
    case "CONTRACT_RENEWAL_DUE":
    case "INSTALLMENT_OVERDUE":
      return id ? `/contracts/${id}` : "/contracts";
    case "AI_INSIGHT_CRITICAL":
      return "/ai-insights";
  }
  if (n.entityType === "wa_group_link") return "/satisfaction/groups";
  if (!n.entityType) return null;
  switch (n.entityType) {
    case "task":
      return id ? `/tasks/${id}` : "/tasks";
    case "project":
      return id ? `/projects/${id}` : "/projects";
    case "contract":
      return id ? `/contracts/${id}` : "/contracts";
    case "client":
      return "/clients";
    case "handover":
      return "/handover";
    case "employee":
      return "/organization/employees";
    case "direct_message":
      return id ? `/messages?msg=${id}` : "/messages";
    case "ai_insight_run":
      return "/ai-insights";
    default:
      return null;
  }
}
