// Single source of truth for sidebar nav groups + topbar page titles.
// Phase 4-7 swap individual `comingSoon` flags off as modules ship.
//
// String values here are TRANSLATION KEYS (resolved via next-intl), not display
// text. See `messages/{ar,en}.json` for the literal copy.

import {
  LayoutDashboard,
  Bell,
  Sparkles,
  BrainCircuit,
  Handshake,
  Building2,
  FolderKanban,
  CheckSquare2,
  Tags,
  FileText,
  Building,
  UsersRound,
  Network,
  CalendarCheck,
  BarChart3,
  Settings2,
  Flag,
  FileSignature,
  Upload,
  Heart,
  KeyRound,
  MessageCircle,
  Activity,
  ClipboardCheck,
  Gauge,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  /** Translation key under the `Nav` namespace (e.g. `myDashboard`). */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  perm?: string;
  /** Owner-only item — hidden for every non-owner regardless of permissions. */
  ownerOnly?: boolean;
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
    labelKey: "aiWorkspace",
    items: [
      // Routes server-side to the role's home page (specialist→/uploads,
      // AM→/am/<id>/dashboard, head/admin/owner→/dashboard, etc).
      // The AI Copilot (/agent) is owner-only — the API rejects non-owners.
      { labelKey: "aiAgent", href: "/agent", icon: BrainCircuit, ownerOnly: true },
      { labelKey: "aiInsights", href: "/ai-insights", icon: Sparkles, perm: "reports.view" },
      { labelKey: "myDashboard", href: "/dashboard", icon: LayoutDashboard },
      { labelKey: "messages", href: "/messages", icon: MessageCircle, perm: "notifications.view" },
      { labelKey: "notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    labelKey: "projectDelivery",
    items: [
      { labelKey: "projects", href: "/projects", icon: FolderKanban, perm: "projects.view" },
      { labelKey: "tasks", href: "/tasks", icon: CheckSquare2, perm: "tasks.view" },
      // Sky Light feedback #15/#17: their Odoo disables the calendar entirely
      // and adds a "To-do" surface. Our analog is /my-activities — a personal
      // calendar of mail.activity-style reminders (`task_activities`) the user
      // owns. Each employee sees their own.
      { labelKey: "myActivities", href: "/my-activities", icon: CalendarCheck, perm: "tasks.view" },
      { labelKey: "uploadsToday", href: "/uploads", icon: Upload, perm: "tasks.view" },
      { labelKey: "clients", href: "/clients", icon: Building2, perm: "clients.view" },
      { labelKey: "taskTemplates", href: "/task-templates", icon: FileText, perm: "templates.manage" },
      { labelKey: "serviceCategories", href: "/service-categories", icon: Tags, perm: "category.manage_templates" },
    ],
  },
  {
    labelKey: "commercialOps",
    items: [
      { labelKey: "salesHandover", href: "/handover", icon: Handshake, perm: "handover.create" },
      { labelKey: "contracts", href: "/contracts", icon: FileSignature, perm: "contract.view" },
    ],
  },
  {
    labelKey: "agencyOps",
    items: [
      // Escalations + Governance hidden 2026-07-02 per request.
      // { labelKey: "escalations", href: "/escalations", icon: Siren, perm: "escalation.view_own" },
      // { labelKey: "governance", href: "/governance", icon: Scale, perm: "governance.view" },
      { labelKey: "teamActivity", href: "/team-activity", icon: Activity, perm: "reports.view" },
      { labelKey: "accountability", href: "/accountability", icon: ClipboardCheck, perm: "people.analytics.view" },
      // Attendance + Warnings hidden 2026-07-02: neither feature has ever
      // been used (zero attendance records, zero warnings issued), so the
      // pages are permanently empty. Restore once the team actually adopts
      // them, or once there's real data to show.
      // { labelKey: "attendance", href: "/attendance", icon: CalendarCheck, perm: "attendance.view" },
      // { labelKey: "warnings", href: "/warnings", icon: ShieldAlert, perm: "warning.view" },
      // Targets (الأهداف الشهرية) hidden 2026-06-17 per client: numbers are
      // unreliable and everything it shows already lives — correctly — under
      // العقود. Restore this line once the targets figures are reconciled.
      // { labelKey: "targets", href: "/targets", icon: Target, perm: "target.view" },
      { labelKey: "satisfaction", href: "/satisfaction", icon: Heart, perm: "clients.view" },
      { labelKey: "reports", href: "/reports", icon: BarChart3, perm: "reports.view" },
    ],
  },
  {
    labelKey: "organization",
    items: [
      { labelKey: "agencyChart", href: "/organization/chart", icon: Network, perm: "employees.view" },
      { labelKey: "departments", href: "/organization/departments", icon: Building, perm: "employees.view" },
      { labelKey: "employees", href: "/organization/employees", icon: UsersRound, perm: "employees.view" },
      { labelKey: "rolesPermissions", href: "/organization/roles", icon: KeyRound, perm: "settings.manage" },
    ],
  },
  {
    labelKey: "administration",
    items: [
      { labelKey: "settings", href: "/settings", icon: Settings2, perm: "settings.manage" },
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
  "/my-activities": { titleKey: "myActivitiesTitle", subtitleKey: "myActivitiesSubtitle" },
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
  "/team-activity": { titleKey: "teamActivityTitle", subtitleKey: "teamActivitySubtitle" },
  "/accountability": { titleKey: "accountabilityTitle", subtitleKey: "accountabilitySubtitle" },
  "/attendance": { titleKey: "attendanceTitle", subtitleKey: "attendanceSubtitle" },
  "/warnings": { titleKey: "warningsTitle", subtitleKey: "warningsSubtitle" },
  "/targets": { titleKey: "targetsTitle", subtitleKey: "targetsSubtitle" },
  "/governance": { titleKey: "governanceTitle", subtitleKey: "governanceSubtitle" },
  "/satisfaction": { titleKey: "satisfactionTitle", subtitleKey: "satisfactionSubtitle" },
  "/hr": { titleKey: "hrTitle", subtitleKey: "hrSubtitle" },
  "/finance": { titleKey: "financeTitle", subtitleKey: "financeSubtitle" },
};
