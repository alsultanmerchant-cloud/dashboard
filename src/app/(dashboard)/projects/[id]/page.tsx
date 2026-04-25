import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Briefcase, Calendar, User, ListTodo, ChevronLeft,
} from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { getProject, getProjectTaskSummary } from "@/lib/data/projects";
import { listTasks } from "@/lib/data/tasks";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  ProjectStatusBadge, PriorityBadge, ServiceBadge,
  TaskStatusBadge,
} from "@/components/status-badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicShortDate } from "@/lib/utils-format";
import { EmptyState } from "@/components/empty-state";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const project = await getProject(session.orgId, id);
  if (!project) notFound();

  const [summary, tasks] = await Promise.all([
    getProjectTaskSummary(session.orgId, project.id),
    listTasks(session.orgId, { projectId: project.id }),
  ]);

  const client = Array.isArray(project.client) ? project.client[0] : project.client;
  const am = Array.isArray(project.account_manager) ? project.account_manager[0] : project.account_manager;

  return (
    <div>
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        breadcrumbs={[{ label: "المشاريع", href: "/projects" }, { label: project.name }]}
        actions={
          <div className="flex items-center gap-2">
            <PriorityBadge priority={project.priority} />
            <ProjectStatusBadge status={project.status} />
          </div>
        }
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          label="إجمالي المهام"
          value={summary.total}
          icon={<ListTodo className="size-5" />}
        />
        <MetricCard
          label="قيد التنفيذ"
          value={summary.in_progress + summary.review}
          tone="info"
          icon={<Briefcase className="size-5" />}
        />
        <MetricCard
          label="مكتملة"
          value={summary.done}
          tone="success"
          icon={<ListTodo className="size-5" />}
        />
        <MetricCard
          label="قيد الانتظار"
          value={summary.todo + summary.blocked}
          tone="warning"
          icon={<ListTodo className="size-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-8">
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="size-4 text-cyan" /> العميل
            </h3>
            <div>
              <p className="text-base font-medium">{client?.name ?? "—"}</p>
              {client?.contact_name && (
                <p className="text-xs text-muted-foreground mt-0.5">{client.contact_name}</p>
              )}
              {client?.phone && <p className="text-xs text-muted-foreground" dir="ltr">{client.phone}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Calendar className="size-4 text-cyan" /> الجدول الزمني
            </h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">البدء</span>
                <span>{formatArabicShortDate(project.start_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">الانتهاء</span>
                <span>{formatArabicShortDate(project.end_date)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="size-4 text-cyan" /> مدير الحساب
            </h3>
            {am ? (
              <div className="flex items-center gap-2.5">
                <Avatar size="sm">
                  <AvatarFallback>{am.full_name[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{am.full_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{am.job_title ?? ""}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">لم يتم تعيين مدير حساب بعد</p>
            )}
          </CardContent>
        </Card>
      </div>

      <SectionTitle title="الخدمات" />
      <Card className="mb-8">
        <CardContent className="p-4">
          {(project.project_services ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد خدمات مرتبطة بعد.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(project.project_services ?? []).map((ps) => {
                const s = Array.isArray(ps.service) ? ps.service[0] : ps.service;
                if (!s) return null;
                return <ServiceBadge key={ps.id} slug={s.slug} name={s.name} />;
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SectionTitle title="فريق المشروع" />
      <Card className="mb-8">
        <CardContent className="p-4">
          {(project.project_members ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد أعضاء فريق مضافون بعد.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(project.project_members ?? []).map((m) => {
                const e = Array.isArray(m.employee) ? m.employee[0] : m.employee;
                if (!e) return null;
                return (
                  <li key={m.id} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5">
                    <Avatar size="sm">
                      <AvatarFallback>{e.full_name[0]}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.full_name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{m.role_label ?? e.job_title ?? ""}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <SectionTitle
        title="المهام"
        description={`${tasks.length} مهمة في هذا المشروع`}
      />
      {tasks.length === 0 ? (
        <EmptyState
          title="لا توجد مهام بعد"
          description="ستظهر هنا تلقائيًا عند ربط خدمة لها قالب مهام."
          variant="compact"
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>المهمة</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
                <DataTableHeaderCell>تاريخ التسليم</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="فتح" />
              </tr>
            </DataTableHead>
            <tbody>
              {tasks.map((t) => (
                <DataTableRow key={t.id}>
                  <DataTableCell className="font-medium">
                    <Link href={`/tasks/${t.id}`} className="hover:text-cyan transition-colors">
                      {t.title}
                    </Link>
                  </DataTableCell>
                  <DataTableCell><TaskStatusBadge status={t.status} /></DataTableCell>
                  <DataTableCell><PriorityBadge priority={t.priority} /></DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground" dir="ltr">{t.due_date ?? "—"}</DataTableCell>
                  <DataTableCell>
                    <Link
                      href={`/tasks/${t.id}`}
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
