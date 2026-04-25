// Single source of truth for sidebar nav groups + topbar page titles.
// Phase 4-7 swap individual `comingSoon` flags off as modules ship.

import {
  LayoutDashboard,
  Bell,
  Sparkles,
  Bot,
  Send,
  UserSearch,
  Megaphone,
  Building2,
  Briefcase,
  ListTodo,
  ClipboardList,
  Building,
  Users,
  Shield,
  BarChart3,
  Settings,
  Heart,
  Banknote,
  Target,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  perm?: string;
  comingSoon?: boolean;
  /** When true, item appears in nav but is unauthenticated/disabled visually. */
  disabled?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "لوحة التحكم",
    items: [
      { label: "نظرة عامة", href: "/dashboard", icon: LayoutDashboard },
      { label: "التنبيهات", href: "/notifications", icon: Bell },
      { label: "الرؤى الذكية", href: "/ai-insights", icon: Sparkles },
      { label: "المساعد الذكي", href: "/agent", icon: Bot },
    ],
  },
  {
    label: "المبيعات",
    items: [
      { label: "التسليم من المبيعات", href: "/handover", icon: Send, perm: "handover.create" },
      { label: "العملاء المحتملون", href: "/sales/leads", icon: UserSearch, comingSoon: true },
      { label: "الفريق التجاري", href: "/sales/team", icon: Megaphone, comingSoon: true },
    ],
  },
  {
    label: "العملاء والمشاريع",
    items: [
      { label: "العملاء", href: "/clients", icon: Building2, perm: "clients.view" },
      { label: "المشاريع", href: "/projects", icon: Briefcase, perm: "projects.view" },
      { label: "المهام", href: "/tasks", icon: ListTodo, perm: "tasks.view" },
      { label: "قوالب المهام", href: "/task-templates", icon: ClipboardList, perm: "templates.manage" },
    ],
  },
  {
    label: "المنظمة",
    items: [
      { label: "الأقسام", href: "/organization/departments", icon: Building, perm: "employees.view" },
      { label: "الموظفون", href: "/organization/employees", icon: Users, perm: "employees.view" },
      { label: "الأدوار والصلاحيات", href: "/organization/roles", icon: Shield, perm: "settings.manage" },
    ],
  },
  {
    label: "الإدارة",
    items: [
      { label: "التقارير", href: "/reports", icon: BarChart3, perm: "reports.view" },
      { label: "الإعدادات", href: "/settings", icon: Settings, perm: "settings.manage" },
    ],
  },
  {
    label: "مراحل لاحقة",
    items: [
      { label: "الموارد البشرية", href: "/hr", icon: Heart, comingSoon: true },
      { label: "المالية", href: "/finance", icon: Banknote, comingSoon: true },
      { label: "Sales CRM", href: "/sales", icon: Target, comingSoon: true },
    ],
  },
];

// Flat title map used by the topbar.
export const PAGE_TITLES: Record<string, { title: string; subtitle?: string }> = {
  "/dashboard": { title: "نظرة عامة", subtitle: "لوحة تنفيذية مركزة على الإشارات الأهم الآن" },
  "/notifications": { title: "التنبيهات", subtitle: "كل الإشارات والتسليمات في مكان واحد" },
  "/ai-insights": { title: "الرؤى الذكية", subtitle: "ملخصات وأنماط مستخرجة من نشاط الفريق" },
  "/agent": { title: "المساعد الذكي", subtitle: "طبقة ذكاء فوق بيانات الوكالة" },
  "/handover": { title: "التسليم من المبيعات", subtitle: "تحويل الصفقات المُغلقة إلى مشاريع وتنبيه مدير الحساب" },
  "/sales/leads": { title: "العملاء المحتملون", subtitle: "ينطلق في مرحلة لاحقة" },
  "/sales/team": { title: "الفريق التجاري", subtitle: "ينطلق في مرحلة لاحقة" },
  "/sales": { title: "Sales CRM", subtitle: "ينطلق في مرحلة لاحقة" },
  "/clients": { title: "العملاء", subtitle: "إدارة قاعدة العملاء والمشاريع المرتبطة" },
  "/projects": { title: "المشاريع", subtitle: "متابعة المشاريع والخدمات وفريق التنفيذ" },
  "/tasks": { title: "المهام", subtitle: "كل مهام الفرق مع حالات الإنجاز والأولوية" },
  "/task-templates": { title: "قوالب المهام", subtitle: "تعريف سير العمل الافتراضي لكل خدمة" },
  "/organization/departments": { title: "الأقسام", subtitle: "هيكل الوكالة وتقسيمات الفرق" },
  "/organization/employees": { title: "الموظفون", subtitle: "بيانات أعضاء الفريق" },
  "/organization/roles": { title: "الأدوار والصلاحيات", subtitle: "مصفوفة الصلاحيات لكل دور وظيفي" },
  "/reports": { title: "التقارير", subtitle: "ملخصات تنفيذية متعددة المستويات" },
  "/settings": { title: "الإعدادات", subtitle: "إعدادات النظام والوكالة" },
  "/hr": { title: "الموارد البشرية", subtitle: "ينطلق في مرحلة لاحقة" },
  "/finance": { title: "المالية", subtitle: "ينطلق في مرحلة لاحقة" },
};
