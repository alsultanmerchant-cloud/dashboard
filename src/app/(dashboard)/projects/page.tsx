import { Suspense } from "react";
import {
  Briefcase,
  ListTodo,
  AlertTriangle,
  CheckCircle2,
  CalendarX2,
  RefreshCcw,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getProjectTotals, listProjectsPaged } from "@/lib/data/projects";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { ProjectsList } from "./projects-list";
import {
  URL_PARAM as CF_URL_PARAM,
  encodeFilterToUrl,
  decodeFilterFromUrl,
} from "@/lib/custom-filter/url-state";
import type { FilterTree } from "@/lib/custom-filter/types";

const PAGE_SIZE = 25;

function toEnabled(value: string | string[] | undefined) {
  return value === "1" || value === "true";
}

// Odoo opens the project view with a "With Active Categories" facet applied.
// Mirror that: the filter is on unless the URL explicitly carries `=0`.
function toEnabledDefaultOn(value: string | string[] | undefined) {
  return value !== "0" && value !== "false";
}

function toStr(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function buildOverviewHref(
  sp: Record<string, string | string[] | undefined>,
  preset?: {
    bool?: Record<string, boolean>;
    customFilter?: FilterTree | null;
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

  const query = next.toString();
  return query ? `/projects?${query}` : "/projects";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requirePagePermission("projects.view");
  const customFilter = decodeFilterFromUrl(
    typeof sp[CF_URL_PARAM] === "string" ? (sp[CF_URL_PARAM] as string) : null,
  );
  const { rows: projects, total } = await listProjectsPaged({
    organizationId: session.orgId,
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
    startDateFrom: toStr(sp.startDateFrom),
    startDateTo: toStr(sp.startDateTo),
    endDateFrom: toStr(sp.endDateFrom),
    endDateTo: toStr(sp.endDateTo),
    currentEmployeeId: session.employeeId,
    customFilter,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="كل مشاريع الوكالة، العملاء، فريق التنفيذ، وعدد المهام."
      />

      {/* Analytics overview */}
      {total > 0 && (
        <Suspense fallback={<div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6"><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /></div>}>
          <ProjectsOverviewMetrics orgId={session.orgId} searchParams={sp} />
        </Suspense>
      )}

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
            startDateFrom: toStr(sp.startDateFrom),
            startDateTo: toStr(sp.startDateTo),
            endDateFrom: toStr(sp.endDateFrom),
            endDateTo: toStr(sp.endDateTo),
            groupBy: toStr(sp.groupBy),
            cf: typeof sp[CF_URL_PARAM] === "string" ? (sp[CF_URL_PARAM] as string) : "",
          })}
          initial={projects}
          initialTotal={total}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}

async function ProjectsOverviewMetrics({
  orgId,
  searchParams,
}: {
  orgId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const totals = await getProjectTotals(orgId);
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

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
      <MetricCard
        label="إجمالي المشاريع"
        value={totals.projects}
        icon={<Briefcase className="size-5" />}
        tone="default"
        size="compact"
        href={totalProjectsHref}
      />
      <MetricCard
        label="إجمالي المهام"
        value={totals.tasks}
        icon={<ListTodo className="size-5" />}
        tone="info"
        size="compact"
      />
      <MetricCard
        label="متوسط المهام"
        value={avgTasksPerProject}
        hint="لكل مشروع"
        icon={<CheckCircle2 className="size-5" />}
        tone="success"
        size="compact"
      />
      <MetricCard
        label="المهام المفتوحة بدون ديدلاين"
        value={totals.openTasksNoDeadline}
        hint="مهام غير مكتملة بدون تاريخ"
        icon={<AlertTriangle className="size-5" />}
        tone={totals.openTasksNoDeadline > 0 ? "warning" : "success"}
        size="compact"
        href="/tasks?f=no_deadline"
      />
      <MetricCard
        label="تحتاج موعد انتهاء"
        value={totals.needsDeadline}
        hint="مشاريع بدون تاريخ انتهاء"
        icon={<CalendarX2 className="size-5" />}
        tone={totals.needsDeadline > 0 ? "warning" : "success"}
        size="compact"
        href={needsDeadlineHref}
      />
      <MetricCard
        label="تجديدات هذا الشهر"
        value={totals.renewalsThisMonth}
        hint="حسب next_renewal_date"
        icon={<RefreshCcw className="size-5" />}
        tone={totals.renewalsThisMonth > 0 ? "info" : "default"}
        size="compact"
        href={renewalsThisMonthHref}
      />
    </div>
  );
}
