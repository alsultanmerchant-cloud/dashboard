import { Suspense } from "react";
import {
  Briefcase,
  ListTodo,
  AlertTriangle,
  CheckCircle2,
  CalendarX2,
  RefreshCcw,
  ArrowUpLeft,
  UserRound,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { requirePagePermission, getDashboardScope, hasPermission } from "@/lib/auth-server";
import { PullFromRwasemButton } from "@/components/rwasem/pull-from-rwasem-button";
import { getAgentProjectScopeIds } from "@/lib/data/viewer-scope";
import {
  getProjectSmartBadgeData,
  getProjectTotals,
  listProjectsPaged,
} from "@/lib/data/projects";
import { getProjectsAtRiskIds } from "@/lib/data/executive-indicators";
import { ProjectsOverviewBadgesSkeleton } from "@/components/skeletons";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProjectsList } from "./projects-list";
import { decodeProjectFacets } from "./_facets";
import {
  URL_PARAM as CF_URL_PARAM,
  encodeFilterToUrl,
  decodeFilterFromUrl,
} from "@/lib/custom-filter/url-state";
import type { FilterTree } from "@/lib/custom-filter/types";
import type { ProjectSearchFacet } from "@/lib/data/projects";

const PAGE_SIZE = 25;

function toEnabled(value: string | string[] | undefined) {
  return value === "1" || value === "true";
}

// Odoo opens the project view with a "With Active Categories" facet applied.
// Mirror that: the filter is on unless the URL explicitly carries `=0`.
function toEnabledDefaultOn(value: string | string[] | undefined) {
  return value !== "0" && value !== "false";
}

function toPositiveInt(value: string | string[] | undefined): number | undefined {
  const n = parseInt(typeof value === "string" ? value : "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toStr(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function buildOverviewHref(
  sp: Record<string, string | string[] | undefined>,
  preset?: {
    bool?: Record<string, boolean>;
    customFilter?: FilterTree | null;
    searchFacets?: ProjectSearchFacet[];
  },
) {
  const next = new URLSearchParams();
  const view = toStr(sp.view);
  const groupBy = toStr(sp.groupBy);
  if (view) next.set("view", view);
  if (groupBy) next.set("groupBy", groupBy);

  for (const [key, value] of Object.entries(preset?.bool ?? {})) {
    if (value) next.set(key, "1");
  }

  if (preset?.customFilter) {
    next.set(CF_URL_PARAM, encodeFilterToUrl(preset.customFilter));
  }
  if (preset?.searchFacets && preset.searchFacets.length > 0) {
    next.set("sf", JSON.stringify(preset.searchFacets));
  }

  const query = next.toString();
  return query ? `/projects?${query}` : "/projects";
}

type SmartBadge = {
  label: string;
  value: number;
  hint: string;
  href: string;
  icon: React.ReactNode;
  badgeClass?: string;
  iconClass: string;
  valueClass?: string;
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, session] = await Promise.all([
    searchParams,
    requirePagePermission("projects.view"),
  ]);
  const customFilter = decodeFilterFromUrl(
    typeof sp[CF_URL_PARAM] === "string" ? (sp[CF_URL_PARAM] as string) : null,
  );
  const searchFacets = decodeProjectFacets(
    typeof sp.sf === "string" ? sp.sf : null,
  );
  // Agent migration scope: agents only see projects they're assigned in or
  // follow; managers/heads/owner see all.
  const scope = await getDashboardScope(session);
  const restrictToProjectIds =
    scope.kind === "agent"
      ? await getAgentProjectScopeIds(session.orgId, session.employeeId, session.userId)
      : null;
  const { rows: projects, total } = await listProjectsPaged({
    organizationId: session.orgId,
    restrictToProjectIds,
    page: 1,
    pageSize: PAGE_SIZE,
    includeTotals: false,
    search: typeof sp.q === "string" ? sp.q : "",
    onlyWithCategories: toEnabledDefaultOn(sp.onlyWithCategories),
    onlyFavorites: toEnabled(sp.onlyFavorites),
    onlyWithManager: toEnabled(sp.onlyWithManager),
    onlyMine: toEnabled(sp.onlyMine),
    onlyUnassigned: toEnabled(sp.onlyUnassigned),
    archived: toEnabled(sp.archived),
    allCategoriesArchived: toEnabled(sp.allCategoriesArchived),
    overTimesheets: toEnabled(sp.overTimesheets),
    onlyWithOverdue: toEnabled(sp.atRisk),
    overdueThreshold: toPositiveInt(sp.min),
    startDateFrom: toStr(sp.startDateFrom),
    startDateTo: toStr(sp.startDateTo),
    endDateFrom: toStr(sp.endDateFrom),
    endDateTo: toStr(sp.endDateTo),
    currentEmployeeId: session.employeeId,
    customFilter,
    searchFacets,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="كل مشاريع الوكالة، العملاء، فريق التنفيذ، وعدد المهام."
        actions={
          hasPermission(session, "projects.manage") ? (
            <PullFromRwasemButton kind="projects" />
          ) : undefined
        }
      />

      {/* Analytics overview — org-wide KPIs, hidden for agents (view-only,
          scoped to their own projects). */}
      {total > 0 && scope.kind !== "agent" ? (
        <Suspense fallback={<ProjectsOverviewBadgesSkeleton />}>
          <ProjectsOverviewBadges total={total} orgId={session.orgId} searchParams={sp} />
        </Suspense>
      ) : null}

      {total === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-6" />}
          title="لا توجد مشاريع"
          description="لا توجد مشاريع نشطة حالياً."
        />
      ) : (
        <ProjectsList
          key={JSON.stringify({
            q: typeof sp.q === "string" ? sp.q : "",
            onlyWithCategories: toEnabledDefaultOn(sp.onlyWithCategories),
            onlyFavorites: toEnabled(sp.onlyFavorites),
            onlyWithManager: toEnabled(sp.onlyWithManager),
            onlyMine: toEnabled(sp.onlyMine),
            onlyUnassigned: toEnabled(sp.onlyUnassigned),
            archived: toEnabled(sp.archived),
            allCategoriesArchived: toEnabled(sp.allCategoriesArchived),
            overTimesheets: toEnabled(sp.overTimesheets),
            atRisk: toEnabled(sp.atRisk),
            min: toStr(sp.min),
            startDateFrom: toStr(sp.startDateFrom),
            startDateTo: toStr(sp.startDateTo),
            endDateFrom: toStr(sp.endDateFrom),
            endDateTo: toStr(sp.endDateTo),
            groupBy: toStr(sp.groupBy),
            cf: typeof sp[CF_URL_PARAM] === "string" ? (sp[CF_URL_PARAM] as string) : "",
            sf: typeof sp.sf === "string" ? sp.sf : "",
          })}
          initial={projects}
          initialTotal={total}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}

async function ProjectsOverviewBadges({
  total,
  orgId,
  searchParams,
}: {
  total: number;
  orgId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [totals, smartData, atRiskIds] = await Promise.all([
    getProjectTotals(orgId),
    getProjectSmartBadgeData(orgId),
    getProjectsAtRiskIds(orgId, 1),
  ]);
  const avgTasksPerProject = totals.projects
    ? Math.round(totals.tasks / totals.projects)
    : 0;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

  const totalProjectsHref = buildOverviewHref(searchParams);
  const needsDeadlineHref = buildOverviewHref(searchParams, {
    customFilter: {
      type: "group",
      connector: "and",
      children: [{ type: "rule", field: "end_date", op: "not_set", value: null }],
    },
  });
  const renewalsThisMonthHref = buildOverviewHref(searchParams, {
    customFilter: {
      type: "group",
      connector: "and",
      children: [
        {
          type: "rule",
          field: "next_renewal_date",
          op: "between",
          value: [firstOfMonth, lastOfMonth],
        },
      ],
    },
  });
  const activeProjectsHref = buildOverviewHref(searchParams);

  const overviewBadges: SmartBadge[] = [
    {
      label: "النتيجة الحالية",
      value: total,
      hint: "حسب الفلاتر الحالية",
      href: activeProjectsHref,
      icon: <Briefcase className="size-4" />,
      badgeClass: "border-primary/20 ring-1 ring-primary/10",
      iconClass: "border-primary/20 bg-primary/10 text-primary",
      valueClass: "text-primary",
    },
    {
      label: "مشاريع متأخرة",
      value: atRiskIds.length,
      hint: "بها مهمة متأخرة واحدة على الأقل",
      href: buildOverviewHref(searchParams, { bool: { atRisk: true } }),
      icon: <AlertTriangle className="size-4" />,
      iconClass: "border-cc-red/18 bg-red-dim text-cc-red",
    },
    {
      label: "كل المشاريع",
      value: totals.projects,
      hint: "المشاريع النشطة",
      href: totalProjectsHref,
      icon: <Briefcase className="size-4" />,
      iconClass: "border-border bg-muted text-foreground",
    },
    {
      label: "إجمالي المهام",
      value: totals.tasks,
      hint: "مرتبطة بالمشاريع",
      href: "/tasks",
      icon: <ListTodo className="size-4" />,
      iconClass: "border-cc-blue/20 bg-blue-dim text-cc-blue",
    },
    {
      label: "بدون ديدلاين",
      value: totals.openTasksNoDeadline,
      hint: "مهام مفتوحة",
      href: "/tasks?f=no_deadline",
      icon: <AlertTriangle className="size-4" />,
      iconClass: "border-amber/25 bg-amber-dim text-[#9a6700] dark:text-amber",
    },
    {
      label: "تحتاج موعد انتهاء",
      value: totals.needsDeadline,
      hint: "مشاريع بدون end date",
      href: needsDeadlineHref,
      icon: <CalendarX2 className="size-4" />,
      iconClass: "border-cc-red/18 bg-red-dim text-cc-red",
    },
    {
      label: "تجديدات هذا الشهر",
      value: totals.renewalsThisMonth,
      hint: "حسب next_renewal_date",
      href: renewalsThisMonthHref,
      icon: <RefreshCcw className="size-4" />,
      iconClass: "border-cyan/20 bg-cyan-dim text-cyan",
    },
    {
      label: "متوسط المهام",
      value: avgTasksPerProject,
      hint: "لكل مشروع",
      href: totalProjectsHref,
      icon: <CheckCircle2 className="size-4" />,
      iconClass: "border-cc-green/20 bg-green-dim text-cc-green",
    },
  ];

  const managerBadges: SmartBadge[] = smartData.topAccountManagers.map((manager) => ({
    label: manager.name,
    value: manager.openTasks,
    hint: `${manager.projects} مشروع مع مهام مفتوحة`,
    href: buildOverviewHref(searchParams, {
      customFilter: {
        type: "group",
        connector: "and",
        children: [
          {
            type: "rule",
            field: "account_manager_employee_id",
            op: "=",
            value: manager.id,
          },
        ],
      },
    }),
    icon: <UserRound className="size-4" />,
    badgeClass: "border-primary/18",
    iconClass: "border-primary/18 bg-accent text-primary",
  }));

  const tagBadges: SmartBadge[] = smartData.topTags.map((tag) => ({
    label: tag.name,
    value: tag.projects,
    hint: "مشاريع تحمل هذا الوسم",
    href: buildOverviewHref(searchParams, {
      searchFacets: [{ field: "tags", value: tag.name }],
    }),
    icon: <Tags className="size-4" />,
    iconClass: "border-border bg-muted text-foreground",
  }));

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">ملخص سريع</h3>
          <p className="text-xs text-muted-foreground">
            أهم الأرقام كفلاتر جاهزة. كل عنصر يفتح نفس القائمة مع التصفية المناسبة.
          </p>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">
          عرض مختصر بدلاً من بطاقات KPIs الكبيرة
        </span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {[...overviewBadges, ...managerBadges, ...tagBadges].map((badge) => (
          <Link
            key={`${badge.label}-${badge.hint}`}
            href={badge.href}
            className={`group inline-flex min-h-14 min-w-[170px] items-center gap-3 rounded-full border border-border bg-card/95 px-3.5 py-2.5 text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:bg-card hover:shadow-[var(--surface-elev)] ${badge.badgeClass ?? ""}`}
          >
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${badge.iconClass}`}>
              {badge.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-foreground">
                {badge.label}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {badge.hint}
              </span>
            </span>
            <span
              data-badge-value
              className={`text-base font-bold tabular-nums leading-none text-foreground ${badge.valueClass ?? ""}`}
              dir="ltr"
            >
              {badge.value}
            </span>
            <ArrowUpLeft className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </div>
    </section>
  );
}
