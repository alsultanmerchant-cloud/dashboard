import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ListTodo, CheckCircle2, AlertTriangle, Activity,
  Calendar, User, Building2, ChevronLeft,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getLiveProject } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { TaskStageBadge, PriorityBadge } from "@/components/status-badges";
import { formatArabicShortDate, isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

const STAGE_ORDER = [
  "new", "in_progress", "manager_review", "specialist_review",
  "ready_to_send", "sent_to_client", "client_changes", "done",
] as const;

const STAGE_LABEL: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
  done: "مكتملة",
};

export default async function OdooProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePagePermission("projects.view");

  const project = await getLiveProject(Number(id));
  if (!project) notFound();

  const { analytics, tasks } = project;

  // Group tasks by stage for the kanban-ish list
  const tasksByStage = new Map<string, typeof tasks>();
  for (const stage of STAGE_ORDER) tasksByStage.set(stage, []);
  for (const t of tasks) {
    const arr = tasksByStage.get(t.stage) ?? [];
    arr.push(t);
    tasksByStage.set(t.stage, arr);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        breadcrumbs={[
          { label: "المشاريع", href: "/projects" },
          { label: project.name },
        ]}
      />

      {/* Project meta strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">العميل</p>
            {project.clientId ? (
              <Link
                href={`/clients/odoo/${project.clientId}`}
                className="flex items-center gap-1.5 text-sm font-medium hover:text-cyan transition-colors"
              >
                <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{project.clientName}</span>
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">مدير المشروع</p>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <User className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{project.managerName ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">تاريخ البدء</p>
            <div className="flex items-center gap-1.5 text-sm font-medium" dir="ltr">
              <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{formatArabicShortDate(project.startDate)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">تاريخ الانتهاء</p>
            <div className="flex items-center gap-1.5 text-sm font-medium" dir="ltr">
              <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{formatArabicShortDate(project.endDate)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analytics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="إجمالي المهام"
          value={analytics.total}
          icon={<ListTodo className="size-5" />}
          tone="default"
        />
        <MetricCard
          label="قيد التنفيذ"
          value={analytics.inProgress}
          icon={<Activity className="size-5" />}
          tone="info"
        />
        <MetricCard
          label="مكتملة"
          value={analytics.done}
          hint={`${analytics.completionPercent}% إنجاز`}
          icon={<CheckCircle2 className="size-5" />}
          tone="success"
        />
        <MetricCard
          label="متأخرة"
          value={analytics.overdue}
          icon={<AlertTriangle className="size-5" />}
          tone={analytics.overdue > 0 ? "destructive" : "default"}
        />
        <MetricCard
          label="أولوية عالية"
          value={analytics.byPriority.high}
          icon={<AlertTriangle className="size-5" />}
          tone="warning"
        />
      </div>

      {/* Stage distribution bar */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-medium">توزيع المهام حسب المرحلة</p>
          <div className="space-y-2">
            {STAGE_ORDER.map((stage) => {
              const count = analytics.byStage[stage] ?? 0;
              const pct = analytics.total ? (count / analytics.total) * 100 : 0;
              if (count === 0) return null;
              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <TaskStageBadge stage={stage} />
                  </div>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="absolute inset-y-0 right-0 bg-cyan/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Description */}
      {project.description && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              ملاحظات المشروع
            </p>
            <div
              className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-foreground"
              dangerouslySetInnerHTML={{ __html: project.description }}
            />
          </CardContent>
        </Card>
      )}

      {/* Tasks grouped by stage */}
      <div>
        <h2 className="mb-3 text-base font-semibold">المهام ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              لا توجد مهام في هذا المشروع.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {STAGE_ORDER.map((stage) => {
              const stageTasks = tasksByStage.get(stage) ?? [];
              if (stageTasks.length === 0) return null;
              return (
                <div key={stage}>
                  <div className="mb-2 flex items-center gap-2">
                    <TaskStageBadge stage={stage} />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {stageTasks.length}
                    </span>
                  </div>
                  <Card>
                    <CardContent className="p-0">
                      <ul className="divide-y divide-white/[0.04]">
                        {stageTasks.map((t) => {
                          const overdue = isOverdue(t.deadline) && t.stage !== "done";
                          return (
                            <li key={t.odooId}>
                              <Link
                                href={`/tasks/odoo/${t.odooId}`}
                                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{t.name}</p>
                                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <PriorityBadge priority={t.priority} />
                                    {t.deadline && (
                                      <span
                                        className={cn(
                                          "tabular-nums",
                                          overdue && "text-cc-red font-medium",
                                        )}
                                        dir="ltr"
                                      >
                                        {t.deadline}
                                      </span>
                                    )}
                                    {t.assigneeIds.length > 0 && (
                                      <span>{t.assigneeIds.length} منفذ</span>
                                    )}
                                  </div>
                                </div>
                                <ChevronLeft className="size-4 shrink-0 text-muted-foreground icon-flip-rtl" />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
