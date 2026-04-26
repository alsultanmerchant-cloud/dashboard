import { notFound } from "next/navigation";
import {
  Briefcase, Calendar, User, ListTodo,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getProject, getProjectTaskSummary } from "@/lib/data/projects";
import { listTasks } from "@/lib/data/tasks";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  ProjectStatusBadge, PriorityBadge, ServiceBadge,
} from "@/components/status-badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatArabicShortDate } from "@/lib/utils-format";
import { EmptyState } from "@/components/empty-state";
import { TaskBoard, type BoardTask } from "./task-board";
import { WhatsAppPanel, type WhatsAppGroupRow } from "./whatsapp-panel";
import { listProjectWhatsAppGroups, suggestGroupName } from "@/lib/data/whatsapp";
import type { TaskStage, TaskRoleType } from "@/lib/labels";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePagePermission("projects.view");
  const project = await getProject(session.orgId, id);
  if (!project) notFound();

  const [summary, tasks, waGroups] = await Promise.all([
    getProjectTaskSummary(session.orgId, project.id),
    listTasks(session.orgId, { projectId: project.id }),
    listProjectWhatsAppGroups(session.orgId, project.id),
  ]);

  const client = Array.isArray(project.client) ? project.client[0] : project.client;
  const am = Array.isArray(project.account_manager) ? project.account_manager[0] : project.account_manager;

  const waRows: WhatsAppGroupRow[] = (["client", "internal"] as const).map(
    (kind) => {
      const existing = waGroups.find((g) => g.kind === kind);
      return existing
        ? {
            id: existing.id,
            kind: existing.kind,
            name: existing.name,
            invite_url: existing.invite_url,
          }
        : {
            id: null,
            kind,
            name: client?.name ? suggestGroupName(kind, client.name) : "",
            invite_url: null,
          };
    },
  );

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
          value={summary.in_progress}
          tone="info"
          icon={<Briefcase className="size-5" />}
        />
        <MetricCard
          label="قيد المراجعة"
          value={summary.manager_review + summary.specialist_review}
          tone="warning"
          icon={<ListTodo className="size-5" />}
        />
        <MetricCard
          label="مع العميل"
          value={summary.ready_to_send + summary.sent_to_client + summary.client_changes}
          tone="info"
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

      <SectionTitle
        title="مجموعات واتساب"
        description="القناة الرسمية مع العميل والقروب الداخلي للفريق — تابع تسمية المنشور في الدليل."
      />
      <div className="mb-8">
        <WhatsAppPanel projectId={project.id} rows={waRows} />
      </div>

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
        title="لوحة المهام"
        description={`${tasks.length} مهمة — اسحب البطاقة بين الأعمدة لتغيير المرحلة`}
      />
      {tasks.length === 0 ? (
        <EmptyState
          title="لا توجد مهام بعد"
          description="ستظهر هنا تلقائيًا عند ربط خدمة لها قالب مهام."
          variant="compact"
        />
      ) : (
        <TaskBoard tasks={toBoardTasks(tasks)} />
      )}
    </div>
  );
}

// Map the listTasks() shape into the board's expected BoardTask shape.
type RawTask = Awaited<ReturnType<typeof listTasks>>[number];
function toBoardTasks(rows: RawTask[]): BoardTask[] {
  return rows.map((t) => {
    const service = Array.isArray(t.service) ? t.service[0] : t.service;
    const role_slots: BoardTask["role_slots"] = {};
    for (const ta of t.task_assignees ?? []) {
      const e = Array.isArray(ta.employee) ? ta.employee[0] : ta.employee;
      if (!e) continue;
      role_slots[ta.role_type as TaskRoleType] = {
        id: e.id,
        full_name: e.full_name,
        avatar_url: e.avatar_url,
      };
    }
    return {
      id: t.id,
      title: t.title,
      stage: (t.stage ?? "new") as TaskStage,
      stage_entered_at: t.stage_entered_at ?? t.created_at,
      planned_date: t.planned_date ?? null,
      due_date: t.due_date ?? null,
      priority: t.priority,
      progress_percent: t.progress_percent ?? null,
      expected_progress_percent: t.expected_progress_percent ?? null,
      service: service
        ? { id: service.id, name: service.name, slug: service.slug }
        : null,
      role_slots,
    };
  });
}
