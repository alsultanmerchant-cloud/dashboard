import { cache, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getTask, getTaskSummary } from "@/lib/data/tasks";
import { getTaskActivityFeed } from "@/lib/data/task-activity";
import {
  listTaskFollowers,
  listFollowerCandidates,
  listTaskStageHistory,
  listInheritedProjectFollowers,
} from "@/lib/data/task-detail";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import {
  PriorityBadge,
  ServiceBadge,
  TaskStageBadge,
  TaskStatusBadge,
} from "@/components/status-badges";
import type { TaskStage } from "@/lib/labels";
import { TaskStatusSelect } from "../task-status-select";
import { RecordPagination } from "./record-pagination";
import { TaskExceptionBadge } from "../../escalations/task-exception-badge";
import { MessageButton } from "@/components/dm/message-button";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskRoleType } from "@/lib/labels";
import { formatArabicDateTime, isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import { listEmployees } from "@/lib/data/employees";
import { CommentComposer } from "../comment-composer";
import { TaskSmartButtons } from "./task-smart-buttons";

const TaskRolePanel = dynamic(
  () => import("../task-role-panel").then((mod) => ({ default: mod.TaskRolePanel })),
);
const CommentsFeed = dynamic(
  () => import("./comments-feed").then((mod) => ({ default: mod.CommentsFeed })),
);
const TaskDescription = dynamic(
  () => import("./task-description").then((mod) => ({ default: mod.TaskDescription })),
);
const FollowersPanel = dynamic(
  () => import("./followers-panel").then((mod) => ({ default: mod.FollowersPanel })),
);
const StageHistoryTimeline = dynamic(
  () => import("./stage-history-timeline").then((mod) => ({ default: mod.StageHistoryTimeline })),
);
const StageStepper = dynamic(
  () => import("./stage-stepper").then((mod) => ({ default: mod.StageStepper })),
);
const TaskFormCard = dynamic(
  () => import("./task-form-card").then((mod) => ({ default: mod.TaskFormCard })),
);
const TaskFollowToggle = dynamic(
  () => import("./follow-toggle").then((mod) => ({ default: mod.TaskFollowToggle })),
);
const TaskApprovalPanel = dynamic(
  () => import("./task-approval-panel").then((mod) => ({ default: mod.TaskApprovalPanel })),
);
const TaskLinksPanel = dynamic(
  () => import("./task-links-panel").then((mod) => ({ default: mod.TaskLinksPanel })),
);
const SubtasksTab = dynamic(
  () => import("./subtasks-tab").then((mod) => ({ default: mod.SubtasksTab })),
);
const TimesheetsTab = dynamic(
  () => import("./timesheets-tab").then((mod) => ({ default: mod.TimesheetsTab })),
);
const ActivitiesTab = dynamic(
  () => import("./activities-tab").then((mod) => ({ default: mod.ActivitiesTab })),
);

type TaskLinkRow = import("./task-links-panel").TaskLinkRow;
type SubtaskRow = import("./subtasks-tab").SubtaskRow;
type TimesheetRow = import("./timesheets-tab").TimesheetRow;
type ActivityRow = import("./activities-tab").ActivityRow;
type ActivityType = import("./activities-tab").ActivityType;

const getEmployees = cache(listEmployees);
const getCachedTaskActivityFeed = cache(getTaskActivityFeed);
const getCachedTaskStageHistory = cache(listTaskStageHistory);
const getCachedTaskFollowers = cache(listTaskFollowers);
const getCachedInheritedProjectFollowers = cache(listInheritedProjectFollowers);

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requirePagePermission("tasks.view");
  const activeTab = isTaskTab(sp.tab) ? sp.tab : "activity";

  const [task, followingRes, openExc] = await Promise.all([
    getTaskSummary(session.orgId, id),
    supabaseAdmin
      .from("task_followers")
      .select("user_id")
      .eq("organization_id", session.orgId)
      .eq("task_id", id)
      .eq("user_id", session.userId)
      .limit(1),
    supabaseAdmin
      .from("exceptions")
      .select("id")
      .eq("task_id", id)
      .is("resolved_at", null)
      .limit(1),
  ]);
  if (!task) notFound();
  const hasOpenException = (openExc ?? []).length > 0;
  const canOpenException = hasPermission(session, "exception.open");
  const isFollowing = (followingRes.data ?? []).length > 0;

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

  // Odoo's user_ids m2m maps every collaborator on a task. Our 4-role panel
  // only shows one employee per role, so the remaining assignees were
  // invisible. Build a deduped, role-agnostic "all assignees" list so every
  // user originally on the task shows up.
  const allAssignees = (() => {
    const seen = new Set<string>();
    const out: {
      id: string;
      full_name: string;
      job_title: string | null;
      avatar_url: string | null;
      role_types: TaskRoleType[];
    }[] = [];
    for (const ta of task.task_assignees ?? []) {
      const e = Array.isArray(ta.employee) ? ta.employee[0] : ta.employee;
      if (!e) continue;
      if (seen.has(e.id)) {
        const existing = out.find((x) => x.id === e.id)!;
        if (!existing.role_types.includes(ta.role_type as TaskRoleType)) {
          existing.role_types.push(ta.role_type as TaskRoleType);
        }
        continue;
      }
      seen.add(e.id);
      out.push({
        id: e.id,
        full_name: e.full_name,
        job_title: e.job_title ?? null,
        avatar_url: e.avatar_url ?? null,
        role_types: [ta.role_type as TaskRoleType],
      });
    }
    return out;
  })();

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
      ? diffDaysFromNow(deadline)
      : null;
  const showDelayBanner = delayDays !== null && delayDays > 0;
  const formattedCompletedAt = task.completed_at
    ? formatArabicDateTime(task.completed_at)
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={
          ((task as { task_code?: string | null }).task_code
            ? `${(task as { task_code?: string | null }).task_code} · `
            : "") + task.title
        }
        breadcrumbs={[
          { label: "المهام", href: "/tasks" },
          { label: task.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Suspense fallback={null}>
              <TaskRecordPagination
                orgId={session.orgId}
                taskId={task.id}
                projectId={(task as { project_id?: string | null }).project_id ?? null}
              />
            </Suspense>
            <TaskFollowToggle
              taskId={task.id}
              currentUserId={session.userId}
              isFollowing={isFollowing}
            />
            <TaskStatusSelect taskId={task.id} currentStatus={task.status} />
          </div>
        }
      />

      <Card className="mb-4 overflow-hidden">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <TaskStageBadge stage={task.stage} />
                <TaskStatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                {service ? <ServiceBadge slug={service.slug ?? ""} name={service.name} /> : null}
                {showDelayBanner ? (
                  <span className="inline-flex h-5 items-center rounded-full border border-cc-red/30 bg-cc-red/10 px-2 text-[11px] font-medium text-cc-red">
                    متأخرة {delayDays} يوم
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  {(task as { task_code?: string | null }).task_code ?? "TASK"}
                </p>
                <h1 className="text-2xl font-semibold leading-tight text-foreground text-pretty">
                  {task.title}
                </h1>
                {task.description ? (
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground line-clamp-2">
                    {task.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                  </p>
                ) : null}
              </div>
            </div>

            <dl className="grid min-w-0 gap-3 rounded-xl border border-soft/60 bg-soft/20 p-3 text-sm sm:grid-cols-3 lg:min-w-[30rem]">
              <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                <dt className="text-[11px] text-muted-foreground">المشروع</dt>
                <dd className="text-pretty break-words font-medium leading-6 text-foreground">
                  {project?.name ?? "—"}
                </dd>
                <p className="text-[11px] text-muted-foreground break-words">
                  {client?.name ?? "بدون عميل"}
                </p>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">الموعد النهائي</dt>
                <dd className={cn("font-medium tabular-nums", overdue && "text-cc-red")}>
                  {deadline ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">آخر إنجاز</dt>
                <dd className="font-medium tabular-nums">
                  {formattedCompletedAt ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-soft/40 pt-3">
            <Suspense fallback={<div className="h-10" />}>
              <TaskSmartButtonsSection orgId={session.orgId} taskId={task.id} />
            </Suspense>
          </div>
        </CardContent>
      </Card>

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
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل الموافقات...</CardContent></Card>}>
          <TaskApprovalSection
            orgId={session.orgId}
            taskId={task.id}
            currentUserId={session.userId}
            approvalRequired={Boolean((task as { approval_required?: boolean }).approval_required)}
            approvalStatus={
              ((task as { approval_status?: "not_required" | "pending" | "approved" | "rejected" }).approval_status ??
                "not_required")
            }
            firstApproverId={(task as { first_approver_id?: string | null }).first_approver_id ?? null}
            approvalRequestedAt={(task as { approval_requested_at?: string | null }).approval_requested_at ?? null}
            approvalDecidedAt={(task as { approval_decided_at?: string | null }).approval_decided_at ?? null}
            canManage={
              task.created_by === session.userId ||
              hasPermission(session, "tasks.manage") ||
              hasPermission(session, "task.view_all")
            }
          />
        </Suspense>
      </div>

      <div className="mb-6">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل تفاصيل المهمة...</CardContent></Card>}>
          <TaskFormSection orgId={session.orgId} taskId={task.id} />
        </Suspense>
      </div>

      <SectionTitle
        title="فريق المهمة"
        description="عيِّن المتخصص والمدير والمنفذ ومدير الحساب — كل خانة تحدِّد من يُحرِّك المهمة في مرحلتها."
      />
      <div className="mb-4">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل فريق المهمة...</CardContent></Card>}>
          <TaskRoleSection
            orgId={session.orgId}
            taskId={task.id}
            slots={roleSlots}
          />
        </Suspense>
      </div>

      {(() => {
        // Stage-owner widget: shows whose POSITION owns the current stage
        // (per the task's stage_owner_positions map) + the resolved EMPLOYEE
        // pulled from task_assignees with that role_type. Lets the team see
        // at a glance "this is on Manager Review → it's on أحمد محسن now."
        const stageOwnerMap =
          (task as { stage_owner_positions?: Record<string, string | null> | null })
            .stage_owner_positions ?? null;
        const ownerPosition = stageOwnerMap?.[task.stage as string] ?? null;
        if (!ownerPosition) return null;
        const ROLE_LABEL: Record<string, string> = {
          account_manager: "مدير الحساب",
          specialist: "المتخصص",
          manager: "مدير القسم",
          agent: "المنفذ",
          supporting_lead: "قائد القسم المساند",
          supporting_agent: "منفذ القسم المساند",
        };
        const STAGE_LABEL: Record<string, string> = {
          new: "جديدة",
          in_progress: "قيد التنفيذ",
          manager_review: "مراجعة المدير",
          specialist_review: "مراجعة المتخصص",
          ready_to_send: "جاهزة للإرسال",
          sent_to_client: "أرسلت للعميل",
          client_changes: "تعديلات العميل",
          done: "مكتملة",
        };
        const owner = roleSlots.find(
          (s) => s.role_type === ownerPosition,
        )?.employee ?? null;
        return (
          <Card className="mb-6 border-cyan/30 bg-cyan-dim/15">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="grid size-10 place-items-center rounded-full bg-cyan/20 text-cyan">
                ⚡
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  المسؤول عن المرحلة الحالية
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="rounded-full bg-cyan-dim px-2 py-0.5 text-[11px] font-semibold text-cyan">
                    {STAGE_LABEL[task.stage as string] ?? task.stage}
                  </span>
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <span className="rounded-full bg-soft-1 px-2 py-0.5 text-[11px] font-medium">
                    {ROLE_LABEL[ownerPosition] ?? ownerPosition}
                  </span>
                </div>
              </div>
              {owner ? (
                <div className="flex items-center gap-2 rounded-xl border border-soft bg-card px-3 py-2">
                  {owner.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={owner.avatar_url}
                      alt={owner.full_name}
                      className="size-8 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-8 place-items-center rounded-full bg-cyan/20 text-xs font-semibold text-cyan">
                      {owner.full_name.slice(0, 1)}
                    </span>
                  )}
                  <div>
                    <p className="text-sm font-medium leading-tight">{owner.full_name}</p>
                    {owner.job_title && (
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {owner.job_title}
                      </p>
                    )}
                  </div>
                  <MessageButton
                    employeeId={owner.id}
                    employeeName={owner.full_name}
                    contextTaskId={task.id}
                    size="sm"
                  />
                </div>
              ) : (
                <p className="text-xs text-amber-400">
                  لا يوجد موظف مُسنَد بهذا الدور بعد —
                  أضف {ROLE_LABEL[ownerPosition] ?? ownerPosition} من لوحة الفريق أعلاه.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {allAssignees.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">
                كل المشاركين في المهمة ({allAssignees.length})
              </div>
              <div className="text-[11px] text-muted-foreground">
                المُورَّدون من Odoo (`user_ids`) — الدور والمسمى الوظيفي معروض أسفل كل اسم
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allAssignees.map((a) => {
                const ROLE_AR: Record<TaskRoleType, string> = {
                  account_manager: "مدير الحساب",
                  specialist: "متخصص",
                  manager: "مدير",
                  agent: "منفِّذ",
                };
                const roleLabels = a.role_types
                  .map((rt) => ROLE_AR[rt] ?? rt)
                  .join(" · ");
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-xl border border-soft bg-soft-1 px-3 py-2"
                    title={a.job_title ?? a.full_name}
                  >
                    {a.avatar_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={a.avatar_url}
                        alt={a.full_name}
                        className="size-9 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-cyan/20 text-sm font-semibold text-cyan">
                        {a.full_name.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.full_name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-cyan-dim px-1.5 py-0.5 text-cyan">
                          {roleLabels}
                        </span>
                        {a.job_title && (
                          <span className="truncate">{a.job_title}</span>
                        )}
                      </div>
                    </div>
                    <MessageButton
                      employeeId={a.id}
                      employeeName={a.full_name}
                      contextTaskId={task.id}
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <SectionTitle
        title="متابعون"
        description="المتابعون يَرَون المهمة دون أن يتسلموا دورًا تنفيذيًا في مراحلها."
      />
      <Card className="mb-6">
        <CardContent className="p-4">
          <Suspense fallback={<div className="text-sm text-muted-foreground">جاري تحميل المتابعين...</div>}>
            <TaskFollowersSection
              orgId={session.orgId}
              taskId={task.id}
              projectId={(task as { project_id?: string | null }).project_id ?? null}
              currentUserId={session.userId}
              canManage={
                task.created_by === session.userId ||
                hasPermission(session, "task.view_all") ||
                hasPermission(session, "task.manage_followers")
              }
            />
          </Suspense>
        </CardContent>
      </Card>

      <div className="mt-2 space-y-4">
        <TaskTabNav taskId={task.id} activeTab={activeTab} />
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل هذا القسم...</CardContent></Card>}>
          <TaskTabPanelSection
            orgId={session.orgId}
            taskId={task.id}
            currentUserId={session.userId}
            currentStage={task.stage}
            description={task.description ?? null}
            activeTab={activeTab}
            canManageTasks={hasPermission(session, "tasks.manage")}
            canEnterTimesheets={!!session.employeeId}
            projectId={(task as { project_id?: string | null }).project_id ?? null}
          />
        </Suspense>
      </div>
    </div>
  );
}

function diffDaysFromNow(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

const TASK_TABS = [
  "activity",
  "description",
  "subtasks",
  "links",
  "timesheets",
  "activities",
  "history",
] as const;
type TaskTab = (typeof TASK_TABS)[number];

function isTaskTab(value: string | undefined): value is TaskTab {
  return Boolean(value && (TASK_TABS as readonly string[]).includes(value));
}

function mapActiveEmployeeOptions(
  employees: Awaited<ReturnType<typeof listEmployees>>,
) {
  return employees
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
        user_id: e.user_id ?? null,
      };
    });
}

async function TaskRecordPagination({
  orgId,
  taskId,
  projectId,
}: {
  orgId: string;
  taskId: string;
  projectId: string | null;
}) {
  if (!projectId) return null;

  const { data: siblings } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (!siblings?.length) return null;
  const idx = siblings.findIndex((r) => r.id === taskId);
  if (idx < 0) return null;

  return (
    <RecordPagination
      position={idx + 1}
      total={siblings.length}
      prevId={idx > 0 ? siblings[idx - 1].id : null}
      nextId={idx < siblings.length - 1 ? siblings[idx + 1].id : null}
      basePath="/tasks"
    />
  );
}

async function TaskSmartButtonsSection({
  orgId,
  taskId,
}: {
  orgId: string;
  taskId: string;
}) {
  const [subtasks, outgoingLinks, incomingLinks, comments, openActivities, timesheets] =
    await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("parent_task_id", taskId),
      supabaseAdmin
        .from("task_links")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("source_task_id", taskId),
      supabaseAdmin
        .from("task_links")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("target_task_id", taskId),
      supabaseAdmin
        .from("task_comments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("task_id", taskId),
      supabaseAdmin
        .from("task_activities")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("task_id", taskId)
        .is("completed_at", null),
      supabaseAdmin
        .from("task_timesheets")
        .select("hours")
        .eq("organization_id", orgId)
        .eq("task_id", taskId),
    ]);

  const timesheetHours = (timesheets.data ?? []).reduce(
    (sum, row) => sum + Number(row.hours ?? 0),
    0,
  );

  return (
    <TaskSmartButtons
      subtaskCount={subtasks.count ?? 0}
      linkCount={(outgoingLinks.count ?? 0) + (incomingLinks.count ?? 0)}
      timesheetHours={timesheetHours}
      commentCount={comments.count ?? 0}
      openActivityCount={openActivities.count ?? 0}
    />
  );
}

async function TaskApprovalSection({
  orgId,
  taskId,
  currentUserId,
  approvalRequired,
  approvalStatus,
  firstApproverId,
  approvalRequestedAt,
  approvalDecidedAt,
  canManage,
}: {
  orgId: string;
  taskId: string;
  currentUserId: string;
  approvalRequired: boolean;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  firstApproverId: string | null;
  approvalRequestedAt: string | null;
  approvalDecidedAt: string | null;
  canManage: boolean;
}) {
  const employees = mapActiveEmployeeOptions(await getEmployees(orgId));
  const currentEmployeeId =
    employees.find((employee) => employee.user_id === currentUserId)?.id ?? null;

  return (
    <TaskApprovalPanel
      taskId={taskId}
      approvalRequired={approvalRequired}
      approvalStatus={approvalStatus}
      firstApproverId={firstApproverId}
      approvalRequestedAt={approvalRequestedAt}
      approvalDecidedAt={approvalDecidedAt}
      employees={employees.map((employee) => ({
        id: employee.id,
        full_name: employee.full_name,
        job_title: employee.job_title,
      }))}
      currentEmployeeId={currentEmployeeId}
      canManage={canManage}
    />
  );
}

async function TaskRoleSection({
  orgId,
  taskId,
  slots,
}: {
  orgId: string;
  taskId: string;
  slots: Array<{
    role_type: TaskRoleType;
    employee: {
      id: string;
      full_name: string;
      job_title: string | null;
      avatar_url: string | null;
      department_kind: string | null;
      department_name: string | null;
    };
  }>;
}) {
  const employees = mapActiveEmployeeOptions(await getEmployees(orgId)).map((employee) => ({
    id: employee.id,
    full_name: employee.full_name,
    job_title: employee.job_title,
    avatar_url: employee.avatar_url,
    department_kind: employee.department_kind,
    department_name: employee.department_name,
  }));

  return <TaskRolePanel taskId={taskId} slots={slots} employees={employees} />;
}

async function TaskFollowersSection({
  orgId,
  taskId,
  projectId,
  currentUserId,
  canManage,
}: {
  orgId: string;
  taskId: string;
  projectId: string | null;
  currentUserId: string;
  canManage: boolean;
}) {
  const followers = await getCachedTaskFollowers(orgId, taskId);
  const inheritedFollowers = projectId
    ? await getCachedInheritedProjectFollowers(orgId, projectId)
    : [];
  const explicitUserIds = new Set(followers.map((f) => f.user_id));
  const mergedFollowers = [
    ...followers,
    ...inheritedFollowers.filter((follower) => !explicitUserIds.has(follower.user_id)),
  ];
  const followerCandidates = await listFollowerCandidates(
    orgId,
    mergedFollowers.map((follower) => follower.user_id),
  );

  return (
    <FollowersPanel
      taskId={taskId}
      followers={mergedFollowers}
      candidates={followerCandidates}
      canManage={canManage}
    />
  );
}

async function TaskFormSection({
  orgId,
  taskId,
}: {
  orgId: string;
  taskId: string;
}) {
  const task = await getTask(orgId, taskId);
  if (!task) return null;

  const project = Array.isArray(task.project) ? task.project[0] : task.project;
  const client = project?.client && (Array.isArray(project.client) ? project.client[0] : project.client);
  const service = Array.isArray(task.service) ? task.service[0] : task.service;
  const deadline = task.planned_date ?? task.due_date;
  const overdue = isOverdue(deadline) && task.stage !== "done";
  const storedDelay = (task as { delay_days?: number | null }).delay_days ?? null;
  const delayDays = task.stage === "done"
    ? storedDelay
    : deadline
      ? diffDaysFromNow(deadline)
      : null;
  const formattedCompletedAt = task.completed_at
    ? formatArabicDateTime(task.completed_at)
    : null;

  return (
    <TaskFormCard
      task={{
        priority: task.priority,
        planned_date: task.planned_date ?? null,
        due_date: task.due_date ?? null,
        completed_at: task.completed_at ?? null,
        actual_done_date:
          (task as { actual_done_date?: string | null }).actual_done_date ?? null,
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
      formattedCompletedAt={formattedCompletedAt}
    />
  );
}

function TaskTabNav({
  taskId,
  activeTab,
}: {
  taskId: string;
  activeTab: TaskTab;
}) {
  const tabs: Array<{ key: TaskTab; label: string }> = [
    { key: "activity", label: "سجل النشاط" },
    { key: "description", label: "الوصف" },
    { key: "subtasks", label: "مهام فرعية" },
    { key: "links", label: "ربط المهام" },
    { key: "timesheets", label: "السجل الزمني" },
    { key: "activities", label: "أنشطة مجدولة" },
    { key: "history", label: "تاريخ المراحل" },
  ];

  return (
    <div className="inline-flex w-fit flex-wrap items-center gap-1 rounded-2xl border border-border bg-card p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/tasks/${taskId}?tab=${tab.key}`}
          className={cn(
            "inline-flex h-9 items-center justify-center rounded-xl border border-transparent px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground",
            activeTab === tab.key &&
              "border-cyan/30 bg-cyan/15 text-cyan shadow-[0_0_12px_rgba(0,212,255,0.2)]",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

async function TaskTabPanelSection({
  orgId,
  taskId,
  currentUserId,
  currentStage,
  description,
  activeTab,
  canManageTasks,
  canEnterTimesheets,
  projectId,
}: {
  orgId: string;
  taskId: string;
  currentUserId: string;
  currentStage: string;
  description: string | null;
  activeTab: TaskTab;
  canManageTasks: boolean;
  canEnterTimesheets: boolean;
  projectId: string | null;
}) {
  if (activeTab === "description") {
    return (
      <Card>
        <CardContent className="p-4">
          <TaskDescription html={description} />
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "subtasks") {
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("id, title, task_code, stage, planned_date")
      .eq("organization_id", orgId)
      .eq("parent_task_id", taskId)
      .order("created_at", { ascending: true });

    return (
      <Card>
        <CardContent className="p-4">
          <SubtasksTab
            parentTaskId={taskId}
            subtasks={(data ?? []) as SubtaskRow[]}
            canManage={canManageTasks}
          />
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "links") {
    if (!projectId) {
      return (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">المهمة غير مرتبطة بمشروع.</p>
          </CardContent>
        </Card>
      );
    }

    const [outgoingLinks, incomingLinks, siblingTasks] = await Promise.all([
      supabaseAdmin
        .from("task_links")
        .select("id, dependency_type, lag_days, target_task_id, other:tasks!task_links_target_task_id_fkey ( id, title, task_code )")
        .eq("organization_id", orgId)
        .eq("source_task_id", taskId),
      supabaseAdmin
        .from("task_links")
        .select("id, dependency_type, lag_days, source_task_id, other:tasks!task_links_source_task_id_fkey ( id, title, task_code )")
        .eq("organization_id", orgId)
        .eq("target_task_id", taskId),
      supabaseAdmin
        .from("tasks")
        .select("id, title, task_code")
        .eq("organization_id", orgId)
        .eq("project_id", projectId)
        .neq("id", taskId)
        .order("code_seq", { ascending: true, nullsFirst: false }),
    ]);

    const linkRows: TaskLinkRow[] = [
      ...((outgoingLinks.data ?? []) as Array<{
        id: string;
        dependency_type: TaskLinkRow["dependency_type"];
        lag_days: number;
        other:
          | { id: string; title: string; task_code: string | null }
          | { id: string; title: string; task_code: string | null }[]
          | null;
      }>).map((row) => {
        const other = Array.isArray(row.other) ? row.other[0] : row.other;
        return {
          id: row.id,
          dependency_type: row.dependency_type,
          lag_days: row.lag_days,
          direction: "outgoing" as const,
          other_task: other ?? { id: "", title: "—", task_code: null },
        };
      }),
      ...((incomingLinks.data ?? []) as Array<{
        id: string;
        dependency_type: TaskLinkRow["dependency_type"];
        lag_days: number;
        other:
          | { id: string; title: string; task_code: string | null }
          | { id: string; title: string; task_code: string | null }[]
          | null;
      }>).map((row) => {
        const other = Array.isArray(row.other) ? row.other[0] : row.other;
        return {
          id: row.id,
          dependency_type: row.dependency_type,
          lag_days: row.lag_days,
          direction: "incoming" as const,
          other_task: other ?? { id: "", title: "—", task_code: null },
        };
      }),
    ];

    return (
      <Card>
        <CardContent className="p-4">
          <TaskLinksPanel
            taskId={taskId}
            projectId={projectId}
            links={linkRows}
            candidates={(siblingTasks.data ?? []) as Array<{ id: string; title: string; task_code: string | null }>}
            canManage={canManageTasks}
          />
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "timesheets") {
    const { data } = await supabaseAdmin
      .from("task_timesheets")
      .select("id, spent_on, hours, description, employee:employee_profiles ( id, full_name, user_id )")
      .eq("organization_id", orgId)
      .eq("task_id", taskId)
      .order("spent_on", { ascending: false });

    const rows: TimesheetRow[] = ((data ?? []) as Array<{
      id: string;
      spent_on: string;
      hours: number | string;
      description: string | null;
      employee:
        | { id: string; full_name: string; user_id: string | null }
        | { id: string; full_name: string; user_id: string | null }[]
        | null;
    }>).map((row) => {
      const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee;
      return {
        id: row.id,
        spent_on: row.spent_on,
        hours: row.hours,
        description: row.description,
        employee: employee ?? null,
        is_mine: employee?.user_id === currentUserId,
      };
    });

    return (
      <Card>
        <CardContent className="p-4">
          <TimesheetsTab
            taskId={taskId}
            rows={rows}
            canEnter={canEnterTimesheets}
            canManage={canManageTasks}
          />
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "activities") {
    const { data } = await supabaseAdmin
      .from("task_activities")
      .select("id, activity_type, summary, due_date, completed_at, assignee:employee_profiles ( id, full_name )")
      .eq("organization_id", orgId)
      .eq("task_id", taskId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    const rows: ActivityRow[] = ((data ?? []) as Array<{
      id: string;
      activity_type: ActivityType;
      summary: string;
      due_date: string | null;
      completed_at: string | null;
      assignee:
        | { id: string; full_name: string }
        | { id: string; full_name: string }[]
        | null;
    }>).map((row) => {
      const assignee = Array.isArray(row.assignee) ? row.assignee[0] : row.assignee;
      return {
        id: row.id,
        activity_type: row.activity_type,
        summary: row.summary,
        due_date: row.due_date,
        completed_at: row.completed_at,
        assignee_name: assignee?.full_name ?? null,
      };
    });

    return (
      <Card>
        <CardContent className="p-4">
          <ActivitiesTab
            taskId={taskId}
            rows={rows}
            canManage={canManageTasks}
          />
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "history") {
    const [rows, activity] = await Promise.all([
      getCachedTaskStageHistory(orgId, taskId),
      getCachedTaskActivityFeed(orgId, taskId),
    ]);

    return (
      <Card>
        <CardContent className="p-4">
          <StageHistoryTimeline
            rows={rows}
            fallbackActivity={activity.filter(
              (item): item is Extract<(typeof activity)[number], { kind: "stage_change" }> =>
                item.kind === "stage_change",
            )}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل سجل النشاط...</CardContent></Card>}>
        <TaskActivityFeedSection orgId={orgId} taskId={taskId} />
      </Suspense>
      <Suspense fallback={null}>
        <TaskCommentComposerSection
          orgId={orgId}
          taskId={taskId}
          currentStage={currentStage}
        />
      </Suspense>
    </div>
  );
}

async function TaskActivityFeedSection({
  orgId,
  taskId,
}: {
  orgId: string;
  taskId: string;
}) {
  const activity = await getCachedTaskActivityFeed(orgId, taskId);
  return <CommentsFeed items={activity} />;
}

async function TaskCommentComposerSection({
  orgId,
  taskId,
  currentStage,
}: {
  orgId: string;
  taskId: string;
  currentStage: string;
}) {
  const [activity, employees] = await Promise.all([
    getCachedTaskActivityFeed(orgId, taskId),
    getEmployees(orgId),
  ]);
  const mentionable = mapActiveEmployeeOptions(employees).map((employee) => ({
    id: employee.id,
    name: employee.full_name,
    jobTitle: employee.job_title,
    avatarUrl: employee.avatar_url,
  }));

  return (
    <CommentComposer
      taskId={taskId}
      currentStage={currentStage}
      hasRequirements={activity.some(
        (item) => item.kind === "note" && item.comment_kind === "requirements",
      )}
      mentionable={mentionable}
      floating
    />
  );
}
