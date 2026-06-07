import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskStage } from "@/lib/labels";

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
  counts: { overdue: number; today: number; upcoming: number };
}

async function _getMyWork(orgId: string, employeeId: string): Promise<MyWork> {
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "task:tasks!inner(id, title, task_code, stage, priority, progress_percent, due_date, planned_date, is_overdue, stage_entered_at, archived_at, project:projects(name, client:clients(name)))",
    )
    .eq("organization_id", orgId)
    .in("role_type", EXECUTOR_ROLES)
    .eq("employee_id", employeeId);
  if (error) throw error;

  const todayStr = new Date().toISOString().slice(0, 10);
  const items: MyTaskItem[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as unknown as { task: RawTask | RawTask[] | null }[]) {
    const t = one(row.task);
    if (!t || t.archived_at || t.stage === "done" || seen.has(t.id)) continue;
    seen.add(t.id);
    const due = t.due_date ?? t.planned_date;
    let bucket: UrgencyBucket;
    if (t.is_overdue || (due && due < todayStr)) bucket = "overdue";
    else if (due && due === todayStr) bucket = "today";
    else bucket = "upcoming";
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
    counts: { overdue: overdue.length, today: today.length, upcoming: upcoming.length },
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
