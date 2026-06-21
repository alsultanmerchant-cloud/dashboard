import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskStage } from "@/lib/labels";
import { listMyUploadQueue, type UploadQueueRow } from "@/lib/data/uploads";

// =========================================================================
// Cockpit data — action-centric worklists for the Agent and Team-Lead/Head
// dashboards. Each fetcher returns "what needs you now", scoped to the role.
// Reuses existing per-user surfaces where possible (uploads, activities,
// messages live in their own modules and are imported by the components).
// =========================================================================

const EXECUTOR_ROLES = ["agent", "specialist", "supporting_agent"];
const DAY_MS = 86_400_000;
const STUCK_DAYS = 5;

type RawTask = {
  id: string;
  title: string;
  task_code: string | null;
  stage: TaskStage | string;
  priority: string | null;
  progress_percent: number | null;
  due_date: string | null;
  planned_date: string | null;
  is_overdue: boolean | null;
  stage_entered_at: string | null;
  archived_at: string | null;
  project: { name: string; client: { name: string } | { name: string }[] | null } | { name: string; client: { name: string } | { name: string }[] | null }[] | null;
};

function clientName(p: RawTask["project"]): string | null {
  const proj = one(p);
  if (!proj) return null;
  const c = one((proj as { client?: { name: string } | { name: string }[] | null }).client ?? null);
  return c?.name ?? null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function projectName(p: RawTask["project"]): string | null {
  const proj = one(p);
  return proj?.name ?? null;
}

// ---- Agent: my tasks by urgency ------------------------------------------

export type UrgencyBucket = "overdue" | "today" | "upcoming";
export interface MyTaskItem {
  id: string;
  title: string;
  taskCode: string | null;
  stage: string;
  priority: string | null;
  progressPercent: number | null;
  projectName: string | null;
  clientName: string | null;
  dueDate: string | null;
  bucket: UrgencyBucket;
}
export interface MyWork {
  overdue: MyTaskItem[];
  today: MyTaskItem[];
  upcoming: MyTaskItem[];
  // Snapshot counts power the Work-Snapshot tiles. `open` is every non-done
  // task assigned to me; `overdue`/`today` are subsets of it; `dueWeek` counts
  // tasks due within the next 7 days (today inclusive); `activeProjects` is the
  // distinct project count across my open tasks.
  counts: {
    overdue: number;
    today: number;
    upcoming: number;
    open: number;
    dueWeek: number;
    activeProjects: number;
  };
}

async function _getMyWork(orgId: string, employeeId: string): Promise<MyWork> {
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "task:tasks!inner(id, title, task_code, stage, priority, progress_percent, due_date, planned_date, is_overdue, stage_entered_at, archived_at, project_id, project:projects(name, client:clients(name)))",
      )
      .eq("organization_id", orgId)
      .in("role_type", EXECUTOR_ROLES)
      .eq("employee_id", employeeId)
      .neq("task.stage", "done")
      .is("task.archived_at", null);
  if (error) throw error;

  const todayStr = new Date().toISOString().slice(0, 10);
  const weekEndStr = new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10);
  const items: MyTaskItem[] = [];
  const seen = new Set<string>();
  const projectIds = new Set<string>();
  let dueWeek = 0;
  for (const row of (data ?? []) as unknown as { task: (RawTask & { project_id?: string | null }) | (RawTask & { project_id?: string | null })[] | null }[]) {
    const t = one(row.task) as (RawTask & { project_id?: string | null }) | null;
    if (!t || t.archived_at || t.stage === "done" || seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.project_id) projectIds.add(t.project_id);
    const due = t.due_date ?? t.planned_date;
    let bucket: UrgencyBucket;
    if (t.is_overdue || (due && due < todayStr)) bucket = "overdue";
    else if (due && due === todayStr) bucket = "today";
    else bucket = "upcoming";
    // "This week" = due in [today, today+7]. Independent of bucket so it can
    // include today's items but excludes already-overdue ones.
    if (due && due >= todayStr && due <= weekEndStr) dueWeek += 1;
    items.push({
      id: t.id,
      title: t.title,
      taskCode: t.task_code,
      stage: t.stage,
      priority: t.priority,
      progressPercent: t.progress_percent,
      projectName: projectName(t.project),
      clientName: clientName(t.project),
      dueDate: due,
      bucket,
    });
  }

  const byDue = (a: MyTaskItem, b: MyTaskItem) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
  const overdue = items.filter((i) => i.bucket === "overdue").sort(byDue);
  const today = items.filter((i) => i.bucket === "today").sort(byDue);
  const upcoming = items.filter((i) => i.bucket === "upcoming").sort(byDue);
  return {
    overdue,
    today,
    upcoming: upcoming.slice(0, 12),
    counts: {
      overdue: overdue.length,
      today: today.length,
      upcoming: upcoming.length,
      open: items.length,
      dueWeek,
      activeProjects: projectIds.size,
    },
  };
}
export const getMyWork = cache(_getMyWork);

// ---- Agent: mentions awaiting my reply -----------------------------------

export interface MentionItem {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  body: string | null;
  createdAt: string;
}

async function _getMyMentions(orgId: string, employeeId: string): Promise<MentionItem[]> {
  const { data, error } = await supabaseAdmin
    .from("task_mentions")
    .select(
      "id, created_at, comment:task_comments(body, created_at, task:tasks(id, title))",
    )
    .eq("organization_id", orgId)
    .eq("mentioned_employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data ?? []).map((m) => {
    const c = one(m.comment as unknown as { body: string; created_at: string; task: { id: string; title: string } | { id: string; title: string }[] | null } | null);
    const task = one(c?.task ?? null);
    return {
      id: m.id,
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
      body: c?.body ?? null,
      createdAt: m.created_at,
    };
  });
}
export const getMyMentions = cache(_getMyMentions);

// ---- Agent: unread chats -------------------------------------------------

export interface ChatSummary {
  unreadTotal: number;
  latest: { fromName: string; body: string; at: string }[];
}

async function _getMyChats(orgId: string, employeeId: string): Promise<ChatSummary> {
  const { data, error } = await supabaseAdmin
    .from("direct_messages")
    .select("sender_employee_id, body, created_at, read_at, sender:employee_profiles!direct_messages_sender_employee_id_fkey(full_name)")
    .eq("organization_id", orgId)
    .eq("recipient_employee_id", employeeId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  return {
    unreadTotal: rows.length,
    latest: rows.slice(0, 5).map((r) => ({
      fromName: one(r.sender as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "—",
      body: r.body ?? "",
      at: r.created_at,
    })),
  };
}
export const getMyChats = cache(_getMyChats);

// ---- Lead: my review queue (manager_review awaiting me) ------------------

export interface ReviewItem {
  id: string;
  title: string;
  taskCode: string | null;
  stage?: string;
  projectName: string | null;
  enteredAt: string | null;
  hoursWaiting: number;
  breachedSla: boolean;
  approvalPending: boolean;
}

async function _getMyReviewQueue(orgId: string, employeeId: string): Promise<ReviewItem[]> {
  const [{ data, error }, { data: sla }] = await Promise.all([
    supabaseAdmin
      .from("task_assignees")
      .select(
        "task:tasks!inner(id, title, task_code, stage, stage_entered_at, archived_at, approval_status, approval_required, project:projects(name))",
      )
      .eq("organization_id", orgId)
      .eq("role_type", "manager")
      .eq("employee_id", employeeId)
      .eq("task.stage", "manager_review"),
    supabaseAdmin
      .from("sla_rules")
      .select("max_minutes")
      .eq("organization_id", orgId)
      .eq("stage_key", "manager_review")
      .maybeSingle(),
  ]);
  if (error) throw error;
  const slaMin = sla?.max_minutes ?? null;
  const now = Date.now();

  const items: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as unknown as { task: (RawTask & { approval_status?: string; approval_required?: boolean }) | (RawTask & { approval_status?: string })[] | null }[]) {
    const t = one(row.task) as (RawTask & { approval_status?: string; approval_required?: boolean }) | null;
    if (!t || t.archived_at || seen.has(t.id)) continue;
    seen.add(t.id);
    const entered = t.stage_entered_at ? new Date(t.stage_entered_at).getTime() : now;
    const mins = (now - entered) / 60000;
    items.push({
      id: t.id,
      title: t.title,
      taskCode: t.task_code,
      projectName: projectName(t.project),
      enteredAt: t.stage_entered_at,
      hoursWaiting: Math.round((mins / 60) * 10) / 10,
      breachedSla: slaMin != null && mins > slaMin,
      approvalPending: t.approval_required === true && t.approval_status === "pending",
    });
  }
  return items.sort((a, b) => (a.enteredAt ?? "") < (b.enteredAt ?? "") ? -1 : 1);
}
export const getMyReviewQueue = cache(_getMyReviewQueue);

// ---- Agent: "Action Required" — needs me NOW -----------------------------
// Three buckets per the Agent-Dashboard spec, all scoped to the employee:
//   1. needsUpload   — upload/delivery deadlines due today or already overdue
//                      (only specialists have an upload step → role-gated).
//   2. stuckInReview — tasks sitting in a review stage *I* own (manager →
//                      manager_review, specialist → specialist_review).
//   3. slaBreaches   — tasks that blew past the SLA of their CURRENT stage,
//                      where that stage is one I'm responsible for.
// `flags` lets the UI hide sub-sections that don't apply to the role.

// Which assignee role_type is responsible for a task while it sits in a given
// stage. Mirrors ROLE_STAGES in accountability.ts (agents execute, managers
// review manager_review, specialists review specialist_review, account
// managers handle the client-facing handoff). Review stages are handled by
// REVIEW_STAGE_BY_ROLE below so slaBreaches and stuckInReview don't double-count.
const STAGE_OWNER_ROLES: Record<string, string[]> = {
  new: ["agent", "specialist", "supporting_agent"],
  in_progress: ["agent", "specialist", "supporting_agent"],
  manager_review: ["manager"],
  specialist_review: ["specialist"],
  ready_to_send: ["account_manager"],
  sent_to_client: ["account_manager"],
  client_changes: ["agent", "specialist", "supporting_agent"],
};
// The review stage each reviewer role is expected to clear.
const REVIEW_STAGE_BY_ROLE: Record<string, string> = {
  manager: "manager_review",
  specialist: "specialist_review",
};
const REVIEW_STAGES = new Set(Object.values(REVIEW_STAGE_BY_ROLE));

export interface SlaBreachItem {
  id: string;
  title: string;
  taskCode: string | null;
  stage: string;
  projectName: string | null;
  enteredAt: string | null;
  hoursOver: number; // hours beyond the stage SLA
  myRole: string;
}

export interface ActionRequired {
  needsUpload: UploadQueueRow[];
  stuckInReview: ReviewItem[];
  slaBreaches: SlaBreachItem[];
  flags: { hasUploadRole: boolean; hasReviewRole: boolean };
}

type ActionTask = RawTask & { project_id?: string | null };

async function _getActionRequired(orgId: string, employeeId: string): Promise<ActionRequired> {
  const [assigneeRes, slaRes, uploadQueue] = await Promise.all([
    supabaseAdmin
      .from("task_assignees")
      .select(
        "role_type, task:tasks!inner(id, title, task_code, stage, priority, progress_percent, due_date, planned_date, is_overdue, stage_entered_at, archived_at, project_id, project:projects(name))",
      )
      .eq("organization_id", orgId)
      .eq("employee_id", employeeId)
      .neq("task.stage", "done")
      .is("task.archived_at", null),
    supabaseAdmin.from("sla_rules").select("stage_key, max_minutes").eq("organization_id", orgId),
    // Specialist upload queue — empty (and role flag false) for non-specialists.
    listMyUploadQueue(orgId, employeeId),
  ]);
  if (assigneeRes.error) throw assigneeRes.error;
  if (slaRes.error) throw slaRes.error;

  const slaByStage = new Map<string, number>();
  for (const r of slaRes.data ?? []) slaByStage.set(r.stage_key as string, r.max_minutes as number);

  const now = Date.now();
  const rows = (assigneeRes.data ?? []) as unknown as { role_type: string; task: ActionTask | ActionTask[] | null }[];

  let hasUploadRole = false;
  let hasReviewRole = false;
  const stuckSeen = new Set<string>();
  const breachSeen = new Set<string>();
  const stuckInReview: ReviewItem[] = [];
  const slaBreaches: SlaBreachItem[] = [];

  for (const row of rows) {
    const t = one(row.task);
    const role = row.role_type;
    if (role === "specialist") hasUploadRole = true;
    if (REVIEW_STAGE_BY_ROLE[role]) hasReviewRole = true;
    if (!t || t.archived_at || t.stage === "done") continue;

    const enteredMs = t.stage_entered_at ? new Date(t.stage_entered_at).getTime() : now;
    const dwellMin = (now - enteredMs) / 60000;
    const slaMin = slaByStage.get(t.stage) ?? null;

    // (2) Stuck in a review stage I own.
    if (REVIEW_STAGE_BY_ROLE[role] === t.stage && !stuckSeen.has(t.id)) {
      stuckSeen.add(t.id);
      stuckInReview.push({
        id: t.id,
        title: t.title,
        taskCode: t.task_code,
        stage: t.stage,
        projectName: projectName(t.project),
        enteredAt: t.stage_entered_at,
        hoursWaiting: Math.round((dwellMin / 60) * 10) / 10,
        breachedSla: slaMin != null && dwellMin > slaMin,
        approvalPending: false,
      });
      continue; // review-stage breaches surface in stuckInReview, not slaBreaches
    }

    // (3) SLA breach in a non-review stage I own.
    if (
      !REVIEW_STAGES.has(t.stage) &&
      (STAGE_OWNER_ROLES[t.stage] ?? []).includes(role) &&
      slaMin != null &&
      dwellMin > slaMin &&
      !breachSeen.has(t.id)
    ) {
      breachSeen.add(t.id);
      slaBreaches.push({
        id: t.id,
        title: t.title,
        taskCode: t.task_code,
        stage: t.stage,
        projectName: projectName(t.project),
        enteredAt: t.stage_entered_at,
        hoursOver: Math.round(((dwellMin - slaMin) / 60) * 10) / 10,
        myRole: role,
      });
    }
  }

  const byEntered = <T extends { enteredAt: string | null }>(a: T, b: T) =>
    (a.enteredAt ?? "") < (b.enteredAt ?? "") ? -1 : 1;
  stuckInReview.sort(byEntered);
  slaBreaches.sort((a, b) => b.hoursOver - a.hoursOver);

  const needsUpload = uploadQueue.filter((r) => r.bucket === "overdue" || r.bucket === "today");

  return { needsUpload, stuckInReview, slaBreaches, flags: { hasUploadRole, hasReviewRole } };
}
export const getActionRequired = cache(_getActionRequired);

// ---- Lead: team blockers needing intervention ----------------------------

export interface BlockerItem {
  id: string;
  title: string;
  taskCode: string | null;
  stage: string;
  priority: string | null;
  progressPercent: number | null;
  assigneeName: string;
  reason: "overdue" | "idle";
  idleDays: number | null;
}

async function _getTeamBlockers(orgId: string, memberEmployeeIds: string[]): Promise<BlockerItem[]> {
  if (memberEmployeeIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "employee:employee_profiles!task_assignees_employee_id_fkey(full_name), task:tasks!inner(id, title, task_code, stage, priority, progress_percent, is_overdue, stage_entered_at, archived_at)",
    )
    .eq("organization_id", orgId)
    .in("role_type", EXECUTOR_ROLES)
    .in("employee_id", memberEmployeeIds);
  if (error) throw error;

  const now = Date.now();
  const items: BlockerItem[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as unknown as { employee: { full_name: string } | { full_name: string }[] | null; task: RawTask | RawTask[] | null }[]) {
    const t = one(row.task);
    if (!t || t.archived_at || t.stage === "done" || seen.has(t.id)) continue;
    const idleDays = t.stage_entered_at ? Math.floor((now - new Date(t.stage_entered_at).getTime()) / DAY_MS) : 0;
    const isOverdue = !!t.is_overdue;
    const isIdle = idleDays >= STUCK_DAYS;
    if (!isOverdue && !isIdle) continue;
    seen.add(t.id);
    items.push({
      id: t.id,
      title: t.title,
      taskCode: t.task_code,
      stage: t.stage,
      priority: t.priority,
      progressPercent: t.progress_percent,
      assigneeName: one(row.employee)?.full_name ?? "—",
      reason: isOverdue ? "overdue" : "idle",
      idleDays: isIdle ? idleDays : null,
    });
  }
  return items
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0))
    .slice(0, 15);
}
export const getTeamBlockers = cache(_getTeamBlockers);

// ---- Lead: escalations raised to me --------------------------------------

export interface EscalationToMe {
  id: string;
  taskId: string;
  taskTitle: string | null;
  level: number;
  raisedAt: string;
}

async function _getEscalationsToMe(orgId: string, userId: string): Promise<EscalationToMe[]> {
  const { data, error } = await supabaseAdmin
    .from("escalations")
    .select("id, task_id, level, raised_at, task:tasks(id, title)")
    .eq("organization_id", orgId)
    .eq("raised_to_user_id", userId)
    .eq("status", "open")
    .order("raised_at", { ascending: true })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id,
    taskId: e.task_id,
    taskTitle: one(e.task as { id: string; title: string } | { id: string; title: string }[] | null)?.title ?? null,
    level: e.level ?? 1,
    raisedAt: e.raised_at,
  }));
}
export const getEscalationsToMe = cache(_getEscalationsToMe);
