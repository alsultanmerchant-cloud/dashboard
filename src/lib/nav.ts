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

// Flat title map used by the topbar. Values are flat keys under the
// `PageTitles` namespace; avoid route-like translation keys because
// production builds can surface them literally when lookups miss.
export const PAGE_TITLE_KEYS: Record<string, { titleKey: string; subtitleKey?: string }> = {
  "/": { titleKey: "dashboardTitle", subtitleKey: "dashboardSubtitle" },
  "/dashboard": { titleKey: "dashboardTitle", subtitleKey: "dashboardSubtitle" },
  "/uploads": { titleKey: "uploadsTitle", subtitleKey: "uploadsSubtitle" },
  "/notifications": { titleKey: "notificationsTitle", subtitleKey: "notificationsSubtitle" },
  "/ai-insights": { titleKey: "aiInsightsTitle", subtitleKey: "aiInsightsSubtitle" },
  "/agent": { titleKey: "agentTitle", subtitleKey: "agentSubtitle" },
  "/handover": { titleKey: "handoverTitle", subtitleKey: "handoverSubtitle" },
  "/sales/leads": { titleKey: "salesLeadsTitle", subtitleKey: "salesLeadsSubtitle" },
  "/sales/team": { titleKey: "salesTeamTitle", subtitleKey: "salesTeamSubtitle" },
  "/sales": { titleKey: "salesTitle", subtitleKey: "salesSubtitle" },
  "/clients": { titleKey: "clientsTitle", subtitleKey: "clientsSubtitle" },
  "/projects": { titleKey: "projectsTitle", subtitleKey: "projectsSubtitle" },
  "/tasks": { titleKey: "tasksTitle", subtitleKey: "tasksSubtitle" },
  "/task-templates": { titleKey: "taskTemplatesTitle", subtitleKey: "taskTemplatesSubtitle" },
  "/service-categories": { titleKey: "serviceCategoriesTitle", subtitleKey: "serviceCategoriesSubtitle" },
  "/contracts": { titleKey: "contractsTitle", subtitleKey: "contractsSubtitle" },
  "/projects/new": { titleKey: "projectsNewTitle", subtitleKey: "projectsNewSubtitle" },
  "/organization/chart": { titleKey: "organizationChartTitle", subtitleKey: "organizationChartSubtitle" },
  "/organization/departments": { titleKey: "organizationDepartmentsTitle", subtitleKey: "organizationDepartmentsSubtitle" },
  "/organization/employees": { titleKey: "organizationEmployeesTitle", subtitleKey: "organizationEmployeesSubtitle" },
  "/organization/roles": { titleKey: "organizationRolesTitle", subtitleKey: "organizationRolesSubtitle" },
  "/reports": { titleKey: "reportsTitle", subtitleKey: "reportsSubtitle" },
  "/settings": { titleKey: "settingsTitle", subtitleKey: "settingsSubtitle" },
  "/settings/feature-flags": { titleKey: "featureFlagsTitle", subtitleKey: "featureFlagsSubtitle" },
  "/escalations": { titleKey: "escalationsTitle", subtitleKey: "escalationsSubtitle" },
  "/governance": { titleKey: "governanceTitle", subtitleKey: "governanceSubtitle" },
  "/hr": { titleKey: "hrTitle", subtitleKey: "hrSubtitle" },
  "/finance": { titleKey: "financeTitle", subtitleKey: "financeSubtitle" },
};
