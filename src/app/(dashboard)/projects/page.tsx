import { Briefcase, ListTodo, AlertTriangle, CheckCircle2 } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listProjectsPaged } from "@/lib/data/projects";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { ProjectsList } from "./projects-list";

const PAGE_SIZE = 25;

export default async function ProjectsPage() {
  const session = await requirePagePermission("projects.view");
  const { rows: projects, total, totals } = await listProjectsPaged({
    organizationId: session.orgId,
    page: 1,
    pageSize: PAGE_SIZE,
  });

  const avgTasksPerProject = totals.projects
    ? Math.round(totals.tasks / totals.projects)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="كل مشاريع الوكالة، العملاء، فريق التنفيذ، وعدد المهام."
      />

      {/* Analytics overview */}
      {total > 0 && (
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
      )}

      {total === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-6" />}
          title="لا توجد مشاريع"
          description="لا توجد مشاريع نشطة حالياً."
        />
      ) : (
        <ProjectsList
          initial={projects}
          initialTotal={total}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
