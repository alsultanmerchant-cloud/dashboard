import Link from "next/link";
import { Briefcase, ChevronLeft, ListTodo, AlertTriangle, CheckCircle2 } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listLiveProjects } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicShortDate } from "@/lib/utils-format";

export default async function ProjectsPage() {
  await requirePagePermission("projects.view");
  const projects = await listLiveProjects();

  // Aggregate analytics across all projects
  const totalTasks = projects.reduce((sum, p) => sum + p.taskCount, 0);
  const projectsWithManager = projects.filter((p) => p.managerName).length;
  const avgTasksPerProject = projects.length
    ? Math.round(totalTasks / projects.length)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="كل مشاريع الوكالة، العملاء، فريق التنفيذ، وعدد المهام — مباشرة من Odoo."
      />

      {/* Analytics overview */}
      {projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="إجمالي المشاريع"
            value={projects.length}
            icon={<Briefcase className="size-5" />}
            tone="default"
          />
          <MetricCard
            label="إجمالي المهام"
            value={totalTasks}
            icon={<ListTodo className="size-5" />}
            tone="info"
          />
          <MetricCard
            label="متوسط المهام"
            value={avgTasksPerProject}
            hint="لكل مشروع"
            icon={<CheckCircle2 className="size-5" />}
            tone="success"
          />
          <MetricCard
            label="مشاريع بمدير"
            value={projectsWithManager}
            hint={`${projects.length - projectsWithManager} بدون مدير`}
            icon={<AlertTriangle className="size-5" />}
            tone={projectsWithManager === projects.length ? "success" : "warning"}
          />
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-6" />}
          title="لا توجد مشاريع"
          description="لا توجد مشاريع نشطة في Odoo حالياً."
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>المشروع</DataTableHeaderCell>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>مدير المشروع</DataTableHeaderCell>
                <DataTableHeaderCell>المهام</DataTableHeaderCell>
                <DataTableHeaderCell>تاريخ البدء</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="إجراءات" />
              </tr>
            </DataTableHead>
            <tbody>
              {projects.map((p) => (
                <DataTableRow key={p.odooId}>
                  <DataTableCell className="font-medium">
                    <Link
                      href={`/projects/odoo/${p.odooId}`}
                      className="hover:text-cyan transition-colors"
                    >
                      {p.name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {p.clientId ? (
                      <Link
                        href={`/clients/odoo/${p.clientId}`}
                        className="hover:text-cyan transition-colors"
                      >
                        {p.clientName ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {p.managerName ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">{p.taskCount}</DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {formatArabicShortDate(p.startDate)}
                  </DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`/projects/odoo/${p.odooId}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
                      aria-label="فتح"
                    >
                      <ChevronLeft className="size-3.5 icon-flip-rtl" />
                    </Link>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}
    </div>
  );
}
