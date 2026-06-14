import { cache, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getTaskSummary } from "@/lib/data/tasks";
import { getTaskActivityFeed } from "@/lib/data/task-activity";
import {
  listTaskFollowers,
  listFollowerCandidates,
  listTaskStageHistory,
  listInheritedProjectFollowers,
} from "@/lib/data/task-detail";
import { ActionBar, type SmartPill } from "@/components/layout/action-bar";
import { FileText, Folder } from "lucide-react";
import { SectionTitle } from "@/components/section-title";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import type { TaskStage } from "@/lib/labels";
import { TaskStatusSelect } from "../task-status-select";
import { TaskStarToggle } from "./task-star-toggle";
import { TaskPriorityStar } from "./task-priority-star";
import { RecordPagination } from "./record-pagination";
import { TaskExceptionBadge } from "../../escalations/task-exception-badge";
import { MessageButton } from "@/components/dm/message-button";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskRoleType } from "@/lib/labels";
import { avatarUrlFor, isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import { listEmployees } from "@/lib/data/employees";
import { listPositions } from "@/lib/data/positions";
import { loadOrgChart } from "@/lib/data/org-chart";
import { CommentComposer } from "../comment-composer";
import { TaskSmartButtons } from "./task-smart-buttons";
import { TaskStageOwnerEditor } from "./task-stage-owner-editor";

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
const AttachmentsTab = dynamic(
  () => import("./attachments-tab").then((mod) => ({ default: mod.AttachmentsTab })),
);
const TaskAssigneesPanel = dynamic(
  () =>
    import("./task-assignees-panel").then((mod) => ({
      default: mod.TaskAssigneesPanel,
    })),
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

function formatDateTime(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale === "ar" ? "ar-SA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, sp, session, t, locale] = await Promise.all([
    params,
    searchParams,
    requirePagePermission("tasks.view"),
    getTranslations("TaskDetailPage"),
    getLocale(),
  ]);
  // Guard: route is dynamic `[id]`, so `/tasks/new` or `/tasks/foo` would
  // otherwise reach getTaskSummary and hit Postgres with a non-UUID,
  // surfacing a 22P02 invalid_text_representation error. Bail to 404.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }
  // Default to the activity (log / notes) tab when no explicit `?tab=` is present.
  const activeTab = isTaskTab(sp.tab) ? sp.tab : "activity";

  const [task, openExc, stageHistoryForStepper, positions, attachmentCountRes] = await Promise.all([
    getTaskSummary(session.orgId, id),
    supabaseAdmin
      .from("exceptions")
      .select("id")
      .eq("task_id", id)
      .is("resolved_at", null)
      .limit(1),
    // §TASK-INFO-1 — per-stage dwell time displayed inline on each
    // completed stage chip. The DB trigger tg_task_stage_history
    // (migration 0007) writes one row per stage transition; we sum
    // duration_seconds by `to_stage` and let the client format the
    // result. Tasks with no history pre-dating the trigger fall back to
    // showing only the current stage's running timer.
    supabaseAdmin
      .from("task_stage_history")
      .select("to_stage, duration_seconds")
      .eq("organization_id", session.orgId)
      .eq("task_id", id),
    listPositions(session.orgId),
    supabaseAdmin
      .from("task_attachments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.orgId)
      .eq("task_id", id),
  ]);
  if (!task) notFound();
  const positionNameBySlug = new Map(positions.map((p) => [p.slug, p.name]));
  const positionRoleBySlug: Record<string, string> = Object.fromEntries(
    positions.map((p) => [p.slug, p.role]),
  );
  const hasOpenException = (openExc ?? []).length > 0;
  const canOpenException = hasPermission(session, "exception.open");

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
      position: string | null;
      department_name: string | null;
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
      const dept = (e as { department?: { id: string; name: string } | { id: string; name: string }[] | null }).department;
      const deptObj = Array.isArray(dept) ? dept[0] : dept;
      out.push({
        id: e.id,
        full_name: e.full_name,
        job_title: e.job_title ?? null,
        position: (e as { position?: string | null }).position ?? null,
        department_name: deptObj?.name ?? null,
        avatar_url: e.avatar_url ?? null,
        role_types: [ta.role_type as TaskRoleType],
      });
    }
    return out;
  })();

  const taskTags = (
    (task as {
      task_tag_assignments?: Array<{
        tag:
          | { id: string; name: string; color: number }
          | { id: string; name: string; color: number }[]
          | null;
      }>;
    }).task_tag_assignments ?? []
  )
    .map((row) => (Array.isArray(row.tag) ? row.tag[0] : row.tag))
    .filter((x): x is { id: string; name: string; color: number } => Boolean(x));

  const project = Array.isArray(task.project) ? task.project[0] : task.project;
  const deadline = task.planned_date ?? task.due_date;

  // §TASK-INFO-3: at minimum the action bar shows the "All Documents"
  // smart-button. Pulling the count here is cheap (one head/count) and lets
  // the action bar render synchronously without a Suspense boundary inside
  // the breadcrumb row.
  const attachmentCount = attachmentCountRes.count ?? 0;
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

  const taskActionSmartPills: SmartPill[] = [
    ...(project
      ? [
          {
            key: "project",
            label: t("breadcrumbs.tasks"),
            value: project.name,
            icon: <Folder className="size-3.5" />,
            href: `/projects/${project.id}`,
          } satisfies SmartPill,
        ]
      : []),
    {
      key: "documents",
      label: t("smartButtons.documents"),
      value: String(attachmentCount),
      icon: <FileText className="size-3.5" />,
      href: `/tasks/${task.id}?tab=documents`,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ActionBar
        moduleLabel={t("breadcrumbs.tasks")}
        moduleHref="/tasks"
        recordName={task.title}
        recordCode={(task as { task_code?: string | null }).task_code ?? null}
        recordId={task.id}
        recordKind="tasks"
        smartPills={taskActionSmartPills}
      />

      <div className="mb-6">
        <StageStepper
          taskId={task.id}
          currentStage={task.stage as TaskStage}
          stageEnteredAt={task.stage_entered_at ?? null}
          stageDwellSeconds={(() => {
            const m: Record<string, number> = {};
            for (const row of (stageHistoryForStepper.data ?? []) as Array<{
              to_stage: string;
              duration_seconds: number | null;
            }>) {
              if (typeof row.duration_seconds === "number") {
                m[row.to_stage] = (m[row.to_stage] ?? 0) + row.duration_seconds;
              }
            }
            return m;
          })()}
        />
      </div>

      {/* Odoo-style form header — ★ favorite, project/code line, title, and
          the kanban-state button on the right. No badges/stat panel: stage
          lives in the pipeline bar above, the rest in the field grid below. */}
      <div className="mb-6 flex items-start justify-between gap-3 rtl:flex-row-reverse">
        <div className="flex min-w-0 items-start gap-2 rtl:flex-row-reverse">
          <TaskStarToggle
            taskId={task.id}
            initialStarred={(task as { is_important?: boolean }).is_important ?? false}
          />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground rtl:flex-row-reverse">
              {project ? (
                <Link
                  href={`/projects/${project.id}`}
                  className="text-cyan transition-colors hover:text-cyan/80 hover:underline"
                >
                  {project.name}
                </Link>
              ) : (
                <span>—</span>
              )}
              {(task as { task_code?: string | null }).task_code && (
                <span className="inline-flex items-center rounded-md bg-soft px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-muted-foreground">
                  {(task as { task_code?: string | null }).task_code}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 rtl:flex-row-reverse">
              <h1 className="text-2xl font-semibold leading-tight text-foreground text-pretty">
                {task.title}
              </h1>
              {/* §TASK-INFO-2 — Odoo's inline "High priority" star. */}
              <TaskPriorityStar
                taskId={task.id}
                initialPriority={(task.priority as "low" | "medium" | "high") ?? "medium"}
              />
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <TaskStatusSelect taskId={task.id} currentStatus={task.status} />
        </div>
      </div>

      <div className="mb-6">
        <TaskFormSection
          task={task}
          assignees={allAssignees.map((a) => ({
            id: a.id,
            full_name: a.full_name,
            avatar_url: a.avatar_url,
          }))}
          tags={taskTags}
          canEditCounts={
            task.created_by === session.userId ||
            hasPermission(session, "tasks.manage") ||
            hasPermission(session, "task.view_all")
          }
          canEditDeadline={
            task.created_by === session.userId ||
            hasPermission(session, "tasks.manage") ||
            hasPermission(session, "task.view_all")
          }
          locale={locale}
        />
      </div>

      <div className="mb-6">
        <Suspense fallback={<div className="h-10" />}>
          <TaskSmartButtonsSection orgId={session.orgId} taskId={task.id} />
        </Suspense>
      </div>

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
                ? t("delayBanner.done", { count: delayDays ?? 0 })
                : t("delayBanner.open", { count: delayDays ?? 0 })}
            </div>
            <p className="mt-0.5 text-[11px] text-cc-red/80">
              {t("delayBanner.description")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mb-6">
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">{t("loading.approvals")}</CardContent></Card>}>
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
        // stage_owner_positions stores a position slug; resolve it to its
        // structural role to find the matching assignee slot.
        const ownerRole = positionRoleBySlug[ownerPosition] ?? ownerPosition;
        const ownerLabel = positionNameBySlug.get(ownerPosition) ?? ownerPosition;
        const STAGE_LABEL: Record<string, string> = {
          new: t("stages.new"),
          in_progress: t("stages.in_progress"),
          manager_review: t("stages.manager_review"),
          specialist_review: t("stages.specialist_review"),
          ready_to_send: t("stages.ready_to_send"),
          sent_to_client: t("stages.sent_to_client"),
          client_changes: t("stages.client_changes"),
          done: t("stages.done"),
        };
        const owner = roleSlots.find(
          (s) => s.role_type === ownerRole,
        )?.employee ?? null;
        return (
          <Card className="mb-6 border-cyan/30 bg-cyan-dim/15">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="grid size-10 place-items-center rounded-full bg-cyan/20 text-cyan">
                ⚡
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("currentStageOwner")}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="rounded-full bg-cyan-dim px-2 py-0.5 text-[11px] font-semibold text-cyan">
                    {STAGE_LABEL[task.stage as string] ?? task.stage}
                  </span>
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <span className="rounded-full bg-soft-1 px-2 py-0.5 text-[11px] font-medium">
                    {ownerLabel}
                  </span>
                </div>
              </div>
              {owner ? (
                <div className="flex items-center gap-2 rounded-xl border border-soft bg-card px-3 py-2">
                  <Avatar className="size-8">
                    {owner.avatar_url ? (
                      <AvatarImage
                        src={owner.avatar_url}
                        fallbackSrc={avatarUrlFor(owner.full_name)}
                        alt={owner.full_name}
                      />
                    ) : null}
                    <AvatarFallback className="bg-cyan/20 text-xs font-semibold text-cyan">
                      {owner.full_name.slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
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
                  {t("noStageOwnerPrefix")} {ownerLabel} {t("noStageOwnerSuffix")}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <SectionTitle
        title={t("sections.assignees.title")}
        description={t("sections.assignees.description")}
        actions={
          task.created_by === session.userId ||
          hasPermission(session, "tasks.manage") ||
          hasPermission(session, "task.view_all") ? (
            <TaskStageOwnerEditor
              taskId={task.id}
              positions={positions.map((p) => ({ slug: p.slug, name: p.name }))}
              initial={
                (task as { stage_owner_positions?: Record<string, string | null> | null })
                  .stage_owner_positions ?? null
              }
            />
          ) : undefined
        }
      />
      <Card className="mb-6">
        <CardContent className="p-4">
          <Suspense fallback={<div className="text-sm text-muted-foreground">{t("loading.assignees")}</div>}>
            <TaskAssigneesSection
              orgId={session.orgId}
              taskId={task.id}
              canManage={
                task.created_by === session.userId ||
                hasPermission(session, "tasks.manage") ||
                hasPermission(session, "task.view_all")
              }
              currentStage={task.stage ?? null}
              stageOwnerPositions={
                (task as { stage_owner_positions?: Record<string, string | null> | null })
                  .stage_owner_positions ?? null
              }
              positionRoleBySlug={positionRoleBySlug}
            />
          </Suspense>
        </CardContent>
      </Card>

      {/* Legacy read-only summary kept for visibility into Odoo-imported
          assignees; the panel above is the authoritative editor. */}
      {false && allAssignees.length > 0 && (
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
                          <span className="truncate font-medium text-foreground/80">
                            {a.job_title}
                          </span>
                        )}
                        {a.department_name && (
                          <span className="truncate" title={a.department_name}>
                            · {a.department_name}
                          </span>
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
        title={t("sections.followers.title")}
        description={t("sections.followers.description")}
      />
      <Card className="mb-6">
        <CardContent className="p-4">
          <Suspense fallback={<div className="text-sm text-muted-foreground">{t("loading.followers")}</div>}>
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
        <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">{t("loading.section")}</CardContent></Card>}>
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
  "description",
  "gantt",
  "timesheets",
  "subtasks",
  "links",
  "extra",
  "history",
  "activity",
  "activities",
  "documents",
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

  // Window functions inside `task_record_pagination` (migration 0086) compute
  // position/total/prev/next directly. Replaces the previous full-sibling-id
  // fetch — which sent up to N uuids over the wire just to walk to the
  // current task's index — with a fixed-size jsonb payload.
  const { data } = await supabaseAdmin.rpc("task_record_pagination", {
    p_org_id: orgId,
    p_project_id: projectId,
    p_task_id: taskId,
  });
  const result = data as
    | { position: number; total: number; prevId: string | null; nextId: string | null }
    | null;
  if (!result) return null;

  return (
    <RecordPagination
      position={result.position}
      total={result.total}
      prevId={result.prevId}
      nextId={result.nextId}
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
  // One RPC instead of six concurrent PostgREST head/count queries; see
  // migration 0086. Halves wall-clock for this Suspense slot (~0.9s → ~0.45s).
  // The attachment count isn't in that RPC yet — one extra head/count query
  // until 0086 is regenerated; cheap and the RPC body is shared with other
  // RPCs whose touch radius we don't want to expand here.
  const [{ data }, attachmentCountResult] = await Promise.all([
    supabaseAdmin.rpc("task_smart_button_counts", {
      p_org_id: orgId,
      p_task_id: taskId,
    }),
    supabaseAdmin
      .from("task_attachments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
  ]);
  const counts = (data ?? {
    subtaskCount: 0,
    outgoingLinks: 0,
    incomingLinks: 0,
    commentCount: 0,
    openActivities: 0,
    timesheetHours: 0,
  }) as {
    subtaskCount: number;
    outgoingLinks: number;
    incomingLinks: number;
    commentCount: number;
    openActivities: number;
    timesheetHours: number | string;
  };

  return (
    <TaskSmartButtons
      subtaskCount={counts.subtaskCount}
      linkCount={counts.outgoingLinks + counts.incomingLinks}
      timesheetHours={Number(counts.timesheetHours) || 0}
      commentCount={counts.commentCount}
      openActivityCount={counts.openActivities}
      attachmentCount={attachmentCountResult.count ?? 0}
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

async function TaskAssigneesSection({
  orgId,
  taskId,
  canManage,
  currentStage,
  stageOwnerPositions,
  positionRoleBySlug,
}: {
  orgId: string;
  taskId: string;
  canManage: boolean;
  currentStage: string | null;
  stageOwnerPositions: Record<string, string | null> | null;
  positionRoleBySlug: Record<string, string>;
}) {
  const [{ data: assigneesRaw }, employees, orgChart] = await Promise.all([
    supabaseAdmin
      .from("task_assignees")
      .select(
        `id, employee_id, role_type, team_manager_employee_id, head_of_dept_employee_id,
         employee:employee_profiles!task_assignees_employee_id_fkey (
           id, full_name, job_title, avatar_url,
           position:positions!employee_profiles_position_id_fkey ( role ),
           department:departments!employee_profiles_department_id_fkey ( name )
         ),
         team_manager:employee_profiles!task_assignees_team_manager_employee_id_fkey (
           id, full_name
         ),
         head_of_dept:employee_profiles!task_assignees_head_of_dept_employee_id_fkey (
           id, full_name
         )`,
      )
      .eq("organization_id", orgId)
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    getEmployees(orgId),
    loadOrgChart(orgId),
  ]);

  type RawRow = {
    id: string;
    employee_id: string;
    role_type: import("./task-assignees-panel").AssigneeRoleType;
    team_manager_employee_id: string | null;
    head_of_dept_employee_id: string | null;
    employee:
      | {
          id: string;
          full_name: string;
          job_title: string | null;
          avatar_url: string | null;
          position: { role: string } | { role: string }[] | null;
          department: { name: string } | { name: string }[] | null;
        }
      | {
          id: string;
          full_name: string;
          job_title: string | null;
          avatar_url: string | null;
          position: { role: string } | { role: string }[] | null;
          department: { name: string } | { name: string }[] | null;
        }[]
      | null;
    team_manager:
      | { id: string; full_name: string }
      | { id: string; full_name: string }[]
      | null;
    head_of_dept:
      | { id: string; full_name: string }
      | { id: string; full_name: string }[]
      | null;
  };

  // Source of truth for the assignee hierarchy — mirrors the three columns on
  // /organization/employees exactly:
  //   Team leader  = employee_profiles.team_leader_employee_id (قائد الفريق).
  //   Head of dept = the employee's department head (رئيس القسم), self-excluded.
  //   المدير (manager_employee_id) is a higher level (manager of the heads) and
  //   is intentionally NOT surfaced on the task card.
  const empById = new Map(orgChart.employees.map((e) => [e.id, e]));

  // رئيس القسم = the employee's OWN department head, mirroring the
  // /organization/employees رئيس القسم column. Excluded when it's the employee
  // themselves (a head has no head). NO walk to a parent department and NO
  // fallback to المدير — those are higher levels, not this person's head.
  function headOfDeptForEmp(empId: string | null): string | null {
    if (!empId) return null;
    const e = empById.get(empId);
    const dept = e?.department_id ? orgChart.byId.get(e.department_id) : null;
    const head = dept?.head_employee_id ?? null;
    return head && head !== empId ? head : null;
  }

  const empHierarchy = new Map<string, { team_leader_id: string | null; head_of_dept_id: string | null }>();
  for (const emp of orgChart.employees) {
    empHierarchy.set(emp.id, {
      // قائد الفريق source of truth = team_leader_employee_id (set on
      // /organization/employees). NO fallback to المدير (manager_employee_id):
      // المدير is the manager of the heads — a separate, higher level. A team
      // leader / head simply has no team leader → field stays empty.
      team_leader_id: emp.team_leader_employee_id,
      head_of_dept_id: headOfDeptForEmp(emp.id),
    });
  }

  const assignees: import("./task-assignees-panel").AssigneeRow[] = (
    (assigneesRaw ?? []) as RawRow[]
  )
    .map((row) => {
      const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
      const mgrRaw = Array.isArray(row.team_manager)
        ? row.team_manager[0]
        : row.team_manager;
      const hodRaw = Array.isArray(row.head_of_dept)
        ? row.head_of_dept[0]
        : row.head_of_dept;
      if (!emp) return null;
      const dept = Array.isArray(emp.department)
        ? emp.department[0]
        : emp.department;
      const pos = Array.isArray(emp.position)
        ? emp.position[0]
        : emp.position;

      // Fall back to org chart values when the stored column is null:
      //   Team leader  = employee_profiles.manager_employee_id
      //   Head of dept = walk dept tree, skip self-references
      // /organization/employees and /organization/departments are the
      // single sources of truth.
      const hier = empHierarchy.get(row.employee_id);
      const resolvedLeaderId = row.team_manager_employee_id ?? hier?.team_leader_id ?? null;
      const resolvedHodId = row.head_of_dept_employee_id ?? hier?.head_of_dept_id ?? null;

      const resolvedMgr = mgrRaw
        ? { id: mgrRaw.id, full_name: mgrRaw.full_name }
        : resolvedLeaderId
          ? (() => { const e = empById.get(resolvedLeaderId); return e ? { id: e.id, full_name: e.full_name } : null; })()
          : null;

      const resolvedHod = hodRaw
        ? { id: hodRaw.id, full_name: hodRaw.full_name }
        : resolvedHodId
          ? (() => { const e = empById.get(resolvedHodId); return e ? { id: e.id, full_name: e.full_name } : null; })()
          : null;

      return {
        id: row.id,
        employee_id: row.employee_id,
        role_type: row.role_type,
        positionRole: pos?.role ?? null,
        team_manager_employee_id: resolvedLeaderId,
        head_of_dept_employee_id: resolvedHodId,
        employee: {
          id: emp.id,
          full_name: emp.full_name,
          job_title: emp.job_title ?? null,
          avatar_url: emp.avatar_url ?? null,
          department_name: dept?.name ?? null,
        },
        team_manager: resolvedMgr,
        head_of_dept: resolvedHod,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const employeeOptions: import("./task-assignees-panel").EmployeeOption[] =
    employees
      .filter((e) => e.employment_status === "active")
      .map((e) => {
        const dept = Array.isArray(e.department) ? e.department[0] : e.department;
        const hier = empHierarchy.get(e.id);
        return {
          id: e.id,
          full_name: e.full_name,
          job_title: e.job_title ?? null,
          avatar_url: e.avatar_url ?? null,
          department_name: dept?.name ?? null,
          default_team_leader_id: hier?.team_leader_id ?? null,
          default_head_of_dept_id: hier?.head_of_dept_id ?? null,
        };
      });

  return (
    <TaskAssigneesPanel
      taskId={taskId}
      assignees={assignees}
      employees={employeeOptions}
      canManage={canManage}
      currentStage={currentStage}
      stageOwnerPositions={stageOwnerPositions}
      positionRoleBySlug={positionRoleBySlug}
    />
  );
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
  // After §8.1 / migration 0101 a follower may identify by employee_id OR
  // user_id. Dedupe inherited rows by either, so we don't show a project
  // follower twice if they're also explicit on the task.
  const explicitKeys = new Set<string>();
  for (const f of followers) {
    if (f.employee_id) explicitKeys.add(`emp:${f.employee_id}`);
    if (f.user_id) explicitKeys.add(`user:${f.user_id}`);
  }
  const mergedFollowers = [
    ...followers,
    ...inheritedFollowers.filter(
      (f) =>
        !(f.employee_id && explicitKeys.has(`emp:${f.employee_id}`)) &&
        !(f.user_id && explicitKeys.has(`user:${f.user_id}`)),
    ),
  ];
  const followerCandidateExcludeKeys: string[] = [];
  for (const f of mergedFollowers) {
    if (f.employee_id) followerCandidateExcludeKeys.push(`emp:${f.employee_id}`);
    if (f.user_id) followerCandidateExcludeKeys.push(`user:${f.user_id}`);
  }
  const followerCandidates = await listFollowerCandidates(
    orgId,
    followerCandidateExcludeKeys,
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

function TaskFormSection({
  task,
  assignees,
  tags,
  canEditCounts,
  canEditDeadline,
  locale,
}: {
  task: NonNullable<Awaited<ReturnType<typeof getTaskSummary>>>;
  assignees: Array<{ id: string; full_name: string; avatar_url: string | null }>;
  tags: Array<{ id: string; name: string; color: number }>;
  canEditCounts: boolean;
  canEditDeadline: boolean;
  locale: string;
}) {
  // Renders synchronously from the eager getTaskSummary result the parent
  // already awaited — the previous version did its own getTask() round trip
  // inside the Suspense boundary, which duplicated everything getTaskSummary
  // already had. getTaskSummary now selects all the form-card fields too
  // (see src/lib/data/tasks.ts).
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
    ? formatDateTime(task.completed_at, locale)
    : null;

  return (
    <TaskFormCard
      task={{
        id: task.id,
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
        design_count: (task as { design_count?: number | null }).design_count ?? 0,
        revision_count: (task as { revision_count?: number | null }).revision_count ?? 0,
      }}
      project={project ? { id: project.id, name: project.name } : null}
      client={client ? { id: client.id, name: client.name } : null}
      service={service ? { id: service.id, slug: service.slug, name: service.name } : null}
      assignees={assignees}
      tags={tags}
      computedDelayDays={delayDays}
      overdue={overdue}
      formattedCompletedAt={formattedCompletedAt}
      canEditCounts={canEditCounts}
      canEditDeadline={canEditDeadline}
    />
  );
}

async function TaskTabNav({
  taskId,
  activeTab,
}: {
  taskId: string;
  activeTab: TaskTab;
}) {
  const t = await getTranslations("TaskDetailPage.tabs");
  const tabs: Array<{ key: TaskTab; label: string }> = [
    { key: "description", label: t("description") },
    { key: "gantt", label: t("gantt") },
    { key: "timesheets", label: t("timesheets") },
    { key: "subtasks", label: t("subtasks") },
    { key: "links", label: t("links") },
    { key: "extra", label: t("extra") },
    { key: "history", label: t("history") },
    { key: "activity", label: t("activity") },
    { key: "activities", label: t("activities") },
    { key: "documents", label: t("documents") },
  ];

  return (
    <div className="inline-flex w-fit flex-wrap items-center gap-1 rounded-2xl border border-border bg-card p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/tasks/${taskId}?tab=${tab.key}`}
          // Smart-button hooks: clicking the pill in TaskSmartButtons calls
          // document.querySelector('[data-smart-target=…]')?.click(); without
          // this attribute the click was a no-op.
          data-smart-target={tab.key}
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
  const t = await getTranslations("TaskDetailPage");

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
            <p className="text-xs text-muted-foreground">{t("notLinkedToProject")}</p>
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

  if (activeTab === "documents") {
    // #14 — pull task_attachments AND comment-attached files (uploaded via
    // the chatter). Both share the same table; the comment-attached rows have
    // task_comment_id set. We surface every row that points at this task
    // AND every row attached to any of its sub-tasks (Rwasem-parity —
    // matches their "All Documents" smart-button which aggregates the task
    // plus its sub-tasks).
    const { data: subtasks } = await supabaseAdmin
      .from("tasks")
      .select("id, task_code, title")
      .eq("organization_id", orgId)
      .eq("parent_task_id", taskId);
    const subtaskById = new Map<
      string,
      { task_code: string | null; title: string | null }
    >();
    for (const s of subtasks ?? []) {
      subtaskById.set(s.id as string, {
        task_code: (s.task_code as string | null) ?? null,
        title: (s.title as string | null) ?? null,
      });
    }
    const taskIds = [taskId, ...subtaskById.keys()];
    const { data } = await supabaseAdmin
      .from("task_attachments")
      .select(
        "id, task_id, filename, mimetype, size_bytes, storage_path, source_url, created_at",
      )
      .eq("organization_id", orgId)
      .in("task_id", taskIds)
      .order("created_at", { ascending: false });

    const rows = (data ?? []).map((r) => {
      const rTaskId = r.task_id as string;
      const sub = rTaskId === taskId ? null : subtaskById.get(rTaskId) ?? null;
      return {
        id: r.id as string,
        task_id: rTaskId,
        task_code: sub?.task_code ?? null,
        task_title: sub?.title ?? null,
        filename: r.filename as string,
        mimetype: (r.mimetype as string | null) ?? null,
        size_bytes: (r.size_bytes as number | null) ?? null,
        storage_path: (r.storage_path as string | null) ?? null,
        source_url: (r.source_url as string | null) ?? null,
        created_at: r.created_at as string,
      };
    });

    return (
      <Card>
        <CardContent className="p-4">
          <AttachmentsTab rows={rows} />
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

  if (activeTab === "gantt") {
    return (
      <Card>
        <CardContent className="p-4">
          <TaskGanttDetailPanel orgId={orgId} taskId={taskId} projectId={projectId} />
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "extra") {
    return (
      <Card>
        <CardContent className="p-4">
          <TaskExtraInfoPanel orgId={orgId} taskId={taskId} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={<Card><CardContent className="p-4 text-sm text-muted-foreground">{t("loading.activityFeed")}</CardContent></Card>}>
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

// Sky Light feedback (Rwasem screenshot parity): per-task Gantt slice. Shows
// the task's planned→due window as a single bar plus its dependency neighbors,
// and links out to the full project Gantt. Cheap one-shot read; we only need
// the dates + the link rows.
async function TaskGanttDetailPanel({
  orgId,
  taskId,
  projectId,
}: {
  orgId: string;
  taskId: string;
  projectId: string | null;
}) {
  const t = await getTranslations("TaskDetailPage.gantt");

  if (!projectId) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("noProject")}
      </p>
    );
  }

  const [{ data: thisTask }, { data: outgoing }, { data: incoming }] =
    await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("planned_date, due_date, stage, task_code, title")
        .eq("organization_id", orgId)
        .eq("id", taskId)
        .maybeSingle(),
      supabaseAdmin
        .from("task_links")
        .select(
          "dependency_type, lag_days, target:tasks!task_links_target_task_id_fkey ( id, task_code, title, planned_date, due_date )",
        )
        .eq("organization_id", orgId)
        .eq("source_task_id", taskId),
      supabaseAdmin
        .from("task_links")
        .select(
          "dependency_type, lag_days, source:tasks!task_links_source_task_id_fkey ( id, task_code, title, planned_date, due_date )",
        )
        .eq("organization_id", orgId)
        .eq("target_task_id", taskId),
    ]);

  const start = thisTask?.planned_date ?? thisTask?.due_date ?? null;
  const end = thisTask?.due_date ?? thisTask?.planned_date ?? null;

  type Neighbor = {
    id: string;
    task_code: string | null;
    title: string;
    planned_date: string | null;
    due_date: string | null;
    dependency_type: string;
    lag_days: number;
    direction: "predecessor" | "successor";
  };
  const neighbors: Neighbor[] = [];
  for (const row of (incoming ?? []) as Array<{
    dependency_type: string;
    lag_days: number;
    source: {
      id: string;
      task_code: string | null;
      title: string;
      planned_date: string | null;
      due_date: string | null;
    } | { id: string; task_code: string | null; title: string; planned_date: string | null; due_date: string | null }[] | null;
  }>) {
    const s = Array.isArray(row.source) ? row.source[0] : row.source;
    if (s) neighbors.push({ ...s, dependency_type: row.dependency_type, lag_days: row.lag_days, direction: "predecessor" });
  }
  for (const row of (outgoing ?? []) as Array<{
    dependency_type: string;
    lag_days: number;
    target: {
      id: string;
      task_code: string | null;
      title: string;
      planned_date: string | null;
      due_date: string | null;
    } | { id: string; task_code: string | null; title: string; planned_date: string | null; due_date: string | null }[] | null;
  }>) {
    const t = Array.isArray(row.target) ? row.target[0] : row.target;
    if (t) neighbors.push({ ...t, dependency_type: row.dependency_type, lag_days: row.lag_days, direction: "successor" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {t("summary")}
        </div>
        <Link
          href={`/projects/${projectId}/gantt`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim/30 px-2.5 py-1 text-xs font-medium text-cyan hover:bg-cyan-dim/50 transition-colors"
        >
          {t("openProjectGantt")}
        </Link>
      </div>

      <div className="rounded-xl border border-soft bg-soft-1 p-4">
        <div className="text-xs text-muted-foreground mb-1">{t("currentTask")}</div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-sm font-medium truncate">
            {thisTask?.task_code ? `${thisTask.task_code} · ` : ""}{thisTask?.title}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
            {start ?? "—"} → {end ?? "—"}
          </div>
        </div>
      </div>

      {neighbors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("noDependencies")}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-semibold">{t("dependencyLinks", { count: neighbors.length })}</div>
          <ul className="space-y-1.5">
            {neighbors.map((n, i) => (
              <li
                key={`${n.direction}-${n.id}-${i}`}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-soft bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className={cn(
                    "me-2 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    n.direction === "predecessor" ? "bg-amber-dim text-amber" : "bg-cyan-dim/40 text-cyan",
                  )}>
                    {n.direction === "predecessor" ? t("predecessor") : t("successor")}
                  </span>
                  <Link href={`/tasks/${n.id}`} className="text-xs font-medium hover:text-cyan truncate">
                    {n.task_code ? `${n.task_code} · ` : ""}{n.title}
                  </Link>
                  <span className="ms-2 text-[10px] text-muted-foreground">
                    {n.dependency_type}
                    {n.lag_days ? ` · ${t("lagDays", { count: n.lag_days })}` : ""}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums" dir="ltr">
                  {n.planned_date ?? n.due_date ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Sky Light feedback (Rwasem screenshot parity): "معلومات إضافية" tab. Surfaces
// the metadata that doesn't fit cleanly elsewhere — Odoo source/id, approval
// flags, hold reason, raw progress numbers, audit timestamps.
async function TaskExtraInfoPanel({
  orgId,
  taskId,
}: {
  orgId: string;
  taskId: string;
}) {
  const t = await getTranslations("TaskDetailPage.extra");
  const locale = await getLocale();
  const { data } = await supabaseAdmin
    .from("tasks")
    .select(
      `id, task_code, created_at, updated_at, created_by,
       external_source, external_id,
       approval_required, approval_status, approval_requested_at, approval_decided_at,
       hold_reason, hold_since,
       allocated_time_minutes, progress_percent, expected_progress_percent,
       progress_slip_percent, delay_days, actual_done_date`,
    )
    .eq("organization_id", orgId)
    .eq("id", taskId)
    .maybeSingle();

  if (!data) {
    return <p className="text-xs text-muted-foreground">{t("notFound")}</p>;
  }

  // tasks.created_by → auth.users.id; resolve via employee_profiles.user_id.
  let creatorName: string | null = null;
  if (data.created_by) {
    const { data: emp } = await supabaseAdmin
      .from("employee_profiles")
      .select("full_name")
      .eq("organization_id", orgId)
      .eq("user_id", data.created_by)
      .maybeSingle();
    creatorName = emp?.full_name ?? null;
  }
  const fmt = (v: string | null | undefined) =>
    v ? formatDateTime(v, locale) : "—";
  const fmtNum = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "—" : `${v}${suffix}`;
  const fmtMinutes = (minutes: number | null | undefined) => {
    if (minutes == null || minutes <= 0) return "—";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return t("minutesOnly", { count: mins });
    if (mins === 0) return t("hoursOnly", { count: hours });
    return t("hoursMinutes", { hours, minutes: mins });
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t("taskCode"), value: data.task_code ?? "—" },
    { label: t("createdAt"), value: fmt(data.created_at) },
    { label: t("updatedAt"), value: fmt(data.updated_at) },
    { label: t("createdBy"), value: creatorName ?? "—" },
    {
      label: t("source"),
      value:
        data.external_source === "odoo"
          ? `Odoo · ${data.external_id ?? "—"}`
          : t("localSource"),
    },
    {
      label: t("approvalGate"),
      value: data.approval_required ? `${t("required")} · ${data.approval_status ?? "—"}` : "—",
    },
    {
      label: t("approvalRequestedAt"),
      value: fmt(data.approval_requested_at),
    },
    {
      label: t("approvalDecidedAt"),
      value: fmt(data.approval_decided_at),
    },
    { label: t("holdReason"), value: data.hold_reason ?? "—" },
    { label: t("heldSince"), value: fmt(data.hold_since) },
    {
      label: t("allocatedTime"),
      value: fmtMinutes(data.allocated_time_minutes),
    },
    { label: t("progress"), value: fmtNum(data.progress_percent, "%") },
    { label: t("expectedProgress"), value: fmtNum(data.expected_progress_percent, "%") },
    { label: t("progressVariance"), value: fmtNum(data.progress_slip_percent, "%") },
    { label: t("delayDays"), value: fmtNum(data.delay_days) },
    {
      label: t("actualDoneDate"),
      value: data.actual_done_date ?? "—",
    },
  ];

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between border-b border-soft/50 py-1.5">
          <dt className="text-xs text-muted-foreground">{r.label}</dt>
          <dd className="text-xs text-foreground/90 tabular-nums" dir="auto">
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
