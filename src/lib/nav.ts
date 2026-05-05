// Single source of truth for sidebar nav groups + topbar page titles.
// Phase 4-7 swap individual `comingSoon` flags off as modules ship.
//
// String values here are TRANSLATION KEYS (resolved via next-intl), not display
// text. See `messages/{ar,en}.json` for the literal copy.

import {
  Home,
  LayoutDashboard,
  CalendarClock,
  Bell,
  Sparkles,
  Bot,
  Send,
  Building2,
  Briefcase,
  ListTodo,
  ListTree,
  ClipboardList,
  Building,
  Users,
  Shield,
  Network,
  BarChart3,
  Settings,
  Flag,
  FileSignature,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  /** Translation key under the `Nav` namespace (e.g. `myDashboard`). */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  perm?: string;
  comingSoon?: boolean;
  /** When true, item appears in nav but is unauthenticated/disabled visually. */
  disabled?: boolean;
};

export type NavGroup = {
  /** Translation key under the `NavGroups` namespace (e.g. `dashboard`). */
  labelKey: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "dashboard",
    items: [
      // Routes server-side to the role's home page (specialist→/uploads,
      // AM→/am/<id>/dashboard, head/admin/owner→/dashboard, etc).
      { labelKey: "myDashboard", href: "/", icon: Home },
      { labelKey: "uploadsToday", href: "/uploads", icon: CalendarClock, perm: "tasks.view" },
      { labelKey: "overview", href: "/dashboard", icon: LayoutDashboard },
      { labelKey: "notifications", href: "/notifications", icon: Bell },
      { labelKey: "aiInsights", href: "/ai-insights", icon: Sparkles },
      { labelKey: "aiAgent", href: "/agent", icon: Bot },
    ],
  },
  {
    labelKey: "sales",
    items: [
      { labelKey: "salesHandover", href: "/handover", icon: Send, perm: "handover.create" },
    ],
  },
  {
    labelKey: "clientsProjects",
    items: [
      { labelKey: "clients", href: "/clients", icon: Building2, perm: "clients.view" },
      { labelKey: "projects", href: "/projects", icon: Briefcase, perm: "projects.view" },
      { labelKey: "tasks", href: "/tasks", icon: ListTodo, perm: "tasks.view" },
      { labelKey: "taskTemplates", href: "/task-templates", icon: ClipboardList, perm: "templates.manage" },
      { labelKey: "serviceCategories", href: "/service-categories", icon: ListTree, perm: "category.manage_templates" },
    ],
  },
  {
    labelKey: "commercial",
    items: [
      { labelKey: "contracts", href: "/contracts", icon: FileSignature, perm: "contract.view" },
    ],
  },
  {
    labelKey: "operations",
    items: [
      { labelKey: "escalations", href: "/escalations", icon: ShieldAlert, perm: "escalation.view_own" },
      { labelKey: "governance", href: "/governance", icon: Shield, perm: "governance.view" },
    ],
  },
  {
    labelKey: "organization",
    items: [
      { labelKey: "agencyChart", href: "/organization/chart", icon: Network, perm: "employees.view" },
      { labelKey: "departments", href: "/organization/departments", icon: Building, perm: "employees.view" },
      { labelKey: "employees", href: "/organization/employees", icon: Users, perm: "employees.view" },
      { labelKey: "rolesPermissions", href: "/organization/roles", icon: Shield, perm: "settings.manage" },
    ],
  },
  {
    labelKey: "administration",
    items: [
      { labelKey: "reports", href: "/reports", icon: BarChart3, perm: "reports.view" },
      { labelKey: "settings", href: "/settings", icon: Settings, perm: "settings.manage" },
      { labelKey: "featureFlags", href: "/settings/feature-flags", icon: Flag, perm: "feature_flag.manage" },
    ],
  },
];

// Flat title map used by the topbar. Values are keys under the `PageTitles`
// namespace, suffixed with `.title` / `.subtitle`.
export const PAGE_TITLE_KEYS: Record<string, { titleKey: string; subtitleKey?: string }> = {
  "/": { titleKey: "/dashboard.title", subtitleKey: "/dashboard.subtitle" },
  "/dashboard": { titleKey: "/dashboard.title", subtitleKey: "/dashboard.subtitle" },
  "/uploads": { titleKey: "/uploads.title", subtitleKey: "/uploads.subtitle" },
  "/notifications": { titleKey: "/notifications.title", subtitleKey: "/notifications.subtitle" },
  "/ai-insights": { titleKey: "/ai-insights.title", subtitleKey: "/ai-insights.subtitle" },
  "/agent": { titleKey: "/agent.title", subtitleKey: "/agent.subtitle" },
  "/handover": { titleKey: "/handover.title", subtitleKey: "/handover.subtitle" },
  "/sales/leads": { titleKey: "/sales/leads.title", subtitleKey: "/sales/leads.subtitle" },
  "/sales/team": { titleKey: "/sales/team.title", subtitleKey: "/sales/team.subtitle" },
  "/sales": { titleKey: "/sales.title", subtitleKey: "/sales.subtitle" },
  "/clients": { titleKey: "/clients.title", subtitleKey: "/clients.subtitle" },
  "/projects": { titleKey: "/projects.title", subtitleKey: "/projects.subtitle" },
  "/tasks": { titleKey: "/tasks.title", subtitleKey: "/tasks.subtitle" },
  "/task-templates": { titleKey: "/task-templates.title", subtitleKey: "/task-templates.subtitle" },
  "/service-categories": { titleKey: "/service-categories.title", subtitleKey: "/service-categories.subtitle" },
  "/contracts": { titleKey: "/contracts.title", subtitleKey: "/contracts.subtitle" },
  "/projects/new": { titleKey: "/projects/new.title", subtitleKey: "/projects/new.subtitle" },
  "/organization/chart": { titleKey: "/organization/chart.title", subtitleKey: "/organization/chart.subtitle" },
  "/organization/departments": { titleKey: "/organization/departments.title", subtitleKey: "/organization/departments.subtitle" },
  "/organization/employees": { titleKey: "/organization/employees.title", subtitleKey: "/organization/employees.subtitle" },
  "/organization/roles": { titleKey: "/organization/roles.title", subtitleKey: "/organization/roles.subtitle" },
  "/reports": { titleKey: "/reports.title", subtitleKey: "/reports.subtitle" },
  "/settings": { titleKey: "/settings.title", subtitleKey: "/settings.subtitle" },
  "/settings/feature-flags": { titleKey: "/settings/feature-flags.title", subtitleKey: "/settings/feature-flags.subtitle" },
  "/escalations": { titleKey: "/escalations.title", subtitleKey: "/escalations.subtitle" },
  "/governance": { titleKey: "/governance.title", subtitleKey: "/governance.subtitle" },
  "/hr": { titleKey: "/hr.title", subtitleKey: "/hr.subtitle" },
  "/finance": { titleKey: "/finance.title", subtitleKey: "/finance.subtitle" },
};
