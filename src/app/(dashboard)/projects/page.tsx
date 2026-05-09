import { Suspense } from "react";
import { Briefcase, ListTodo, AlertTriangle, CheckCircle2 } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getProjectTotals, listProjectsPaged } from "@/lib/data/projects";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { ProjectsList } from "./projects-list";

const PAGE_SIZE = 25;

function toEnabled(value: string | string[] | undefined) {
  return value === "1" || value === "true";
}

function toStr(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requirePagePermission("projects.view");
  const { rows: projects, total } = await listProjectsPaged({
    organizationId: session.orgId,
    page: 1,
    pageSize: PAGE_SIZE,
    includeTotals: false,
    search: typeof sp.q === "string" ? sp.q : "",
    onlyWithCategories: toEnabled(sp.onlyWithCategories),
    onlyFavorites: toEnabled(sp.onlyFavorites),
    onlyWithManager: toEnabled(sp.onlyWithManager),
    onlyMine: toEnabled(sp.onlyMine),
    onlyUnassigned: toEnabled(sp.onlyUnassigned),
    archived: toEnabled(sp.archived),
    startDateFrom: toStr(sp.startDateFrom),
    startDateTo: toStr(sp.startDateTo),
    endDateFrom: toStr(sp.endDateFrom),
    endDateTo: toStr(sp.endDateTo),
    currentEmployeeId: session.employeeId,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="كل مشاريع الوكالة، العملاء، فريق التنفيذ، وعدد المهام."
      />

      {/* Analytics overview */}
      {total > 0 && (
        <Suspense fallback={<div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4"><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /><div className="h-24 rounded-xl border border-border bg-card/60" /></div>}>
          <ProjectsOverviewMetrics orgId={session.orgId} />
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
            onlyWithCategories: toEnabled(sp.onlyWithCategories),
            onlyFavorites: toEnabled(sp.onlyFavorites),
            onlyWithManager: toEnabled(sp.onlyWithManager),
            onlyMine: toEnabled(sp.onlyMine),
            onlyUnassigned: toEnabled(sp.onlyUnassigned),
            archived: toEnabled(sp.archived),
            startDateFrom: toStr(sp.startDateFrom),
            startDateTo: toStr(sp.startDateTo),
            endDateFrom: toStr(sp.endDateFrom),
            endDateTo: toStr(sp.endDateTo),
            groupBy: toStr(sp.groupBy),
          })}
          initial={projects}
          initialTotal={total}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}

async function ProjectsOverviewMetrics({ orgId }: { orgId: string }) {
  const totals = await getProjectTotals(orgId);
  const avgTasksPerProject = totals.projects
    ? Math.round(totals.tasks / totals.projects)
    : 0;

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4">
      <MetricCard
        label="إجمالي المشاريع"
        value={totals.projects}
        icon={<Briefcase className="size-5" />}
        tone="default"
        size="compact"
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
        label="مشاريع بمدير"
        value={totals.withManager}
        hint={`${totals.projects - totals.withManager} بدون مدير`}
        icon={<AlertTriangle className="size-5" />}
        tone={totals.withManager === totals.projects ? "success" : "warning"}
        size="compact"
      />
    </div>
  );
}
