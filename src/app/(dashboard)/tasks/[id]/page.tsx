import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
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
import type { TaskStage } from "@/lib/labels";
import { TaskStatusSelect } from "../task-status-select";
import { CommentComposer } from "../comment-composer";
import { TaskRolePanel } from "../task-role-panel";
import { CommentsFeed } from "./comments-feed";
import { TaskDescription } from "./task-description";
import { FollowersPanel } from "./followers-panel";
import { StageHistoryTimeline } from "./stage-history-timeline";
import { StageStepper } from "./stage-stepper";
import { TaskFormCard } from "./task-form-card";
import { TaskFollowToggle } from "./follow-toggle";
import { RecordPagination } from "./record-pagination";
import { TaskExceptionBadge } from "../../escalations/task-exception-badge";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

  const [task, employees, supabaseActivity, followers, stageHistory] =
    await Promise.all([
      getTask(session.orgId, id),
      listEmployees(session.orgId),
      getTaskActivityFeed(session.orgId, id),
      listTaskFollowers(session.orgId, id),
      listTaskStageHistory(session.orgId, id),
    ]);
  if (!task) notFound();

  // Odoo chatter is now mirrored into task_comments by the hourly sync, so
  // the supabaseActivity feed already includes it. The legacy live fetch
  // (listLiveTaskMessages + odooMessagesToActivity) is intentionally NOT
  // called here — keeping it would double-display every comment.
  const activity = supabaseActivity.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Followers picker excludes anyone already following.
  const followerCandidates = await listFollowerCandidates(
    session.orgId,
    followers.map((f) => f.user_id),
  );

  // T5: detect any open exception on this task (read-only side query).
  const { data: openExc } = await supabaseAdmin
    .from("exceptions")
    .select("id")
    .eq("task_id", id)
    .is("resolved_at", null)
    .limit(1);
  const hasOpenException = (openExc ?? []).length > 0;
  const canOpenException = hasPermission(session, "exception.open");

  // Record pagination — prev/next within the same project, ordered by
  // created_at. Mirrors Odoo's "16 / 107" form-view pager. Cheap query:
  // we only fetch ids, not full task rows.
  const projectIdRaw = (task as { project_id?: string | null }).project_id ?? null;
  let recordPager: {
    position: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
  } | null = null;
  if (projectIdRaw) {
    const { data: siblings } = await supabaseAdmin
      .from("tasks")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("project_id", projectIdRaw)
      .order("created_at", { ascending: true });
    if (siblings && siblings.length > 0) {
      const idx = siblings.findIndex((r) => r.id === task.id);
      if (idx >= 0) {
        recordPager = {
          position: idx + 1,
          total: siblings.length,
          prevId: idx > 0 ? siblings[idx - 1].id : null,
          nextId: idx < siblings.length - 1 ? siblings[idx + 1].id : null,
        };
      }
    }
  }

  const isFollowing = followers.some((f) => f.user_id === session.userId);

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
        actions={
          <div className="flex items-center gap-2">
            {recordPager && (
              <RecordPagination
                position={recordPager.position}
                total={recordPager.total}
                prevId={recordPager.prevId}
                nextId={recordPager.nextId}
                basePath="/tasks"
              />
            )}
            <TaskFollowToggle
              taskId={task.id}
              currentUserId={session.userId}
              isFollowing={isFollowing}
            />
            <TaskStatusSelect taskId={task.id} currentStatus={task.status} />
          </div>
        }
      />

      {(hasOpenException || canOpenException) && (
        <div className="mb-4">
          <TaskExceptionBadge
            taskId={task.id}
            hasOpenException={hasOpenException}
            canOpen={canOpenException}
          />
        </div>
      )}

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

      <div className="mb-6">
        <StageStepper
          taskId={task.id}
          currentStage={task.stage as TaskStage}
          stageEnteredAt={task.stage_entered_at ?? null}
        />
      </div>

      <div className="mb-6">
        <TaskFormCard
          task={{
            priority: task.priority,
            planned_date: task.planned_date ?? null,
            due_date: task.due_date ?? null,
            completed_at: task.completed_at ?? null,
            allocated_time_minutes:
              (task as { allocated_time_minutes?: number | null }).allocated_time_minutes ?? null,
            progress_percent:
              (task as { progress_percent?: number | string | null }).progress_percent ?? null,
            expected_progress_percent:
              (task as { expected_progress_percent?: number | string | null }).expected_progress_percent ?? null,
            progress_slip_percent:
              (task as { progress_slip_percent?: number | string | null }).progress_slip_percent ?? null,
            delay_days: storedDelay,
            hold_reason: (task as { hold_reason?: string | null }).hold_reason ?? null,
            hold_since: (task as { hold_since?: string | null }).hold_since ?? null,
          }}
          project={project ? { id: project.id, name: project.name } : null}
          client={client ? { id: client.id, name: client.name } : null}
          service={service ? { id: service.id, slug: service.slug, name: service.name } : null}
          computedDelayDays={delayDays}
          overdue={overdue}
          formattedCompletedAt={
            task.completed_at ? formatArabicDateTime(task.completed_at) : null
          }
        />
      </div>

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
        <TabsList>
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
            floating
          />
        </TabsContent>

        <TabsContent value="description">
          <Card>
            <CardContent className="p-4">
              <TaskDescription html={task.description ?? null} />
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
