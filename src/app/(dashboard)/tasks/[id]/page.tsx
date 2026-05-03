import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Briefcase, AlertTriangle } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getTask } from "@/lib/data/tasks";
import { listEmployees } from "@/lib/data/employees";
import { getTaskActivityFeed } from "@/lib/data/task-activity";
import {
  listTaskFollowers,
  listFollowerCandidates,
  listTaskStageHistory,
} from "@/lib/data/task-detail";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  TaskStageBadge, PriorityBadge, ServiceBadge,
} from "@/components/status-badges";
import { TaskStatusSelect } from "../task-status-select";
import { CommentComposer } from "../comment-composer";
import { TaskRolePanel } from "../task-role-panel";
import { CommentsFeed } from "./comments-feed";
import { FollowersPanel } from "./followers-panel";
import { StageHistoryTimeline } from "./stage-history-timeline";
import type { TaskRoleType } from "@/lib/labels";
import { formatArabicDateTime, isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePagePermission("tasks.view");

  const [task, employees, activity, followers, stageHistory] = await Promise.all([
    getTask(session.orgId, id),
    listEmployees(session.orgId),
    getTaskActivityFeed(session.orgId, id),
    listTaskFollowers(session.orgId, id),
    listTaskStageHistory(session.orgId, id),
  ]);
  if (!task) notFound();

  // Followers picker excludes anyone already following.
  const followerCandidates = await listFollowerCandidates(
    session.orgId,
    followers.map((f) => f.user_id),
  );

  // Permission to add/remove followers: same shape as the server action
  // (creator OR view_all OR manage_followers). The action is the
  // canonical gate; this just hides the picker for unprivileged users.
  const canManageFollowers =
    task.created_by === session.userId ||
    hasPermission(session, "task.view_all") ||
    hasPermission(session, "task.manage_followers");

  const roleSlots = (task.task_assignees ?? [])
    .map((ta) => {
      const e = Array.isArray(ta.employee) ? ta.employee[0] : ta.employee;
      return e
        ? {
            role_type: ta.role_type as TaskRoleType,
            employee: {
              id: e.id,
              full_name: e.full_name,
              job_title: e.job_title ?? null,
              avatar_url: e.avatar_url,
              department_kind: null,
              department_name: null,
            },
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const employeeOptions = employees
    .filter((e) => e.employment_status === "active")
    .map((e) => {
      const dept = Array.isArray(e.department) ? e.department[0] : e.department;
      return {
        id: e.id,
        full_name: e.full_name,
        job_title: e.job_title ?? null,
        avatar_url: e.avatar_url ?? null,
        department_kind: dept?.kind ?? null,
        department_name: dept?.name ?? null,
      };
    });

  const project = Array.isArray(task.project) ? task.project[0] : task.project;
  const client = project?.client && (Array.isArray(project.client) ? project.client[0] : project.client);
  const service = Array.isArray(task.service) ? task.service[0] : task.service;
  const deadline = task.planned_date ?? task.due_date;
  const overdue = isOverdue(deadline) && task.stage !== "done";
  // For DONE tasks, prefer the stored generated column (migration 0023):
  // it freezes at the actual completion delay and survives re-renders.
  // For in-flight tasks, compute the running delay from "now".
  // The migration guarantees stored.delay_days is non-null only when
  // stage='done' AND deadline + completed_at exist.
  type TaskWithDelay = typeof task & { delay_days?: number | null };
  const storedDelay = (task as TaskWithDelay).delay_days ?? null;
  const delayDays = task.stage === "done"
    ? storedDelay
    : deadline
      ? Math.floor((Date.now() - new Date(deadline).getTime()) / 86400000)
      : null;
  const showDelayBanner = delayDays !== null && delayDays > 0;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={task.title}
        description={task.description ?? undefined}
        breadcrumbs={[
          { label: "المهام", href: "/tasks" },
          { label: task.title },
        ]}
        actions={<TaskStatusSelect taskId={task.id} currentStatus={task.status} />}
      />

      {showDelayBanner && (
        <Card className="mb-4 border-cc-red/40 bg-cc-red/10">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-cc-red">
              <AlertTriangle className="size-4" />
              {task.stage === "done"
                ? `تأخر التسليم بـ ${delayDays} يوم`
                : `متأخر بـ ${delayDays} يوم`}
            </div>
            <p className="mt-0.5 text-[11px] text-cc-red/80">
              تجاوز الموعد النهائي مشكلة مع العميل (PDF §8.2). راجع السبب
              وسجّله في ملاحظات المهمة.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">المرحلة</p>
            <TaskStageBadge stage={task.stage} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الأولوية</p>
            <PriorityBadge priority={task.priority} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الموعد النهائي</p>
            <p className={cn("text-base font-semibold tabular-nums", overdue && "text-cc-red")} dir="ltr">
              {deadline ?? "—"}
            </p>
            {delayDays != null && delayDays > 0 && (
              <p className="text-[11px] text-cc-red">متأخرة بـ {delayDays} يوم</p>
            )}
            {task.completed_at && (
              <p className="text-[11px] text-cc-green">اكتملت {formatArabicDateTime(task.completed_at)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">المشروع</p>
            <Link href={`/projects/${project?.id}`} className="flex items-center gap-1.5 text-sm font-medium hover:text-cyan transition-colors">
              <Briefcase className="size-3.5" />
              {project?.name ?? "—"}
            </Link>
            {client?.name && <p className="text-[11px] text-muted-foreground truncate">{client.name}</p>}
          </CardContent>
        </Card>
      </div>

      {service && (
        <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="size-3.5" />
          <span>الخدمة:</span>
          <ServiceBadge slug={service.slug} name={service.name} />
        </div>
      )}

      <SectionTitle
        title="فريق المهمة"
        description="عيِّن المتخصص والمدير والمنفذ ومدير الحساب — كل خانة تحدِّد من يُحرِّك المهمة في مرحلتها."
      />
      <div className="mb-6">
        <TaskRolePanel taskId={task.id} slots={roleSlots} employees={employeeOptions} />
      </div>

      <SectionTitle
        title="متابعون"
        description="المتابعون يَرَون المهمة دون أن يتسلموا دورًا تنفيذيًا في مراحلها."
      />
      <Card className="mb-6">
        <CardContent className="p-4">
          <FollowersPanel
            taskId={task.id}
            followers={followers}
            candidates={followerCandidates}
            canManage={canManageFollowers}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="activity" className="mt-2">
        <TabsList variant="line">
          <TabsTrigger value="activity">سجل النشاط</TabsTrigger>
          <TabsTrigger value="description">الوصف</TabsTrigger>
          <TabsTrigger value="history">تاريخ المراحل</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="space-y-4">
          <CommentsFeed items={activity} />
          <CommentComposer
            taskId={task.id}
            currentStage={task.stage}
            hasRequirements={activity.some(
              (a) => a.kind === "note" && a.comment_kind === "requirements",
            )}
          />
        </TabsContent>

        <TabsContent value="description">
          <Card>
            <CardContent className="p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {task.description?.trim() || (
                <span className="text-muted-foreground">لا يوجد وصف لهذه المهمة.</span>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-4">
              <StageHistoryTimeline
                rows={stageHistory}
                fallbackActivity={activity.filter(
                  (a): a is Extract<typeof activity[number], { kind: "stage_change" }> =>
                    a.kind === "stage_change",
                )}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
