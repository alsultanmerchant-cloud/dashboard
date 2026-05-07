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
  listInheritedProjectFollowers,
} from "@/lib/data/task-detail";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  PriorityBadge,
  ServiceBadge,
  TaskStageBadge,
  TaskStatusBadge,
} from "@/components/status-badges";
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
import { TaskApprovalPanel } from "./task-approval-panel";
import { TaskLinksPanel, type TaskLinkRow } from "./task-links-panel";
import { SubtasksTab, type SubtaskRow } from "./subtasks-tab";
import { TimesheetsTab, type TimesheetRow } from "./timesheets-tab";
import { ActivitiesTab, type ActivityRow, type ActivityType } from "./activities-tab";
import { TaskSmartButtons } from "./task-smart-buttons";
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

  // Load task_links (in & out) + sibling tasks for the picker.
  const projectIdForLinks = (task as { project_id?: string | null }).project_id ?? null;
  const [outgoingLinks, incomingLinks, siblingTasks] = await Promise.all([
    projectIdForLinks
      ? supabaseAdmin
          .from("task_links")
          .select("id, dependency_type, lag_days, target_task_id, other:tasks!task_links_target_task_id_fkey ( id, title, task_code )")
          .eq("organization_id", session.orgId)
          .eq("source_task_id", id)
      : Promise.resolve({ data: [] }),
    projectIdForLinks
      ? supabaseAdmin
          .from("task_links")
          .select("id, dependency_type, lag_days, source_task_id, other:tasks!task_links_source_task_id_fkey ( id, title, task_code )")
          .eq("organization_id", session.orgId)
          .eq("target_task_id", id)
      : Promise.resolve({ data: [] }),
    projectIdForLinks
      ? supabaseAdmin
          .from("tasks")
          .select("id, title, task_code")
          .eq("organization_id", session.orgId)
          .eq("project_id", projectIdForLinks)
          .neq("id", id)
          .order("code_seq", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] }),
  ]);
  const linkRows: TaskLinkRow[] = [
    ...((outgoingLinks.data ?? []) as Array<{
      id: string;
      dependency_type: TaskLinkRow["dependency_type"];
      lag_days: number;
      other: { id: string; title: string; task_code: string | null }
        | { id: string; title: string; task_code: string | null }[]
        | null;
    }>).map((r) => {
      const o = Array.isArray(r.other) ? r.other[0] : r.other;
      return {
        id: r.id,
        dependency_type: r.dependency_type,
        lag_days: r.lag_days,
        direction: "outgoing" as const,
        other_task: o ?? { id: "", title: "—", task_code: null },
      };
    }),
    ...((incomingLinks.data ?? []) as Array<{
      id: string;
      dependency_type: TaskLinkRow["dependency_type"];
      lag_days: number;
      other: { id: string; title: string; task_code: string | null }
        | { id: string; title: string; task_code: string | null }[]
        | null;
    }>).map((r) => {
      const o = Array.isArray(r.other) ? r.other[0] : r.other;
      return {
        id: r.id,
        dependency_type: r.dependency_type,
        lag_days: r.lag_days,
        direction: "incoming" as const,
        other_task: o ?? { id: "", title: "—", task_code: null },
      };
    }),
  ];
  const linkCandidates = ((siblingTasks.data ?? []) as Array<{
    id: string;
    title: string;
    task_code: string | null;
  }>);

  // Sub-tasks + timesheets + scheduled activities
  const [subtasksRes, timesheetsRes, activitiesRes] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("id, title, task_code, stage, planned_date")
      .eq("organization_id", session.orgId)
      .eq("parent_task_id", id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("task_timesheets")
      .select("id, spent_on, hours, description, employee:employee_profiles ( id, full_name, user_id )")
      .eq("organization_id", session.orgId)
      .eq("task_id", id)
      .order("spent_on", { ascending: false }),
    supabaseAdmin
      .from("task_activities")
      .select("id, activity_type, summary, due_date, completed_at, assignee:employee_profiles ( id, full_name )")
      .eq("organization_id", session.orgId)
      .eq("task_id", id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);
  const subtaskRows: SubtaskRow[] = ((subtasksRes.data ?? []) as SubtaskRow[]);
  const timesheetRows: TimesheetRow[] = ((timesheetsRes.data ?? []) as Array<{
    id: string;
    spent_on: string;
    hours: number | string;
    description: string | null;
    employee: { id: string; full_name: string; user_id: string | null }
      | { id: string; full_name: string; user_id: string | null }[]
      | null;
  }>).map((r) => {
    const e = Array.isArray(r.employee) ? r.employee[0] : r.employee;
    return {
      id: r.id,
      spent_on: r.spent_on,
      hours: r.hours,
      description: r.description,
      employee: e ?? null,
      is_mine: e?.user_id === session.userId,
    };
  });
  const activityRows: ActivityRow[] = ((activitiesRes.data ?? []) as Array<{
    id: string;
    activity_type: ActivityType;
    summary: string;
    due_date: string | null;
    completed_at: string | null;
    assignee:
      | { id: string; full_name: string }
      | { id: string; full_name: string }[]
      | null;
  }>).map((r) => {
    const a = Array.isArray(r.assignee) ? r.assignee[0] : r.assignee;
    return {
      id: r.id,
      activity_type: r.activity_type,
      summary: r.summary,
      due_date: r.due_date,
      completed_at: r.completed_at,
      assignee_name: a?.full_name ?? null,
    };
  });
  const openActivitiesCount = activityRows.filter((a) => !a.completed_at).length;
  const timesheetHoursTotal = timesheetRows.reduce(
    (sum, r) => sum + Number(r.hours ?? 0),
    0,
  );

  // Odoo chatter is now mirrored into task_comments by the hourly sync, so
  // the supabaseActivity feed already includes it. The legacy live fetch
  // (listLiveTaskMessages + odooMessagesToActivity) is intentionally NOT
  // called here — keeping it would double-display every comment.
  const activity = supabaseActivity.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const commentCount = activity.filter(
    (a) => a.kind === "note" || a.kind === "odoo_message",
  ).length;

  // Inherited project followers (project_members ← Odoo favorite_user_ids).
  // Surfaced read-only so Odoo-imported tasks aren't visually empty.
  const projectIdForFollowers = (task as { project_id?: string | null }).project_id ?? null;
  const inheritedFollowers = projectIdForFollowers
    ? await listInheritedProjectFollowers(session.orgId, projectIdForFollowers)
    : [];

  // Merge: explicit task followers first, then any inherited not already
  // present (dedup by user_id).
  const explicitUserIds = new Set(followers.map((f) => f.user_id));
  const mergedFollowers = [
    ...followers,
    ...inheritedFollowers.filter((i) => !explicitUserIds.has(i.user_id)),
  ];

  // Followers picker excludes anyone already following (explicit or inherited).
  const followerCandidates = await listFollowerCandidates(
    session.orgId,
    mergedFollowers.map((f) => f.user_id),
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

  // Only count EXPLICIT followers for the follow-toggle state (inherited
  // project members can't be unfollowed at the task level).
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

            <dl className="grid min-w-0 gap-3 rounded-xl border border-soft/60 bg-soft/20 p-3 text-sm sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">المشروع</dt>
                <dd className="truncate font-medium text-foreground">
                  {project?.name ?? "—"}
                </dd>
                <p className="truncate text-[11px] text-muted-foreground">
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
            <TaskSmartButtons
              subtaskCount={subtaskRows.length}
              linkCount={linkRows.length}
              timesheetHours={timesheetHoursTotal}
              commentCount={commentCount}
              openActivityCount={openActivitiesCount}
            />
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
        <TaskApprovalPanel
          taskId={task.id}
          approvalRequired={Boolean((task as { approval_required?: boolean }).approval_required)}
          approvalStatus={
            ((task as { approval_status?: "not_required" | "pending" | "approved" | "rejected" }).approval_status ??
              "not_required")
          }
          firstApproverId={(task as { first_approver_id?: string | null }).first_approver_id ?? null}
          approvalRequestedAt={(task as { approval_requested_at?: string | null }).approval_requested_at ?? null}
          approvalDecidedAt={(task as { approval_decided_at?: string | null }).approval_decided_at ?? null}
          employees={employeeOptions.map((e) => ({
            id: e.id,
            full_name: e.full_name,
            job_title: e.job_title,
          }))}
          currentEmployeeId={
            employeeOptions.find((e) => {
              const emp = employees.find((src) => src.id === e.id);
              return emp?.user_id === session.userId;
            })?.id ?? null
          }
          canManage={
            task.created_by === session.userId ||
            hasPermission(session, "tasks.manage") ||
            hasPermission(session, "task.view_all")
          }
        />
      </div>

      <div className="mb-6">
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
      </div>

      <SectionTitle
        title="فريق المهمة"
        description="عيِّن المتخصص والمدير والمنفذ ومدير الحساب — كل خانة تحدِّد من يُحرِّك المهمة في مرحلتها."
      />
      <div className="mb-4">
        <TaskRolePanel taskId={task.id} slots={roleSlots} employees={employeeOptions} />
      </div>

      {allAssignees.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">
                كل المشاركين في المهمة ({allAssignees.length})
              </div>
              <div className="text-[11px] text-muted-foreground">
                المُورَّدون من Odoo (`user_ids`) — الكل ضمن دور المنفذ افتراضيًا
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {allAssignees.map((a) => (
                <div
                  key={a.id}
                  className="inline-flex items-center gap-2 rounded-full border border-soft bg-soft-1 px-2 py-1 text-xs text-foreground"
                  title={a.job_title ?? a.full_name}
                >
                  {a.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={a.avatar_url}
                      alt={a.full_name}
                      className="size-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid size-5 place-items-center rounded-full bg-cyan/20 text-[10px] font-semibold text-cyan">
                      {a.full_name.slice(0, 1)}
                    </span>
                  )}
                  <span>{a.full_name}</span>
                </div>
              ))}
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
          <FollowersPanel
            taskId={task.id}
            followers={mergedFollowers}
            candidates={followerCandidates}
            canManage={canManageFollowers}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="activity" className="mt-2">
        <TabsList>
          <TabsTrigger value="activity" data-smart-target="activity">سجل النشاط</TabsTrigger>
          <TabsTrigger value="description" data-smart-target="description">الوصف</TabsTrigger>
          <TabsTrigger value="subtasks" data-smart-target="subtasks">
            مهام فرعية{subtaskRows.length > 0 ? ` (${subtaskRows.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="links" data-smart-target="links">
            ربط المهام{linkRows.length > 0 ? ` (${linkRows.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="timesheets" data-smart-target="timesheets">
            السجل الزمني{timesheetRows.length > 0 ? ` (${timesheetRows.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="activities" data-smart-target="activities">
            أنشطة مجدولة{openActivitiesCount > 0 ? ` (${openActivitiesCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="history" data-smart-target="history">تاريخ المراحل</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="space-y-4">
          <CommentsFeed items={activity} />
          <CommentComposer
            taskId={task.id}
            currentStage={task.stage}
            hasRequirements={activity.some(
              (a) => a.kind === "note" && a.comment_kind === "requirements",
            )}
            mentionable={employeeOptions.map((e) => ({
              id: e.id,
              name: e.full_name,
              jobTitle: e.job_title,
              avatarUrl: e.avatar_url,
            }))}
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

        <TabsContent value="subtasks">
          <Card>
            <CardContent className="p-4">
              <SubtasksTab
                parentTaskId={task.id}
                subtasks={subtaskRows}
                canManage={hasPermission(session, "tasks.manage")}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="links">
          <Card>
            <CardContent className="p-4">
              {projectIdForLinks ? (
                <TaskLinksPanel
                  taskId={task.id}
                  projectId={projectIdForLinks}
                  links={linkRows}
                  candidates={linkCandidates}
                  canManage={hasPermission(session, "tasks.manage")}
                />
              ) : (
                <p className="text-xs text-muted-foreground">المهمة غير مرتبطة بمشروع.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timesheets">
          <Card>
            <CardContent className="p-4">
              <TimesheetsTab
                taskId={task.id}
                rows={timesheetRows}
                canEnter={!!session.employeeId}
                canManage={hasPermission(session, "tasks.manage")}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities">
          <Card>
            <CardContent className="p-4">
              <ActivitiesTab
                taskId={task.id}
                rows={activityRows}
                canManage={hasPermission(session, "tasks.manage")}
              />
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

function diffDaysFromNow(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}
