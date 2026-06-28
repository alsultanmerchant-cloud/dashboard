import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isLeadershipPosition } from "@/lib/data/leadership";
import {
  getDashboardOdooMetrics,
  type DashboardOdooMetrics,
} from "@/lib/odoo/live";
import type { TaskStage } from "@/lib/labels";

// =========================================================================
// Executive (/dashboard) data layer.
// One module per page; each fetcher wrapped in React `cache()` so that
// multiple Suspense boundaries reusing the same data hit the source once.
// Live counts come from Odoo (always-fresh via the live helpers); deltas
// and per-client rollups come from Supabase.
// =========================================================================

// ---- Hero KPIs (on-time, overdue, stuck-in-review, revisions) ------------

export interface HeroKpis {
  onTime: { pct: number | null; sample: number };
  overdue: { current: number; weekAgo: number };
  stuckInReview: { current: number };
  revisionVolume: { totalComments30d: number };
}

async function _getHeroKpis(orgId: string): Promise<HeroKpis> {
  const [odooNow, overdueNow, weekAgoOverdue, totalRevision30d] = await Promise.all([
    getDashboardOdooMetrics().catch(() => null),
    countOverdueNow(orgId),
    countOverdueAt(orgId, daysAgoIso(7)),
    countRevisionCommentsSince(orgId, daysAgoIso(30)),
  ]);

  return {
    onTime: {
      pct: odooNow?.onTimePct ?? null,
      sample: odooNow?.onTimeSample ?? 0,
    },
    overdue: {
      current: overdueNow,
      weekAgo: weekAgoOverdue,
    },
    stuckInReview: {
      current: odooNow?.reviewBacklog ?? 0,
    },
    revisionVolume: {
      totalComments30d: totalRevision30d,
    },
  };
}

export const getHeroKpis = cache(_getHeroKpis);

// ---- Client delivery health (top/bottom 5) -------------------------------

export interface ClientHealthRow {
  clientId: string;
  clientName: string;
  activeProjectCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  onTimePct30d: number | null;
  deliveredCount30d: number;
  avgRevisionCount: number;
  totalRevisionComments: number;
  lastActivityAt: string | null;
}

async function _getClientHealth(orgId: string): Promise<{
  worst: ClientHealthRow[];
  best: ClientHealthRow[];
}> {
  const { data, error } = await supabaseAdmin
    .from("v_client_delivery_health")
    .select(
      "client_id, client_name, active_project_count, open_task_count, overdue_task_count, on_time_pct_30d, delivered_count_30d, avg_revision_count, total_revision_comments, last_activity_at",
    )
    .eq("organization_id", orgId)
    .gt("open_task_count", 0);
  if (error) throw error;

  const rows: ClientHealthRow[] = (data ?? []).map((r) => ({
    clientId: r.client_id as string,
    clientName: r.client_name as string,
    activeProjectCount: r.active_project_count as number,
    openTaskCount: r.open_task_count as number,
    overdueTaskCount: r.overdue_task_count as number,
    onTimePct30d: r.on_time_pct_30d === null ? null : Number(r.on_time_pct_30d),
    deliveredCount30d: r.delivered_count_30d as number,
    avgRevisionCount: Number(r.avg_revision_count ?? 0),
    totalRevisionComments: r.total_revision_comments as number,
    lastActivityAt: (r.last_activity_at as string | null) ?? null,
  }));

  // Worst-5 ranking: overdue desc, on-time asc (nulls last), revision volume desc.
  // Best-5: on-time desc among clients with >= 3 deliveries in 30d.
  const worst = [...rows]
    .sort((a, b) => {
      if (b.overdueTaskCount !== a.overdueTaskCount) return b.overdueTaskCount - a.overdueTaskCount;
      const aPct = a.onTimePct30d ?? -1;
      const bPct = b.onTimePct30d ?? -1;
      if (aPct !== bPct) return aPct - bPct;
      return b.totalRevisionComments - a.totalRevisionComments;
    })
    .slice(0, 5);

  const best = [...rows]
    .filter((r) => r.deliveredCount30d >= 3 && r.onTimePct30d !== null)
    .sort((a, b) => (b.onTimePct30d ?? 0) - (a.onTimePct30d ?? 0))
    .slice(0, 5);

  return { worst, best };
}

export const getClientHealth = cache(_getClientHealth);

// ---- Stage funnel (count + dwell per stage) ------------------------------

export const FUNNEL_STAGE_ORDER: TaskStage[] = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
];

export interface FunnelStageRow {
  stage: TaskStage;
  openCount: number;
  overdueCount: number;
  avgDwellHours: number;
}

// Stages excluded from the "where are overdue tasks piling up?" view.
// "new" hasn't started yet; "done" is finished.
const FUNNEL_EXCLUDE = new Set<TaskStage>(["new", "done"]);

async function _getStageFunnel(orgId: string): Promise<FunnelStageRow[]> {
  const [stagesRes, dwellRes] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("stage, is_overdue")
      .eq("organization_id", orgId)
      .is("archived_at", null),
    supabaseAdmin
      .from("task_stage_history")
      .select("to_stage, duration_seconds")
      .eq("organization_id", orgId)
      .not("exited_at", "is", null),
  ]);
  if (stagesRes.error) throw stagesRes.error;
  if (dwellRes.error) throw dwellRes.error;

  const counts = new Map<TaskStage, number>();
  const overdueCounts = new Map<TaskStage, number>();
  for (const r of stagesRes.data ?? []) {
    const s = (r as { stage: TaskStage; is_overdue: boolean }).stage;
    const overdue = (r as { stage: TaskStage; is_overdue: boolean }).is_overdue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
    if (overdue) overdueCounts.set(s, (overdueCounts.get(s) ?? 0) + 1);
  }

  const dwellSums = new Map<TaskStage, { total: number; n: number }>();
  for (const r of dwellRes.data ?? []) {
    const s = (r as { to_stage: TaskStage }).to_stage;
    const d = (r as { duration_seconds: number | null }).duration_seconds ?? 0;
    if (d <= 0) continue;
    const cur = dwellSums.get(s) ?? { total: 0, n: 0 };
    cur.total += d;
    cur.n += 1;
    dwellSums.set(s, cur);
  }

  return FUNNEL_STAGE_ORDER.map((stage) => {
    const d = dwellSums.get(stage);
    return {
      stage,
      openCount: counts.get(stage) ?? 0,
      overdueCount: overdueCounts.get(stage) ?? 0,
      avgDwellHours: d ? d.total / d.n / 3600 : 0,
    };
  });
}

export const getStageFunnel = cache(_getStageFunnel);

// ---- Approval bottlenecks (oldest tasks in each review stage) ------------

export interface BottleneckRow {
  taskId: string;
  title: string;
  projectName: string | null;
  stage: TaskStage;
  enteredAt: string;
  businessHoursInStage: number;
}

async function _getApprovalBottlenecks(orgId: string): Promise<BottleneckRow[]> {
  const { data, error } = await supabaseAdmin
    .from("v_review_backlog")
    .select(
      "task_id, stage, stage_entered_at, business_minutes_in_stage, task:tasks!inner(id, title, project:projects!inner(id, name))",
    )
    .eq("organization_id", orgId)
    .order("business_minutes_in_stage", { ascending: false })
    .limit(6);
  if (error) throw error;

  type Row = {
    task_id: string;
    stage: string;
    stage_entered_at: string;
    business_minutes_in_stage: number;
    task: {
      title: string;
      project: { name: string } | { name: string }[] | null;
    } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const project = Array.isArray(r.task?.project) ? r.task?.project[0] : r.task?.project;
    return {
      taskId: r.task_id,
      title: r.task?.title ?? "—",
      projectName: project?.name ?? null,
      stage: r.stage as TaskStage,
      enteredAt: r.stage_entered_at,
      businessHoursInStage: Math.round(r.business_minutes_in_stage / 60),
    };
  });
}

export const getApprovalBottlenecks = cache(_getApprovalBottlenecks);

// ---- Workflow indicators: review backlog + client changes -----------------
// Two "full indicators" promoted out of the hero row (team feedback 2026-06-28):
// open tasks waiting in a REVIEW stage (specialist_review + manager_review) and
// open tasks in CLIENT-CHANGES. Each carries a count plus how long work is
// waiting — oldest (max days in stage) and average dwell — derived from
// stage_entered_at (which IS populated, unlike delay_days). Rendered as index
// cards next to the executive scores, each drilling to the matching filtered
// task list.

export interface WorkflowIndicator {
  count: number;
  oldestDays: number | null; // longest a task has waited in this stage group
  avgDwellDays: number | null; // mean days-in-stage across the open tasks
}
export interface WorkflowIndicators {
  review: WorkflowIndicator; // specialist_review + manager_review
  clientChanges: WorkflowIndicator; // client_changes
}

const REVIEW_STAGES = ["specialist_review", "manager_review"] as const;

async function _getWorkflowIndicators(orgId: string): Promise<WorkflowIndicators> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("stage, stage_entered_at")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .in("stage", [...REVIEW_STAGES, "client_changes"]);
  if (error) throw error;

  const now = Date.now();
  const summarize = (rows: Array<{ stage_entered_at: string | null }>): WorkflowIndicator => {
    const ages = rows
      .map((r) =>
        r.stage_entered_at ? (now - new Date(r.stage_entered_at).getTime()) / 86_400_000 : null,
      )
      .filter((d): d is number => d !== null && d >= 0);
    return {
      count: rows.length,
      oldestDays: ages.length ? Math.round(Math.max(...ages)) : null,
      avgDwellDays: ages.length
        ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10
        : null,
    };
  };

  const rows = (data ?? []) as Array<{ stage: string; stage_entered_at: string | null }>;
  return {
    review: summarize(rows.filter((r) => (REVIEW_STAGES as readonly string[]).includes(r.stage))),
    clientChanges: summarize(rows.filter((r) => r.stage === "client_changes")),
  };
}

export const getWorkflowIndicators = cache(_getWorkflowIndicators);

// ---- Specialist load (top 8) ---------------------------------------------

export interface SpecialistLoadRow {
  employeeId: string;
  fullName: string;
  openCount: number;
  allocatedHours: number;
}

async function _getSpecialistLoadTop(orgId: string): Promise<SpecialistLoadRow[]> {
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "employee_id, task:tasks!inner(id, stage, allocated_time_minutes, archived_at), employee:employee_profiles!task_assignees_employee_id_fkey(id, full_name, position:positions(role, name))",
    )
    .eq("organization_id", orgId)
    .eq("role_type", "agent");
  if (error) throw error;

  type EmpEmbed = {
    id: string;
    full_name: string;
    position: { role: string | null; name: string | null } | { role: string | null; name: string | null }[] | null;
  };
  type Row = {
    employee_id: string;
    task:
      | { id: string; stage: string; allocated_time_minutes: number | null; archived_at: string | null }
      | { id: string; stage: string; allocated_time_minutes: number | null; archived_at: string | null }[]
      | null;
    employee: EmpEmbed | EmpEmbed[] | null;
  };

  const agg = new Map<string, { name: string; count: number; minutes: number }>();
  for (const raw of ((data ?? []) as unknown as Row[])) {
    const t = Array.isArray(raw.task) ? raw.task[0] : raw.task;
    const e = Array.isArray(raw.employee) ? raw.employee[0] : raw.employee;
    if (!t || !e) continue;
    // Agents-only performance: skip leadership.
    const pos = Array.isArray(e.position) ? e.position[0] : e.position;
    if (isLeadershipPosition(pos)) continue;
    if (t.archived_at) continue;
    if (t.stage === "done") continue;
    const cur = agg.get(e.id) ?? { name: e.full_name, count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += t.allocated_time_minutes ?? 0;
    agg.set(e.id, cur);
  }

  return Array.from(agg.entries())
    .map(([employeeId, v]) => ({
      employeeId,
      fullName: v.name,
      openCount: v.count,
      allocatedHours: Math.round((v.minutes / 60) * 10) / 10,
    }))
    .sort((a, b) => b.openCount - a.openCount)
    .slice(0, 8);
}

export const getSpecialistLoadTop = cache(_getSpecialistLoadTop);

// ---- Department capacity (for SAME-department task rebalancing) -----------
// Redistribution must respect specialty: a Social-Media specialist's overdue
// task can't be handed to an SEO one. So we group agents BY department and only
// surface departments where a within-department rebalance is actually possible
// (someone well above the dept mean AND a same-department peer with room). The
// CEO-brief action plan uses this so it never proposes cross-department moves.
export interface DepartmentCapacityRow {
  department: string;
  overloaded: Array<{ name: string; open: number }>; // notably above dept mean
  available: Array<{ name: string; open: number }>; // same-dept peers with room
}

async function _getDepartmentCapacity(orgId: string): Promise<DepartmentCapacityRow[]> {
  const rosterRes = await supabaseAdmin
    .from("employee_profiles")
    .select(
      "id, full_name, department:departments!employee_profiles_department_id_fkey(name), position:positions(role, name)",
    )
    .eq("organization_id", orgId)
    .eq("employment_status", "active");
  if (rosterRes.error) throw rosterRes.error;

  // Open-task count per agent. Filter to open tasks in the query (inner embed)
  // and PAGINATE — there are more open agent-assignments than PostgREST's
  // 1000-row cap, so a single fetch would silently undercount the load.
  const openByEmp = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("task_assignees")
      .select("employee_id, task:tasks!inner(stage)")
      .eq("organization_id", orgId)
      .eq("role_type", "agent")
      .neq("task.stage", "done")
      .is("task.archived_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ employee_id: string }>) {
      openByEmp.set(r.employee_id, (openByEmp.get(r.employee_id) ?? 0) + 1);
    }
    if (!data || data.length < PAGE) break;
  }

  // Group active, non-leadership agents by department (incl. idle 0-load ones).
  type EmpRow = {
    id: string;
    full_name: string;
    department: { name: string | null } | { name: string | null }[] | null;
    position:
      | { role: string | null; name: string | null }
      | { role: string | null; name: string | null }[]
      | null;
  };
  const byDept = new Map<string, Array<{ name: string; open: number }>>();
  for (const e of (rosterRes.data ?? []) as unknown as EmpRow[]) {
    const pos = Array.isArray(e.position) ? e.position[0] : e.position;
    if (isLeadershipPosition(pos)) continue;
    const dept = Array.isArray(e.department) ? e.department[0] : e.department;
    if (!dept?.name) continue;
    const arr = byDept.get(dept.name) ?? [];
    arr.push({ name: e.full_name, open: openByEmp.get(e.id) ?? 0 });
    byDept.set(dept.name, arr);
  }

  const rows: DepartmentCapacityRow[] = [];
  for (const [department, members] of byDept) {
    if (members.length < 2) continue;
    const mean = members.reduce((a, m) => a + m.open, 0) / members.length;
    if (mean <= 0) continue;
    const overloaded = members
      .filter((m) => m.open >= Math.max(mean * 1.5, 4))
      .sort((a, b) => b.open - a.open);
    const available = members
      .filter((m) => m.open <= mean * 0.5)
      .sort((a, b) => a.open - b.open);
    if (overloaded.length === 0 || available.length === 0) continue;
    rows.push({
      department,
      overloaded: overloaded.slice(0, 4),
      available: available.slice(0, 4),
    });
  }
  // Most imbalanced departments first (heaviest single agent).
  return rows
    .sort((a, b) => (b.overloaded[0]?.open ?? 0) - (a.overloaded[0]?.open ?? 0))
    .slice(0, 4);
}

export const getDepartmentCapacity = cache(_getDepartmentCapacity);

// ---- Performer leaderboard (top/bottom 3 by on-time %) -------------------

export interface PerformerRow {
  employeeId: string;
  fullName: string;
  delivered30d: number;
  onTimePct: number;
}

async function _getPerformerLeaderboard(orgId: string): Promise<{
  top: PerformerRow[];
  bottom: PerformerRow[];
}> {
  const since = daysAgoIso(30).slice(0, 10);
  // Single round-trip: join task_assignees -> tasks!inner filtered to
  // done tasks completed in the window. PostgREST filters parents when
  // the embedded relation is !inner with .eq()/.gte() on it, so we get
  // back exactly the rows we need with no IN-list blow-up.
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "task_id, employee:employee_profiles!task_assignees_employee_id_fkey(id, full_name, position:positions(role, name)), task:tasks!inner(id, due_date, planned_date, completed_at, stage)",
    )
    .eq("organization_id", orgId)
    .eq("role_type", "agent")
    .eq("task.stage", "done")
    .gte("task.completed_at", `${since}T00:00:00Z`);
  if (error) throw error;

  type PerfEmp = {
    id: string;
    full_name: string;
    position: { role: string | null; name: string | null } | { role: string | null; name: string | null }[] | null;
  };
  type ARow = {
    task_id: string;
    employee: PerfEmp | PerfEmp[] | null;
    task:
      | { id: string; due_date: string | null; planned_date: string | null; completed_at: string | null }
      | { id: string; due_date: string | null; planned_date: string | null; completed_at: string | null }[]
      | null;
  };

  const agg = new Map<string, { name: string; delivered: number; onTime: number }>();
  const seen = new Set<string>();
  for (const r of ((data ?? []) as unknown as ARow[])) {
    const e = Array.isArray(r.employee) ? r.employee[0] : r.employee;
    const t = Array.isArray(r.task) ? r.task[0] : r.task;
    if (!e || !t) continue;
    // Agents-only performance: skip leadership.
    const pos = Array.isArray(e.position) ? e.position[0] : e.position;
    if (isLeadershipPosition(pos)) continue;
    const key = `${e.id}:${r.task_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const deadline = t.due_date ?? t.planned_date;
    if (!deadline || !t.completed_at) continue;
    const onTime = t.completed_at.slice(0, 10) <= deadline;
    const cur = agg.get(e.id) ?? { name: e.full_name, delivered: 0, onTime: 0 };
    cur.delivered += 1;
    if (onTime) cur.onTime += 1;
    agg.set(e.id, cur);
  }

  const rows: PerformerRow[] = Array.from(agg.entries())
    .filter(([, v]) => v.delivered >= 3)
    .map(([employeeId, v]) => ({
      employeeId,
      fullName: v.name,
      delivered30d: v.delivered,
      onTimePct: Math.round((v.onTime / v.delivered) * 100),
    }));

  const top = [...rows].sort((a, b) => b.onTimePct - a.onTimePct).slice(0, 3);
  const bottom = [...rows].sort((a, b) => a.onTimePct - b.onTimePct).slice(0, 3);

  return { top, bottom };
}

export const getPerformerLeaderboard = cache(_getPerformerLeaderboard);

// ---- On-time trend (30-day daily sparkline) ------------------------------

export interface OnTimeTrendPoint {
  date: string; // YYYY-MM-DD
  pct: number | null;
  sample: number;
}

async function _getOnTimeTrend30d(orgId: string): Promise<OnTimeTrendPoint[]> {
  // Pull a wider window (last 37 days) so the rolling 7-day window has
  // valid samples even at the left edge of the chart.
  const since = daysAgoIso(37).slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("completed_at, due_date, planned_date")
    .eq("organization_id", orgId)
    .eq("stage", "done")
    .gte("completed_at", `${since}T00:00:00Z`)
    .is("archived_at", null);
  if (error) throw error;

  // Daily counts for the wide window.
  const daily = new Map<string, { total: number; onTime: number }>();
  for (let i = 36; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    daily.set(d, { total: 0, onTime: 0 });
  }
  for (const r of (data ?? []) as Array<{
    completed_at: string | null;
    due_date: string | null;
    planned_date: string | null;
  }>) {
    if (!r.completed_at) continue;
    const deadline = r.due_date ?? r.planned_date;
    if (!deadline) continue;
    const day = r.completed_at.slice(0, 10);
    const b = daily.get(day);
    if (!b) continue;
    b.total += 1;
    if (r.completed_at.slice(0, 10) <= deadline) b.onTime += 1;
  }

  // Rolling 7-day on-time pct ending on each of the last 30 days.
  const ordered = Array.from(daily.entries());
  const out: OnTimeTrendPoint[] = [];
  for (let i = ordered.length - 30; i < ordered.length; i++) {
    let total = 0;
    let onTime = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      total += ordered[j][1].total;
      onTime += ordered[j][1].onTime;
    }
    out.push({
      date: ordered[i][0],
      sample: total,
      pct: total === 0 ? null : Math.round((onTime / total) * 100),
    });
  }
  return out;
}

export const getOnTimeTrend30d = cache(_getOnTimeTrend30d);

// ---- Pulse strip (this week vs last week) --------------------------------

export interface PulseDelta {
  current: number;
  previous: number;
}

export interface PulseStats {
  completed: PulseDelta;
  newClientChanges: PulseDelta;
  tasksAdded: PulseDelta;
  approvalsResolved: PulseDelta;
}

async function _getPulseStats(orgId: string): Promise<PulseStats> {
  const now = new Date();
  const thisStart = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const lastStart = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const lastEnd = thisStart;

  const [doneThis, doneLast, ccThis, ccLast, addThis, addLast, apprThis, apprLast] =
    await Promise.all([
      countTaskStageEntered(orgId, "done", thisStart, undefined),
      countTaskStageEntered(orgId, "done", lastStart, lastEnd),
      countTaskStageEntered(orgId, "client_changes", thisStart, undefined),
      countTaskStageEntered(orgId, "client_changes", lastStart, lastEnd),
      countTasksCreated(orgId, thisStart, undefined),
      countTasksCreated(orgId, lastStart, lastEnd),
      countApprovalsResolved(orgId, thisStart, undefined),
      countApprovalsResolved(orgId, lastStart, lastEnd),
    ]);

  return {
    completed: { current: doneThis, previous: doneLast },
    newClientChanges: { current: ccThis, previous: ccLast },
    tasksAdded: { current: addThis, previous: addLast },
    approvalsResolved: { current: apprThis, previous: apprLast },
  };
}

export const getPulseStats = cache(_getPulseStats);

async function countTaskStageEntered(
  orgId: string,
  stage: string,
  sinceIso: string,
  untilIso: string | undefined,
): Promise<number> {
  let q = supabaseAdmin
    .from("task_stage_history")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("to_stage", stage)
    .gte("entered_at", sinceIso);
  if (untilIso) q = q.lt("entered_at", untilIso);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

async function countTasksCreated(
  orgId: string,
  sinceIso: string,
  untilIso: string | undefined,
): Promise<number> {
  let q = supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("created_at", sinceIso);
  if (untilIso) q = q.lt("created_at", untilIso);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

async function countApprovalsResolved(
  orgId: string,
  sinceIso: string,
  untilIso: string | undefined,
): Promise<number> {
  let q = supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .not("approval_decided_at", "is", null)
    .gte("approval_decided_at", sinceIso);
  if (untilIso) q = q.lt("approval_decided_at", untilIso);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// ---- Service-line health (per service: open, overdue, on-time pct) -------

export interface ServiceHealthRow {
  serviceId: string;
  name: string;
  slug: string;
  openCount: number;
  overdueCount: number;
  delivered30d: number;
  onTimePct30d: number | null;
  avgRevisions: number;
  // 30-point rolling 7-day on-time pct, ending today (for sparkline).
  trend: Array<number | null>;
  // True when this row is a merge of the base service + its Renewal variant.
  includesRenewals?: boolean;
}

// Service names from the sheet carry a leading colour emoji (🔵, 🟠, 🟢, ⚪…)
// and a "Renewal " / "Renewal of " prefix for contracts where the client is in
// their first month or renewing. "🔵Renewal Social Media" and "🔵Social Media"
// are the SAME service type — only the contract phase differs — so we group them
// together and the health section shows one row per service, not double.
//
// serviceGroupKey() is the merge key: it drops the leading emoji/symbols AND the
// Renewal prefix and lowercases, so all variants of a service collapse to one key.
function serviceGroupKey(name: string): string {
  return name
    .replace(/^[^\p{L}\p{N}]+/u, "") // leading emoji / symbols
    .replace(/^renewal\s+(of\s+)?/i, "") // "Renewal " / "Renewal of "
    .trim()
    .toLowerCase()
    // Source data abbreviates some renewal variants: "Renewal of Acc Manager"
    // is the same service as "Account Manager". Expand known abbreviations so
    // they collapse onto the same key.
    .replace(/\bacc\b/g, "account");
}

// True when the name is the Renewal variant (after any leading emoji).
function isRenewalName(name: string): boolean {
  return /^[^\p{L}\p{N}]*\s*renewal\s+/iu.test(name);
}

// Human display name: keep the leading emoji, drop the Renewal word that follows.
function displayServiceName(name: string): string {
  return name.replace(/^([^\p{L}\p{N}]*)renewal\s+(of\s+)?/iu, "$1").trim();
}

async function _getServiceLineHealth(orgId: string): Promise<ServiceHealthRow[]> {
  // Wide window for rolling trend (37d so first sparkline point has 7d behind it).
  const sinceTrend = daysAgoIso(37).slice(0, 10);
  const sinceTs30 = `${daysAgoIso(30).slice(0, 10)}T00:00:00Z`;

  const [servicesRes, tasksRes] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id, name, slug")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    supabaseAdmin
      .from("tasks")
      .select("service_id, stage, is_overdue, completed_at, due_date, planned_date, revision_count, archived_at")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .not("service_id", "is", null),
  ]);
  if (servicesRes.error) throw servicesRes.error;
  if (tasksRes.error) throw tasksRes.error;

  type T = {
    service_id: string;
    stage: string;
    is_overdue: boolean;
    completed_at: string | null;
    due_date: string | null;
    planned_date: string | null;
    revision_count: number;
    archived_at: string | null;
  };

  // Per-service totals (current snapshot) + per-day buckets for the trend.
  const agg = new Map<
    string,
    {
      open: number;
      overdue: number;
      delivered: number;
      onTime: number;
      revisions: number;
      revisionsN: number;
      // Map<YYYY-MM-DD, { total, onTime }> over the 37-day window.
      daily: Map<string, { total: number; onTime: number }>;
    }
  >();

  const ensure = (id: string) => {
    let cur = agg.get(id);
    if (!cur) {
      cur = {
        open: 0, overdue: 0, delivered: 0, onTime: 0, revisions: 0, revisionsN: 0,
        daily: new Map(),
      };
      agg.set(id, cur);
    }
    return cur;
  };

  for (const t of (tasksRes.data ?? []) as T[]) {
    if (!t.service_id) continue;
    const cur = ensure(t.service_id);
    const isOpen = t.stage !== "done";
    if (isOpen) {
      cur.open += 1;
      if (t.is_overdue) cur.overdue += 1;
      cur.revisions += t.revision_count ?? 0;
      cur.revisionsN += 1;
    }
    if (t.stage === "done" && t.completed_at) {
      const deadline = t.due_date ?? t.planned_date;
      if (deadline) {
        const day = t.completed_at.slice(0, 10);
        // Headline: last 30d.
        if (t.completed_at >= sinceTs30) {
          cur.delivered += 1;
          if (day <= deadline) cur.onTime += 1;
        }
        // Trend: last 37d (so rolling 7d can start cleanly at -30).
        if (day >= sinceTrend) {
          const slot = cur.daily.get(day) ?? { total: 0, onTime: 0 };
          slot.total += 1;
          if (day <= deadline) slot.onTime += 1;
          cur.daily.set(day, slot);
        }
      }
    }
  }

  // Build rolling 7-day series ending each of the last 30 days.
  const days37: string[] = [];
  for (let i = 36; i >= 0; i--) {
    days37.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }

  // Build one row per physical service, then group by base name so
  // "Renewal Social Media" merges into "Social Media".
  type RawRow = ServiceHealthRow & {
    _onTimeCount: number;
    _deliveredCount: number;
    _revisionsSum: number;
    _revisionsN: number;
    _dailyTotals: Array<{ total: number; onTime: number }>;
  };

  const rawRows: RawRow[] = (servicesRes.data ?? []).map((s) => {
    const v = agg.get(s.id as string);
    const dailyTotals: Array<{ total: number; onTime: number }> = [];
    for (let i = 7; i < days37.length; i++) {
      let total = 0;
      let onTime = 0;
      for (let j = i - 6; j <= i; j++) {
        const d = v?.daily.get(days37[j]);
        if (d) { total += d.total; onTime += d.onTime; }
      }
      dailyTotals.push({ total, onTime });
    }
    const trend: Array<number | null> = dailyTotals.map((d) =>
      d.total === 0 ? null : Math.round((d.onTime / d.total) * 100),
    );
    return {
      serviceId: s.id as string,
      name: s.name as string,
      slug: s.slug as string,
      openCount: v?.open ?? 0,
      overdueCount: v?.overdue ?? 0,
      delivered30d: v?.delivered ?? 0,
      onTimePct30d: v && v.delivered > 0 ? Math.round((v.onTime / v.delivered) * 100) : null,
      avgRevisions: v && v.revisionsN > 0 ? Math.round((v.revisions / v.revisionsN) * 10) / 10 : 0,
      trend,
      _onTimeCount: v?.onTime ?? 0,
      _deliveredCount: v?.delivered ?? 0,
      _revisionsSum: v?.revisions ?? 0,
      _revisionsN: v?.revisionsN ?? 0,
      _dailyTotals: dailyTotals,
    };
  });

  // Group by canonical key (emoji- and Renewal-stripped). The non-Renewal row
  // wins for the display name / serviceId / slug used to link the row.
  const grouped = new Map<string, RawRow>();
  for (const row of rawRows) {
    const key = serviceGroupKey(row.name);
    const isRenewal = isRenewalName(row.name);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row, name: displayServiceName(row.name), includesRenewals: isRenewal });
    } else {
      // Merge stats into the existing canonical row.
      existing.openCount += row.openCount;
      existing.overdueCount += row.overdueCount;
      existing._deliveredCount += row._deliveredCount;
      existing._onTimeCount += row._onTimeCount;
      existing._revisionsSum += row._revisionsSum;
      existing._revisionsN += row._revisionsN;
      existing.includesRenewals = true;
      // Merge daily buckets for combined trend.
      for (let i = 0; i < existing._dailyTotals.length; i++) {
        existing._dailyTotals[i].total += row._dailyTotals[i].total;
        existing._dailyTotals[i].onTime += row._dailyTotals[i].onTime;
      }
      // Prefer the non-Renewal row's display name + serviceId/slug for linking.
      if (!isRenewal) {
        existing.name = displayServiceName(row.name);
        existing.serviceId = row.serviceId;
        existing.slug = row.slug;
      }
    }
  }

  // Re-derive onTimePct30d, avgRevisions, and trend from merged buckets.
  const rows: ServiceHealthRow[] = Array.from(grouped.values()).map((r) => {
    const trend: Array<number | null> = r._dailyTotals.map((d) =>
      d.total === 0 ? null : Math.round((d.onTime / d.total) * 100),
    );
    return {
      serviceId: r.serviceId,
      name: r.name,
      slug: r.slug,
      openCount: r.openCount,
      overdueCount: r.overdueCount,
      delivered30d: r._deliveredCount,
      onTimePct30d: r._deliveredCount > 0 ? Math.round((r._onTimeCount / r._deliveredCount) * 100) : null,
      avgRevisions: r._revisionsN > 0 ? Math.round((r._revisionsSum / r._revisionsN) * 10) / 10 : 0,
      trend,
      includesRenewals: r.includesRenewals,
    };
  });

  return rows.filter((r) => r.openCount > 0 || r.delivered30d > 0).sort((a, b) => b.openCount - a.openCount);
}

export const getServiceLineHealth = cache(_getServiceLineHealth);

// ---- Top stuck projects (by overdue load) --------------------------------

export interface StuckProjectRow {
  projectId: string;
  projectCode: string | null;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  openTasks: number;
  overdueTasks: number;
  worstSlipPercent: number;
  daysSinceActivity: number | null;
}

async function _getTopStuckProjects(orgId: string): Promise<StuckProjectRow[]> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(
      "id, stage, is_overdue, progress_slip_percent, updated_at, archived_at, project:projects!inner(id, name, project_code, client:clients!inner(id, name))",
    )
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .neq("stage", "done");
  if (error) throw error;

  type Row = {
    is_overdue: boolean;
    progress_slip_percent: number | string | null;
    updated_at: string;
    project:
      | { id: string; name: string; project_code: string | null; client: { id: string; name: string } | { id: string; name: string }[] | null }
      | { id: string; name: string; project_code: string | null; client: { id: string; name: string } | { id: string; name: string }[] | null }[]
      | null;
  };

  const agg = new Map<
    string,
    {
      name: string;
      code: string | null;
      clientId: string | null;
      client: string | null;
      open: number;
      overdue: number;
      worstSlip: number;
      lastActivity: string;
    }
  >();
  for (const r of (data ?? []) as unknown as Row[]) {
    const p = Array.isArray(r.project) ? r.project[0] : r.project;
    if (!p) continue;
    const client = Array.isArray(p.client) ? p.client[0] : p.client;
    const slip = Number(r.progress_slip_percent ?? 0);
    const cur =
      agg.get(p.id) ?? {
        name: p.name,
        code: p.project_code,
        clientId: client?.id ?? null,
        client: client?.name ?? null,
        open: 0,
        overdue: 0,
        worstSlip: 0,
        lastActivity: r.updated_at,
      };
    cur.open += 1;
    if (r.is_overdue) cur.overdue += 1;
    if (slip > cur.worstSlip) cur.worstSlip = slip;
    if (r.updated_at > cur.lastActivity) cur.lastActivity = r.updated_at;
    agg.set(p.id, cur);
  }

  const now = Date.now();
  return Array.from(agg.entries())
    .map(([projectId, v]) => ({
      projectId,
      projectCode: v.code,
      projectName: v.name,
      clientId: v.clientId,
      clientName: v.client,
      openTasks: v.open,
      overdueTasks: v.overdue,
      worstSlipPercent: Math.round(v.worstSlip),
      daysSinceActivity: Math.floor((now - new Date(v.lastActivity).getTime()) / 86_400_000),
    }))
    .filter((r) => r.overdueTasks > 0)
    .sort((a, b) => b.overdueTasks - a.overdueTasks || b.worstSlipPercent - a.worstSlipPercent)
    .slice(0, 5);
}

export const getTopStuckProjects = cache(_getTopStuckProjects);

// ---- Upcoming deadlines (next 7 days, grouped by day) --------------------

export interface UpcomingDeadlineDay {
  date: string;
  weekday: string; // 0..6 (Sunday=0)
  count: number;
  highlights: Array<{ taskId: string; title: string; projectName: string | null; priority: string }>;
}

async function _getUpcomingDeadlines(orgId: string): Promise<UpcomingDeadlineDay[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  // Use COALESCE(due_date, planned_date) as the effective deadline.
  // Fetch tasks where due_date is in range, OR (due_date is null AND planned_date is in range).
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(
      "id, title, due_date, planned_date, priority, archived_at, stage, project:projects!inner(id, name)",
    )
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .neq("stage", "done")
    .or(
      `and(due_date.gte.${todayIso},due_date.lt.${end}),` +
      `and(due_date.is.null,planned_date.gte.${todayIso},planned_date.lt.${end})`,
    )
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) throw error;

  type Row = {
    id: string;
    title: string;
    due_date: string | null;
    planned_date: string | null;
    priority: string;
    project: { name: string } | { name: string }[] | null;
  };

  const buckets = new Map<string, UpcomingDeadlineDay>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    buckets.set(iso, {
      date: iso,
      weekday: String(d.getUTCDay()),
      count: 0,
      highlights: [],
    });
  }
  for (const r of (data ?? []) as unknown as Row[]) {
    const effectiveDate = r.due_date ?? r.planned_date;
    if (!effectiveDate) continue;
    const b = buckets.get(effectiveDate);
    if (!b) continue;
    b.count += 1;
    if (b.highlights.length < 2) {
      const proj = Array.isArray(r.project) ? r.project[0] : r.project;
      b.highlights.push({
        taskId: r.id,
        title: r.title,
        projectName: proj?.name ?? null,
        priority: r.priority,
      });
    }
  }
  return Array.from(buckets.values());
}

export const getUpcomingDeadlines = cache(_getUpcomingDeadlines);

// ---- WIP aging pyramid ---------------------------------------------------

export type WipAgeBucket = "0-7" | "8-14" | "15-30" | "31-90" | "90+";

export interface WipAgingRow {
  bucket: WipAgeBucket;
  label: string;
  count: number;
  overdueCount: number;
}

const AGE_LABELS: Record<WipAgeBucket, string> = {
  "0-7": "0-7d",
  "8-14": "8-14d",
  "15-30": "15-30d",
  "31-90": "31-90d",
  "90+": "90d+",
};

async function _getWipAging(orgId: string): Promise<WipAgingRow[]> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, created_at, is_overdue, stage, archived_at")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .neq("stage", "done");
  if (error) throw error;

  const buckets: Record<WipAgeBucket, { count: number; overdueCount: number }> = {
    "0-7": { count: 0, overdueCount: 0 },
    "8-14": { count: 0, overdueCount: 0 },
    "15-30": { count: 0, overdueCount: 0 },
    "31-90": { count: 0, overdueCount: 0 },
    "90+": { count: 0, overdueCount: 0 },
  };
  const now = Date.now();
  for (const r of (data ?? []) as Array<{ created_at: string; is_overdue: boolean }>) {
    const ageDays = Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000);
    const key: WipAgeBucket =
      ageDays <= 7 ? "0-7"
      : ageDays <= 14 ? "8-14"
      : ageDays <= 30 ? "15-30"
      : ageDays <= 90 ? "31-90"
      : "90+";
    buckets[key].count += 1;
    if (r.is_overdue) buckets[key].overdueCount += 1;
  }
  return (Object.keys(buckets) as WipAgeBucket[]).map((b) => ({
    bucket: b,
    label: AGE_LABELS[b],
    count: buckets[b].count,
    overdueCount: buckets[b].overdueCount,
  }));
}

export const getWipAging = cache(_getWipAging);

// ---- Stage bounce-back matrix --------------------------------------------

export interface StageFlowCell {
  from: TaskStage;
  to: TaskStage;
  count: number;
  isBackward: boolean;
}

async function _getStageFlowMatrix(orgId: string): Promise<{
  cells: StageFlowCell[];
  topBackward: Array<{ from: TaskStage; to: TaskStage; count: number }>;
  totalForward: number;
  totalBackward: number;
}> {
  // Look at the last 90 days of stage transitions so the matrix isn't
  // dominated by ancient data.
  const since = daysAgoIso(90);
  const { data, error } = await supabaseAdmin
    .from("task_stage_history")
    .select("from_stage, to_stage")
    .eq("organization_id", orgId)
    .gte("entered_at", since)
    .not("from_stage", "is", null);
  if (error) throw error;

  const orderIdx: Record<string, number> = {};
  FUNNEL_STAGE_ORDER.forEach((s, i) => (orderIdx[s] = i));

  const counts = new Map<string, number>();
  let totalForward = 0;
  let totalBackward = 0;
  for (const r of (data ?? []) as Array<{ from_stage: TaskStage; to_stage: TaskStage }>) {
    if (!r.from_stage || !r.to_stage) continue;
    const key = `${r.from_stage}>${r.to_stage}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const fi = orderIdx[r.from_stage] ?? 0;
    const ti = orderIdx[r.to_stage] ?? 0;
    if (ti < fi) totalBackward += 1;
    else totalForward += 1;
  }

  const cells: StageFlowCell[] = [];
  for (const from of FUNNEL_STAGE_ORDER) {
    for (const to of FUNNEL_STAGE_ORDER) {
      if (from === to) continue;
      const c = counts.get(`${from}>${to}`) ?? 0;
      cells.push({
        from,
        to,
        count: c,
        isBackward: (orderIdx[to] ?? 0) < (orderIdx[from] ?? 0),
      });
    }
  }

  const topBackward = cells
    .filter((c) => c.isBackward && c.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ from, to, count }) => ({ from, to, count }));

  return { cells, topBackward, totalForward, totalBackward };
}

export const getStageFlowMatrix = cache(_getStageFlowMatrix);

// ---- Client-edits indicator ----------------------------------------------

export interface ClientEditsMetrics {
  // Tasks currently sitting at client_changes right now.
  activeNow: number;
  // Tasks that ENTERED client_changes in the last 7 days (new requests).
  enteredThisWeek: number;
  // Same window the prior week — for the trend arrow.
  enteredLastWeek: number;
  // Per-service breakdown of tasks currently at client_changes.
  byService: Array<{ name: string; slug: string; count: number }>;
}

async function _getTopRevisedTasks(orgId: string): Promise<ClientEditsMetrics> {
  const now7 = daysAgoIso(7);
  const now14 = daysAgoIso(14);

  const [liveRes, histRes, servicesRes] = await Promise.all([
    // Tasks currently at client_changes with their service.
    supabaseAdmin
      .from("tasks")
      .select("id, service_id")
      .eq("organization_id", orgId)
      .eq("stage", "client_changes")
      .is("archived_at", null),

    // Tasks that entered client_changes in the last 14 days (for week comparison).
    supabaseAdmin
      .from("task_stage_history")
      .select("task_id, entered_at")
      .eq("organization_id", orgId)
      .eq("to_stage", "client_changes")
      .gte("entered_at", now14),

    // Service name map.
    supabaseAdmin
      .from("services")
      .select("id, name, slug")
      .eq("organization_id", orgId)
      .eq("is_active", true),
  ]);

  if (liveRes.error) throw liveRes.error;
  if (histRes.error) throw histRes.error;

  type LiveRow = { id: string; service_id: string | null };
  const live = (liveRes.data ?? []) as LiveRow[];
  const activeNow = live.length;

  type HistRow = { task_id: string; entered_at: string };
  const hist = (histRes.data ?? []) as HistRow[];
  const enteredThisWeek = hist.filter((r) => r.entered_at >= now7).length;
  const enteredLastWeek = hist.filter((r) => r.entered_at < now7).length;

  // Count active tasks per service.
  const svcCount = new Map<string, number>();
  for (const t of live) {
    if (t.service_id) svcCount.set(t.service_id, (svcCount.get(t.service_id) ?? 0) + 1);
  }

  type SvcRow = { id: string; name: string; slug: string };
  const svcMap = new Map<string, { name: string; slug: string }>();
  for (const s of (servicesRes.data ?? []) as SvcRow[]) svcMap.set(s.id, { name: s.name, slug: s.slug });

  // Merge Renewal variants: strip "Renewal " prefix so they group with the base service.
  const byServiceMerged = new Map<string, { name: string; slug: string; count: number }>();
  for (const [svcId, count] of svcCount.entries()) {
    const svc = svcMap.get(svcId);
    if (!svc) continue;
    const baseName = svc.name.replace(/^renewal\s+/i, "").trim();
    const existing = byServiceMerged.get(baseName);
    if (existing) existing.count += count;
    else byServiceMerged.set(baseName, { name: baseName, slug: svc.slug, count });
  }

  const byService = Array.from(byServiceMerged.values()).sort((a, b) => b.count - a.count);

  return { activeNow, enteredThisWeek, enteredLastWeek, byService };
}

export const getTopRevisedTasks = cache(_getTopRevisedTasks);

// =========================================================================
// Helpers
// =========================================================================

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// "How many tasks were overdue as of N days ago" — reads from the daily
// snapshot table populated by the snapshot_dashboard_daily() cron. We
// can't reconstruct this from `tasks` directly because is_overdue is
// mirrored from Odoo with no history and due_date is sparsely set.
// Falls back to 0 when no snapshot exists for that date.
async function countOverdueAt(orgId: string, isoTs: string): Promise<number> {
  const date = isoTs.slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("dashboard_daily_snapshots")
    .select("overdue_count")
    .eq("organization_id", orgId)
    .eq("snapshot_date", date)
    .maybeSingle();
  if (error || !data) return 0;
  return (data as { overdue_count: number }).overdue_count ?? 0;
}

// Live "currently overdue" count from our own truth source (tasks.is_overdue),
// matching the daily-snapshot definition exactly (is_overdue ⇒ already excludes
// done + the not-started `new` stage per migration 0219). We deliberately do
// NOT use Odoo's live overdueCount here: Odoo counts every task with a past
// date_deadline that isn't done — including not-started `new`-stage backlog —
// so it over-reports (~137 vs ~41) and is inconsistent with the week-ago delta
// (snapshot-backed) and the "where is the danger" card.
async function countOverdueNow(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("is_overdue", true)
    .is("archived_at", null)
    .neq("stage", "done");
  if (error) return 0;
  return count ?? 0;
}

async function countRevisionCommentsSince(orgId: string, isoTs: string): Promise<number> {
  // Tasks that had ANY activity in client_changes since isoTs — approximated
  // via task_stage_history rows where to_stage='client_changes' and
  // entered_at >= isoTs.
  const { count, error } = await supabaseAdmin
    .from("task_stage_history")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("to_stage", "client_changes")
    .gte("entered_at", isoTs);
  if (error) return 0;
  return count ?? 0;
}

// Re-export the Odoo metrics shape for the page composition layer.
export type { DashboardOdooMetrics };
