import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskStage } from "@/lib/labels";

// =========================================================================
// Department / Team-Leader dashboard data layer.
// Scoped to a set of member employee ids (the leader's team / dept), in
// contrast to the org-wide executive layer. Mirrors executive.ts patterns:
// `cache()`-wrapped fetchers, supabaseAdmin, in-memory aggregation.
//
// The `scope` object is produced by getDashboardScope() in auth-server.ts and
// is stable (reference-equal) within a request, so passing it through React
// `cache()` dedupes correctly.
//
// Data caveats (project memory — Odoo-synced gaps): allocated_time_minutes /
// timesheets are sparse → capacity uses open-task COUNT, not hours. Several
// metrics degrade to `null` (rendered as "—") when their source is empty.
// =========================================================================

export type DeptScope = {
  orgId: string;
  departmentId: string | null;
  memberEmployeeIds: string[];
};

type TaskRow = {
  id: string;
  stage: TaskStage | string;
  is_overdue: boolean | null;
  delay_days: number | null;
  completed_at: string | null;
  due_date: string | null;
  planned_date: string | null;
  actual_done_date: string | null;
  stage_entered_at: string | null;
  created_at: string | null;
  revision_count: number | null;
  design_count: number | null;
  parent_task_id: string | null;
  project_id: string | null;
  archived_at: string | null;
};

type TeamTask = TaskRow & { employeeId: string };

const DAY_MS = 86_400_000;
const STUCK_DAYS = 5; // open task with no stage movement for ≥5 days = idle

function isOpen(stage: string): boolean {
  return stage !== "done";
}

function onTime(t: TaskRow): boolean | null {
  const planned = t.due_date ?? t.planned_date;
  if (!planned || !t.completed_at) return null;
  return new Date(t.completed_at).toISOString().slice(0, 10) <= planned;
}

// ---- Shared team-task fetch (one round-trip, reused by many fetchers) -----

async function _getTeamTasks(scope: DeptScope): Promise<TeamTask[]> {
  if (scope.memberEmployeeIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "employee_id, task:tasks!inner(id, stage, is_overdue, delay_days, completed_at, due_date, planned_date, actual_done_date, stage_entered_at, created_at, revision_count, design_count, parent_task_id, project_id, archived_at)",
    )
    .eq("organization_id", scope.orgId)
    .eq("role_type", "agent")
    .in("employee_id", scope.memberEmployeeIds);
  if (error) throw error;

  type Raw = { employee_id: string; task: TaskRow | TaskRow[] | null };
  const out: TeamTask[] = [];
  for (const raw of (data ?? []) as unknown as Raw[]) {
    const t = Array.isArray(raw.task) ? raw.task[0] : raw.task;
    if (!t || t.archived_at) continue;
    out.push({ ...t, employeeId: raw.employee_id });
  }
  return out;
}

export const getTeamTasks = cache(_getTeamTasks);

// ---- Department task counts ----------------------------------------------

export interface DeptTaskCounts {
  activeProjects: number;
  open: number;
  completed: number;
  overdue: number;
  atRisk: number;
}

async function _getDepartmentTaskCounts(scope: DeptScope): Promise<DeptTaskCounts> {
  const tasks = await getTeamTasks(scope);
  const now = Date.now();
  let open = 0;
  let completed = 0;
  let overdue = 0;
  let atRisk = 0;
  const projects = new Set<string>();

  for (const t of tasks) {
    if (isOpen(t.stage)) {
      open += 1;
      if (t.project_id) projects.add(t.project_id);
      if (t.is_overdue) {
        overdue += 1;
      } else {
        const planned = t.due_date ?? t.planned_date;
        if (planned) {
          const diff = (new Date(planned).getTime() - now) / DAY_MS;
          if (diff >= 0 && diff <= 3) atRisk += 1;
        }
      }
    } else {
      completed += 1;
    }
  }

  return { activeProjects: projects.size, open, completed, overdue, atRisk };
}

export const getDepartmentTaskCounts = cache(_getDepartmentTaskCounts);

// ---- Department capacity (who's overloaded / free) -----------------------

export interface CapacityRow {
  employeeId: string;
  fullName: string;
  openCount: number;
  overdueCount: number;
  band: "overloaded" | "balanced" | "free";
}

async function _getDepartmentCapacity(scope: DeptScope): Promise<CapacityRow[]> {
  const [tasks, members] = await Promise.all([
    getTeamTasks(scope),
    getMemberProfiles(scope),
  ]);

  const agg = new Map<string, { open: number; overdue: number }>();
  for (const t of tasks) {
    if (!isOpen(t.stage)) continue;
    const cur = agg.get(t.employeeId) ?? { open: 0, overdue: 0 };
    cur.open += 1;
    if (t.is_overdue) cur.overdue += 1;
    agg.set(t.employeeId, cur);
  }

  const rows = members.map((m) => ({
    employeeId: m.id,
    fullName: m.full_name,
    openCount: agg.get(m.id)?.open ?? 0,
    overdueCount: agg.get(m.id)?.overdue ?? 0,
  }));

  const counts = rows.map((r) => r.openCount);
  const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  return rows
    .map((r) => ({
      ...r,
      band:
        r.openCount >= Math.max(mean * 1.25, mean + 2)
          ? ("overloaded" as const)
          : r.openCount <= Math.max(1, mean * 0.4)
            ? ("free" as const)
            : ("balanced" as const),
    }))
    .sort((a, b) => b.openCount - a.openCount);
}

export const getDepartmentCapacity = cache(_getDepartmentCapacity);

// ---- Stuck stages + idle tasks -------------------------------------------

export interface StuckStageInfo {
  mostStuckStage: { stage: string; count: number; avgDays: number } | null;
  idleTasks: { taskId: string; stage: string; idleDays: number }[];
}

async function _getDepartmentStuckStages(scope: DeptScope): Promise<StuckStageInfo> {
  const tasks = await getTeamTasks(scope);
  const now = Date.now();
  const byStage = new Map<string, { count: number; totalDays: number }>();
  const idle: { taskId: string; stage: string; idleDays: number }[] = [];

  for (const t of tasks) {
    if (!isOpen(t.stage)) continue;
    const enteredAt = t.stage_entered_at ? new Date(t.stage_entered_at).getTime() : null;
    const days = enteredAt ? (now - enteredAt) / DAY_MS : 0;
    const cur = byStage.get(t.stage) ?? { count: 0, totalDays: 0 };
    cur.count += 1;
    cur.totalDays += days;
    byStage.set(t.stage, cur);
    if (days >= STUCK_DAYS) {
      idle.push({ taskId: t.id, stage: t.stage, idleDays: Math.round(days) });
    }
  }

  let most: StuckStageInfo["mostStuckStage"] = null;
  let worstScore = -1;
  for (const [stage, v] of byStage) {
    const avg = v.totalDays / v.count;
    const score = v.count * Math.max(avg, 1);
    if (score > worstScore) {
      worstScore = score;
      most = { stage, count: v.count, avgDays: Math.round(avg * 10) / 10 };
    }
  }

  idle.sort((a, b) => b.idleDays - a.idleDays);
  return { mostStuckStage: most, idleTasks: idle.slice(0, 8) };
}

export const getDepartmentStuckStages = cache(_getDepartmentStuckStages);

// ---- Subtask upload-delay rate -------------------------------------------

export interface SubtaskUploadStats {
  rate: number | null; // % of subtasks uploaded late; null when N/A
  late: number;
  total: number;
}

async function _getDepartmentSubtaskUploadDelay(scope: DeptScope): Promise<SubtaskUploadStats> {
  const tasks = await getTeamTasks(scope);
  let total = 0;
  let late = 0;
  for (const t of tasks) {
    if (!t.parent_task_id) continue; // subtasks only
    const planned = t.planned_date ?? t.due_date;
    if (!planned) continue; // no deadline → can't judge
    total += 1;
    const done = t.actual_done_date ?? (t.completed_at ? t.completed_at.slice(0, 10) : null);
    if (t.is_overdue || (done && done > planned)) late += 1;
  }
  return {
    rate: total === 0 ? null : Math.round((100 * late) / total),
    late,
    total,
  };
}

export const getDepartmentSubtaskUploadDelay = cache(_getDepartmentSubtaskUploadDelay);

// ---- Department escalations (existing system; smart layer is phased) -----

export interface DeptEscalationRow {
  id: string;
  taskId: string | null;
  level: number;
  status: string;
  raisedAt: string;
}

async function _getDepartmentEscalations(scope: DeptScope): Promise<DeptEscalationRow[]> {
  const tasks = await getTeamTasks(scope);
  const taskIds = Array.from(new Set(tasks.map((t) => t.id)));
  if (taskIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("escalations")
    .select("id, task_id, level, status, raised_at")
    .eq("organization_id", scope.orgId)
    .in("task_id", taskIds)
    .order("raised_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id,
    taskId: e.task_id,
    level: e.level ?? 0,
    status: e.status ?? "open",
    raisedAt: e.raised_at,
  }));
}

export const getDepartmentEscalations = cache(_getDepartmentEscalations);

// ---- Department quality / productivity / on-time scores ------------------

export interface DeptScores {
  onTimePct: number | null;
  avgRevisions: number | null;
  completed30d: number;
  overdueRate: number | null;
}

async function _getDepartmentScores(scope: DeptScope): Promise<DeptScores> {
  const tasks = await getTeamTasks(scope);
  const cutoff = Date.now() - 30 * DAY_MS;

  let doneDecided = 0;
  let doneOnTime = 0;
  let completed30d = 0;
  let revSum = 0;
  let revCount = 0;
  let open = 0;
  let overdue = 0;

  for (const t of tasks) {
    if (isOpen(t.stage)) {
      open += 1;
      if (t.is_overdue) overdue += 1;
    } else {
      if (t.completed_at && new Date(t.completed_at).getTime() >= cutoff) completed30d += 1;
      const ot = onTime(t);
      if (ot !== null) {
        doneDecided += 1;
        if (ot) doneOnTime += 1;
      }
    }
    if (t.revision_count != null) {
      revSum += t.revision_count;
      revCount += 1;
    }
  }

  return {
    onTimePct: doneDecided === 0 ? null : Math.round((100 * doneOnTime) / doneDecided),
    avgRevisions: revCount === 0 ? null : Math.round((revSum / revCount) * 10) / 10,
    completed30d,
    overdueRate: open === 0 ? null : Math.round((100 * overdue) / open),
  };
}

export const getDepartmentScores = cache(_getDepartmentScores);

// ---- Member profiles + team roster (warnings / leave / delays) -----------

type MemberProfile = {
  id: string;
  full_name: string;
  job_title: string | null;
  employment_status: string | null;
};

async function _getMemberProfiles(scope: DeptScope): Promise<MemberProfile[]> {
  if (scope.memberEmployeeIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, job_title, employment_status")
    .in("id", scope.memberEmployeeIds)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MemberProfile[];
}

export const getMemberProfiles = cache(_getMemberProfiles);

export interface DeptTeamSummary {
  memberCount: number;
  totalOverdue: number;
  openWarnings: number;
  pendingLeaves: number;
}

async function _getDepartmentTeamSummary(scope: DeptScope): Promise<DeptTeamSummary> {
  const ids = scope.memberEmployeeIds;
  if (ids.length === 0) {
    return { memberCount: 0, totalOverdue: 0, openWarnings: 0, pendingLeaves: 0 };
  }

  const [tasks, warnings, leaves] = await Promise.all([
    getTeamTasks(scope),
    supabaseAdmin
      .from("employee_warnings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", scope.orgId)
      .in("employee_profile_id", ids)
      .is("acknowledged_at", null),
    supabaseAdmin
      .from("leaves")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", scope.orgId)
      .in("employee_profile_id", ids)
      .eq("status", "pending"),
  ]);

  const totalOverdue = tasks.filter((t) => isOpen(t.stage) && t.is_overdue).length;

  return {
    memberCount: ids.length,
    totalOverdue,
    openWarnings: warnings.count ?? 0,
    pendingLeaves: leaves.count ?? 0,
  };
}

export const getDepartmentTeamSummary = cache(_getDepartmentTeamSummary);

// ---- Per-employee performance --------------------------------------------

export interface EmployeePerfRow {
  employeeId: string;
  fullName: string;
  jobTitle: string | null;
  // attendance (N/A when no records)
  presentDays: number | null;
  lateDays: number | null;
  warnings: number;
  pendingRequests: number;
  projects: number;
  assigned: number;
  completed: number;
  overdue: number;
  avgCompletionHours: number | null;
  onTimePct: number | null;
  lateSubtasks: number;
  lastActivityAt: string | null;
}

async function _getEmployeePerformance(scope: DeptScope): Promise<EmployeePerfRow[]> {
  const ids = scope.memberEmployeeIds;
  if (ids.length === 0) return [];
  const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);

  const [members, tasks, attendance, warnings, leaves] = await Promise.all([
    getMemberProfiles(scope),
    getTeamTasks(scope),
    supabaseAdmin
      .from("attendance_records")
      .select("employee_profile_id, status, late_minutes, work_date")
      .eq("organization_id", scope.orgId)
      .in("employee_profile_id", ids)
      .gte("work_date", since30),
    supabaseAdmin
      .from("employee_warnings")
      .select("employee_profile_id")
      .eq("organization_id", scope.orgId)
      .in("employee_profile_id", ids),
    supabaseAdmin
      .from("leaves")
      .select("employee_profile_id, status")
      .eq("organization_id", scope.orgId)
      .in("employee_profile_id", ids)
      .eq("status", "pending"),
  ]);

  const att = new Map<string, { present: number; late: number }>();
  for (const a of attendance.data ?? []) {
    const cur = att.get(a.employee_profile_id) ?? { present: 0, late: 0 };
    if (a.status !== "absent") cur.present += 1;
    if (a.status === "late" || (a.late_minutes ?? 0) > 0) cur.late += 1;
    att.set(a.employee_profile_id, cur);
  }
  const hasAttendance = (attendance.data ?? []).length > 0;

  const warnCount = new Map<string, number>();
  for (const w of warnings.data ?? []) {
    warnCount.set(w.employee_profile_id, (warnCount.get(w.employee_profile_id) ?? 0) + 1);
  }
  const reqCount = new Map<string, number>();
  for (const l of leaves.data ?? []) {
    reqCount.set(l.employee_profile_id, (reqCount.get(l.employee_profile_id) ?? 0) + 1);
  }

  type Acc = {
    assigned: number;
    completed: number;
    overdue: number;
    projects: Set<string>;
    hoursSum: number;
    hoursCount: number;
    decided: number;
    onTime: number;
    lateSubtasks: number;
    lastActivity: number | null;
  };
  const acc = new Map<string, Acc>();
  const ensure = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        assigned: 0,
        completed: 0,
        overdue: 0,
        projects: new Set(),
        hoursSum: 0,
        hoursCount: 0,
        decided: 0,
        onTime: 0,
        lateSubtasks: 0,
        lastActivity: null,
      };
      acc.set(id, a);
    }
    return a;
  };

  for (const t of tasks) {
    const a = ensure(t.employeeId);
    a.assigned += 1;
    if (t.project_id) a.projects.add(t.project_id);
    const touch = t.stage_entered_at ? new Date(t.stage_entered_at).getTime() : null;
    if (touch && (a.lastActivity === null || touch > a.lastActivity)) a.lastActivity = touch;
    if (isOpen(t.stage)) {
      if (t.is_overdue) a.overdue += 1;
    } else {
      a.completed += 1;
      if (t.completed_at && t.created_at) {
        const h = (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000;
        // Guard against Odoo-synced rows where completed_at predates created_at.
        if (h >= 0) {
          a.hoursSum += h;
          a.hoursCount += 1;
        }
      }
      const ot = onTime(t);
      if (ot !== null) {
        a.decided += 1;
        if (ot) a.onTime += 1;
      }
    }
    if (t.parent_task_id) {
      const planned = t.planned_date ?? t.due_date;
      const done = t.actual_done_date ?? (t.completed_at ? t.completed_at.slice(0, 10) : null);
      if (planned && (t.is_overdue || (done && done > planned))) a.lateSubtasks += 1;
    }
  }

  return members.map((m) => {
    const a = acc.get(m.id);
    const attRow = att.get(m.id);
    return {
      employeeId: m.id,
      fullName: m.full_name,
      jobTitle: m.job_title,
      presentDays: hasAttendance ? (attRow?.present ?? 0) : null,
      lateDays: hasAttendance ? (attRow?.late ?? 0) : null,
      warnings: warnCount.get(m.id) ?? 0,
      pendingRequests: reqCount.get(m.id) ?? 0,
      projects: a?.projects.size ?? 0,
      assigned: a?.assigned ?? 0,
      completed: a?.completed ?? 0,
      overdue: a?.overdue ?? 0,
      avgCompletionHours: a && a.hoursCount > 0 ? Math.round((a.hoursSum / a.hoursCount) * 10) / 10 : null,
      onTimePct: a && a.decided > 0 ? Math.round((100 * a.onTime) / a.decided) : null,
      lateSubtasks: a?.lateSubtasks ?? 0,
      lastActivityAt: a?.lastActivity ? new Date(a.lastActivity).toISOString() : null,
    };
  });
}

export const getEmployeePerformance = cache(_getEmployeePerformance);

// ---- Monthly closing (Head only) -----------------------------------------

export interface MonthlyClosingRow {
  employeeId: string;
  fullName: string;
  completedTasks: number;
  designsCount: number;
  completedProjects: number;
  overdueTasks: number;
  revisionCount: number;
  avgCompletionHours: number | null;
  onTimePct: number | null;
  targetCompletedTasks: number | null;
  achievementPct: number | null;
}

export interface MonthlyClosingResult {
  rows: MonthlyClosingRow[];
  standouts: MonthlyClosingRow[];
  needsFollowUp: MonthlyClosingRow[];
}

async function _getMonthlyClosing(
  orgId: string,
  departmentId: string | null,
  month: string,
): Promise<MonthlyClosingResult> {
  let q = supabaseAdmin
    .from("employee_monthly_closing")
    .select(
      "employee_profile_id, completed_tasks, designs_count, completed_projects, overdue_tasks, revision_count, avg_completion_hours, on_time_pct, target_completed_tasks, achievement_pct, employee:employee_profiles!employee_monthly_closing_employee_profile_id_fkey(full_name)",
    )
    .eq("organization_id", orgId)
    .eq("month", month);
  if (departmentId) q = q.eq("department_id", departmentId);

  const { data, error } = await q;
  if (error) throw error;

  const rows: MonthlyClosingRow[] = (data ?? []).map((r) => {
    const emp = Array.isArray(r.employee) ? r.employee[0] : r.employee;
    return {
      employeeId: r.employee_profile_id,
      fullName: emp?.full_name ?? "—",
      completedTasks: r.completed_tasks ?? 0,
      designsCount: r.designs_count ?? 0,
      completedProjects: r.completed_projects ?? 0,
      overdueTasks: r.overdue_tasks ?? 0,
      revisionCount: r.revision_count ?? 0,
      avgCompletionHours: r.avg_completion_hours,
      onTimePct: r.on_time_pct,
      targetCompletedTasks: r.target_completed_tasks,
      achievementPct: r.achievement_pct,
    };
  });

  rows.sort((a, b) => b.completedTasks - a.completedTasks);

  const standouts = [...rows]
    .filter((r) => (r.achievementPct ?? 0) >= 100 || (r.onTimePct ?? 0) >= 90)
    .slice(0, 3);
  const needsFollowUp = [...rows]
    .filter((r) => r.overdueTasks > 0 || (r.onTimePct != null && r.onTimePct < 60) || (r.achievementPct != null && r.achievementPct < 60))
    .sort((a, b) => b.overdueTasks - a.overdueTasks)
    .slice(0, 3);

  return { rows, standouts, needsFollowUp };
}

export const getMonthlyClosing = cache(_getMonthlyClosing);

async function _getMonthlyClosingMonths(orgId: string, departmentId: string | null): Promise<string[]> {
  let q = supabaseAdmin
    .from("employee_monthly_closing")
    .select("month")
    .eq("organization_id", orgId)
    .order("month", { ascending: false });
  if (departmentId) q = q.eq("department_id", departmentId);
  const { data, error } = await q;
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.month as string)));
}

export const getMonthlyClosingMonths = cache(_getMonthlyClosingMonths);
