import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isLeadershipPosition } from "@/lib/data/leadership";
import {
  getDashboardOdooMetrics,
  type DashboardOdooMetrics,
} from "@/lib/odoo/live";
import type { TaskStage } from "@/lib/labels";
import { resolveRange, type DashboardRange } from "@/lib/dashboard-range";
import { riyadhDateOf, riyadhDateRangeUtcBounds, riyadhTodayIso } from "@/lib/tz";

function addDaysIso(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// =========================================================================
// Executive (/dashboard) data layer.
// One module per page; each fetcher wrapped in React `cache()` so that
// multiple Suspense boundaries reusing the same data hit the source once.
// Live counts come from Odoo (always-fresh via the live helpers); deltas
// and per-client rollups come from Supabase.
// =========================================================================

// ---- Hero KPIs (on-time, overdue, stuck-in-review, revisions) ------------

export interface HeroKpis {
  onTime: { pct: number | null; sample: number; delivered: number };
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
      delivered: odooNow?.deliveredCount ?? 0,
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

async function _getClientHealth(
  orgId: string,
  range: DashboardRange = resolveRange(undefined),
): Promise<{
  worst: ClientHealthRow[];
  best: ClientHealthRow[];
}> {
  // The view supplies the point-in-time columns (open/overdue/active projects/
  // revisions/last activity). on-time % and delivered are recomputed below over
  // the selected window so the card tracks the picker.
  const { start, endExclusive } = riyadhDateRangeUtcBounds(range.from, range.to);
  const [viewRes, doneRes] = await Promise.all([
    supabaseAdmin
      .from("v_client_delivery_health")
      .select(
        "client_id, client_name, active_project_count, open_task_count, overdue_task_count, on_time_pct_30d, delivered_count_30d, avg_revision_count, total_revision_comments, last_activity_at",
      )
      .eq("organization_id", orgId)
      .gt("open_task_count", 0),
    supabaseAdmin
      .from("tasks")
      .select("completed_at, due_date, planned_date, project:projects!inner(client_id)")
      .eq("organization_id", orgId)
      .eq("stage", "done")
      .is("archived_at", null)
      .gte("completed_at", start)
      .lt("completed_at", endExclusive),
  ]);
  const { data, error } = viewRes;
  if (error) throw error;
  if (doneRes.error) throw doneRes.error;

  // Per-client delivered + on-time over the window.
  const perClient = new Map<string, { delivered: number; sample: number; hits: number }>();
  for (const r of (doneRes.data ?? []) as Array<{
    completed_at: string | null;
    due_date: string | null;
    planned_date: string | null;
    project: { client_id: string | null } | { client_id: string | null }[] | null;
  }>) {
    const p = Array.isArray(r.project) ? r.project[0] : r.project;
    const cid = p?.client_id;
    if (!cid || !r.completed_at) continue;
    const cur = perClient.get(cid) ?? { delivered: 0, sample: 0, hits: 0 };
    cur.delivered += 1;
    const deadline = r.due_date ?? r.planned_date;
    if (deadline) {
      cur.sample += 1;
      if (riyadhDateOf(r.completed_at) <= deadline) cur.hits += 1;
    }
    perClient.set(cid, cur);
  }

  const rows: ClientHealthRow[] = (data ?? []).map((r) => {
    const w = perClient.get(r.client_id as string);
    return {
      clientId: r.client_id as string,
      clientName: r.client_name as string,
      activeProjectCount: r.active_project_count as number,
      openTaskCount: r.open_task_count as number,
      overdueTaskCount: r.overdue_task_count as number,
      onTimePct30d: w && w.sample > 0 ? Math.round((w.hits / w.sample) * 100) : null,
      deliveredCount30d: w?.delivered ?? 0,
      avgRevisionCount: Number(r.avg_revision_count ?? 0),
      totalRevisionComments: r.total_revision_comments as number,
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
    };
  });

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

async function _getStageFunnel(orgId: string): Promise<FunnelStageRow[]> {
  // Aggregated in SQL (migration 0228). The old approach fetched every task row
  // and counted in JS, but PostgREST caps a response at ~1000 rows — with >1000
  // non-archived tasks the per-stage counts silently truncated (in_progress
  // showed 8/19 instead of 15/38). overdue_count uses the same `is_overdue`
  // column the /tasks `f=overdue` drill-down filters on, so they stay in lockstep.
  const { data, error } = await supabaseAdmin.rpc("get_stage_funnel", {
    p_org_id: orgId,
  });
  if (error) throw error;

  type Row = {
    stage: string;
    open_count: number;
    overdue_count: number;
    avg_dwell_hours: number;
  };
  const byStage = new Map<string, Row>();
  for (const r of (data ?? []) as Row[]) byStage.set(r.stage, r);

  return FUNNEL_STAGE_ORDER.map((stage) => {
    const r = byStage.get(stage);
    return {
      stage,
      openCount: Number(r?.open_count ?? 0),
      overdueCount: Number(r?.overdue_count ?? 0),
      avgDwellHours: Number(r?.avg_dwell_hours ?? 0),
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
  overdueCount: number;
  staleCount: number;
  allocatedHours: number;
}

export interface SupportRiskRow {
  employeeId: string;
  fullName: string;
  openCount: number;
  overdueCount: number;
  staleCount: number;
  riskScore: number;
}

async function _getOpenAgentRiskRows(orgId: string): Promise<SpecialistLoadRow[]> {
  type EmpEmbed = {
    id: string;
    full_name: string;
    position: { role: string | null; name: string | null } | { role: string | null; name: string | null }[] | null;
  };
  type Row = {
    employee_id: string;
    task:
      | {
          id: string;
          stage: string;
          allocated_time_minutes: number | null;
          archived_at: string | null;
          is_overdue: boolean | null;
          stage_entered_at: string | null;
        }
      | {
          id: string;
          stage: string;
          allocated_time_minutes: number | null;
          archived_at: string | null;
          is_overdue: boolean | null;
          stage_entered_at: string | null;
        }[]
      | null;
    employee: EmpEmbed | EmpEmbed[] | null;
  };

  const staleCutoff = daysAgoIso(7);
  const agg = new Map<
    string,
    { name: string; count: number; overdue: number; stale: number; minutes: number }
  >();
  const seen = new Set<string>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("task_assignees")
      .select(
        "employee_id, task:tasks!inner(id, stage, allocated_time_minutes, archived_at, is_overdue, stage_entered_at), employee:employee_profiles!task_assignees_employee_id_fkey(id, full_name, position:positions(role, name))",
      )
      .eq("organization_id", orgId)
      .eq("role_type", "agent")
      .neq("task.stage", "done")
      .is("task.archived_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;

    for (const raw of ((data ?? []) as unknown as Row[])) {
      const t = Array.isArray(raw.task) ? raw.task[0] : raw.task;
      const e = Array.isArray(raw.employee) ? raw.employee[0] : raw.employee;
      if (!t || !e) continue;
      const pos = Array.isArray(e.position) ? e.position[0] : e.position;
      if (isLeadershipPosition(pos)) continue;

      const key = `${e.id}:${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cur = agg.get(e.id) ?? { name: e.full_name, count: 0, overdue: 0, stale: 0, minutes: 0 };
      cur.count += 1;
      cur.minutes += t.allocated_time_minutes ?? 0;
      if (t.is_overdue) cur.overdue += 1;
      if (t.stage !== "new" && t.stage_entered_at && t.stage_entered_at < staleCutoff) cur.stale += 1;
      agg.set(e.id, cur);
    }

    if (!data || data.length < PAGE) break;
  }

  return Array.from(agg.entries())
    .map(([employeeId, v]) => ({
      employeeId,
      fullName: v.name,
      openCount: v.count,
      overdueCount: v.overdue,
      staleCount: v.stale,
      allocatedHours: Math.round((v.minutes / 60) * 10) / 10,
    }));
}

const getOpenAgentRiskRows = cache(_getOpenAgentRiskRows);

async function _getSpecialistLoadTop(orgId: string): Promise<SpecialistLoadRow[]> {
  return (await getOpenAgentRiskRows(orgId))
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

async function _getPerformerLeaderboard(
  orgId: string,
  range: DashboardRange = resolveRange(undefined),
): Promise<{
  top: PerformerRow[];
  bottom: SupportRiskRow[];
}> {
  // Single round-trip: join task_assignees -> tasks!inner filtered to
  // done tasks completed in the selected window. PostgREST filters parents when
  // the embedded relation is !inner with .eq()/.gte() on it, so we get
  // back exactly the rows we need with no IN-list blow-up.
  const { start, endExclusive } = riyadhDateRangeUtcBounds(range.from, range.to);
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "task_id, employee:employee_profiles!task_assignees_employee_id_fkey(id, full_name, position:positions(role, name)), task:tasks!inner(id, due_date, planned_date, completed_at, stage)",
    )
    .eq("organization_id", orgId)
    .eq("role_type", "agent")
    .eq("task.stage", "done")
    .gte("task.completed_at", start)
    .lt("task.completed_at", endExclusive);
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
    const onTime = riyadhDateOf(t.completed_at) <= deadline;
    const cur = agg.get(e.id) ?? { name: e.full_name, delivered: 0, onTime: 0 };
    cur.delivered += 1;
    if (onTime) cur.onTime += 1;
    agg.set(e.id, cur);
  }

  const rows: PerformerRow[] = Array.from(agg.entries())
    .filter(([, v]) => v.delivered >= 5)
    .map(([employeeId, v]) => ({
      employeeId,
      fullName: v.name,
      delivered30d: v.delivered,
      onTimePct: Math.round((v.onTime / v.delivered) * 100),
    }));

  const top = [...rows]
    .sort((a, b) => b.onTimePct - a.onTimePct || b.delivered30d - a.delivered30d)
    .slice(0, 3);
  const bottom = (await getOpenAgentRiskRows(orgId))
    .map((r) => ({
      employeeId: r.employeeId,
      fullName: r.fullName,
      openCount: r.openCount,
      overdueCount: r.overdueCount,
      staleCount: r.staleCount,
      riskScore: r.overdueCount * 10 + r.staleCount * 4 + r.openCount,
    }))
    .filter((r) => r.riskScore > 0 && (r.overdueCount > 0 || r.staleCount > 0))
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        b.overdueCount - a.overdueCount ||
        b.staleCount - a.staleCount ||
        b.openCount - a.openCount,
    )
    .slice(0, 3);

  return { top, bottom };
}

export const getPerformerLeaderboard = cache(_getPerformerLeaderboard);

// ---- On-time trend (30-day daily sparkline) ------------------------------

export interface OnTimeTrendPoint {
  date: string; // YYYY-MM-DD
  pct: number | null;
  sample: number;
}

export interface OnTimeSeries {
  /** on-time % over [from,to] (of delivered-with-deadline) */
  pct: number | null;
  /** delivered-in-range that had a deadline (on-time denominator) */
  sample: number;
  /** ALL tasks delivered (done) in [from,to] — matches Rwasem's delivered count */
  delivered: number;
  /** rolling 7-day on-time %, one point per day in [from,to] (sparkline) */
  points: OnTimeTrendPoint[];
}

// Range-aware on-time + delivered (Phase 2). Computed from Supabase so the
// figure is explicitly scoped to the selected [from,to] window. Pulls 6 extra
// days before `from` so the rolling-7d sparkline has history at the left edge.
async function _getOnTimeSeries(orgId: string, range: DashboardRange): Promise<OnTimeSeries> {
  const fromExt = addDaysIso(range.from, -6);
  const { start, endExclusive } = riyadhDateRangeUtcBounds(fromExt, range.to);
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("completed_at, due_date, planned_date")
    .eq("organization_id", orgId)
    .eq("stage", "done")
    .gte("completed_at", start)
    .lt("completed_at", endExclusive)
    .is("archived_at", null);
  if (error) throw error;

  // Per-day buckets across the extended window.
  const daily = new Map<string, { total: number; onTime: number }>();
  for (let d = fromExt; d <= range.to; d = addDaysIso(d, 1)) {
    daily.set(d, { total: 0, onTime: 0 });
  }

  let delivered = 0;
  let sample = 0;
  let hits = 0;
  for (const r of (data ?? []) as Array<{
    completed_at: string | null;
    due_date: string | null;
    planned_date: string | null;
  }>) {
    if (!r.completed_at) continue;
    const day = riyadhDateOf(r.completed_at);
    const inRange = day >= range.from && day <= range.to;
    if (inRange) delivered += 1; // all delivered in-range (matches Rwasem)
    const deadline = r.due_date ?? r.planned_date;
    if (!deadline) continue;
    const onTime = day <= deadline;
    if (inRange) {
      sample += 1;
      if (onTime) hits += 1;
    }
    const b = daily.get(day);
    if (b) {
      b.total += 1;
      if (onTime) b.onTime += 1;
    }
  }

  // Rolling 7-day on-time pct ending on each day in [from,to].
  const ordered = Array.from(daily.entries());
  const firstInRange = ordered.findIndex(([d]) => d >= range.from);
  const points: OnTimeTrendPoint[] = [];
  for (let i = Math.max(0, firstInRange); i < ordered.length; i++) {
    let total = 0;
    let onTime = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      total += ordered[j][1].total;
      onTime += ordered[j][1].onTime;
    }
    points.push({
      date: ordered[i][0],
      sample: total,
      pct: total === 0 ? null : Math.round((onTime / total) * 100),
    });
  }

  return {
    pct: sample === 0 ? null : Math.round((hits / sample) * 100),
    sample,
    delivered,
    points,
  };
}

export const getOnTimeSeries = cache(_getOnTimeSeries);

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
      countTaskStageEntered(orgId, "client_changes", thisStart, undefined, true),
      countTaskStageEntered(orgId, "client_changes", lastStart, lastEnd, true),
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
  // Exclude archived (wound-down / lost-client) tasks. Opt-in so the "done"
  // completed counter keeps its current scope; the client_changes counter
  // sets it so its period count + trend match the live count.
  excludeArchived = false,
): Promise<number> {
  let q = supabaseAdmin
    .from("task_stage_history")
    .select(excludeArchived ? "id, task:tasks!inner(archived_at)" : "id", {
      count: "exact",
      head: true,
    })
    .eq("organization_id", orgId)
    .eq("to_stage", stage)
    .gte("entered_at", sinceIso);
  if (excludeArchived) q = q.is("task.archived_at", null);
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
  /** delivered (done) in the selected period — INCLUDES archived done tasks. */
  delivered30d: number;
  overdueCount: number;
  /** on-time % over the selected period; denominator = ALL delivered (spec KPI 4). */
  onTimePct30d: number | null;
  /** on-time % over the previous equivalent period (for the trend chip). */
  onTimePctPrev: number | null;
  /** distinct tasks that entered client_changes during the selected period. */
  clientChanges: number;
  /** same for the previous equivalent period (for the trend chip). */
  clientChangesPrev: number;
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
export function serviceGroupKey(name: string): string {
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
export function isRenewalName(name: string): boolean {
  return /^[^\p{L}\p{N}]*\s*renewal\s+/iu.test(name);
}

// Human display name: keep the leading emoji, drop the Renewal word that follows.
export function displayServiceName(name: string): string {
  return name.replace(/^([^\p{L}\p{N}]*)renewal\s+(of\s+)?/iu, "$1").trim();
}

async function _getServiceLineHealth(
  orgId: string,
  // Defaults to the last-30-day window for non-dashboard callers (e.g. the CEO
  // brief) that don't supply an explicit range.
  range: DashboardRange = resolveRange(undefined),
): Promise<ServiceHealthRow[]> {
  // Delivered / on-time are windowed to the selected range; the sparkline pulls
  // 6 extra days before `from` so its rolling-7d window has history at the edge.
  const sinceTrend = addDaysIso(range.from, -6);
  // Overdue = open task past deadline (team's Rwasem method) — point-in-time.
  const todayStr = riyadhTodayIso();
  // Previous equivalent period (same duration) — powers the on-time% and
  // client-changes trend chips (Sky Light feedback 2026-07-07).
  const prevTo = addDaysIso(range.from, -1);
  const prevFrom = addDaysIso(prevTo, -(range.days - 1));

  type T = {
    id: string;
    service_id: string;
    stage: string;
    completed_at: string | null;
    due_date: string | null;
    planned_date: string | null;
    archived_at: string | null;
  };

  // NOTE: archived tasks are NO LONGER filtered out at the query — archived
  // *done* tasks must count toward "delivered" (spec KPI 4: archived + non-
  // archived both included). Archived *open* tasks are still excluded from the
  // open/overdue counts in the loop below.
  async function fetchTaskRows(): Promise<T[]> {
    const rows: T[] = [];
    const PAGE = 1000;

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .select("id, service_id, stage, completed_at, due_date, planned_date, archived_at")
        .eq("organization_id", orgId)
        .not("service_id", "is", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
    }

    return rows;
  }

  // Distinct tasks that ENTERED the client_changes stage during the selected /
  // previous period, per (physical) service. Replaces the old avg-revisions
  // column, which read a `revision_count` that Odoo never populated (always 0).
  async function fetchClientChangesByService(): Promise<Map<string, { sel: Set<string>; prev: Set<string> }>> {
    const { start } = riyadhDateRangeUtcBounds(prevFrom, prevFrom);
    const { endExclusive } = riyadhDateRangeUtcBounds(range.to, range.to);
    const out = new Map<string, { sel: Set<string>; prev: Set<string> }>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("task_stage_history")
        .select("task_id, entered_at, task:tasks!inner(service_id)")
        .eq("organization_id", orgId)
        .eq("to_stage", "client_changes")
        // Exclude archived tasks (wound-down / lost-client projects) so the
        // period counter is scoped like the live count — otherwise a batch of
        // archived tasks inflates the count AND can flip the trend sign.
        .is("task.archived_at", null)
        .gte("entered_at", start)
        .lt("entered_at", endExclusive)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        task_id: string;
        entered_at: string;
        task: { service_id: string | null } | { service_id: string | null }[] | null;
      }>;
      for (const r of rows) {
        const task = Array.isArray(r.task) ? r.task[0] : r.task;
        const sid = task?.service_id;
        if (!sid) continue;
        const day = riyadhDateOf(r.entered_at);
        const bucket = out.get(sid) ?? { sel: new Set<string>(), prev: new Set<string>() };
        if (day >= range.from && day <= range.to) bucket.sel.add(r.task_id);
        else if (day >= prevFrom && day <= prevTo) bucket.prev.add(r.task_id);
        out.set(sid, bucket);
      }
      if (rows.length < PAGE) break;
    }
    return out;
  }

  const [servicesRes, taskRows, ccByService] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id, name, slug")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    fetchTaskRows(),
    fetchClientChangesByService(),
  ]);
  if (servicesRes.error) throw servicesRes.error;

  // Per-service totals (current snapshot) + per-day buckets for the trend.
  const agg = new Map<
    string,
    {
      open: number;
      overdue: number;
      delivered: number;      // ALL done in the selected window (incl. archived)
      onTime: number;         // of those, delivered on/before deadline
      prevDelivered: number;  // previous-period delivered (denom for trend)
      prevOnTime: number;
      // Map<YYYY-MM-DD, { total, onTime }> over the 37-day sparkline window.
      daily: Map<string, { total: number; onTime: number }>;
    }
  >();

  const ensure = (id: string) => {
    let cur = agg.get(id);
    if (!cur) {
      cur = { open: 0, overdue: 0, delivered: 0, onTime: 0, prevDelivered: 0, prevOnTime: 0, daily: new Map() };
      agg.set(id, cur);
    }
    return cur;
  };

  for (const t of taskRows) {
    if (!t.service_id) continue;
    const cur = ensure(t.service_id);
    const isOpen = t.stage !== "done";
    if (isOpen) {
      // Archived open tasks are not live work — exclude from open/overdue.
      if (t.archived_at == null) {
        cur.open += 1;
        if (t.planned_date != null && t.planned_date < todayStr) cur.overdue += 1;
      }
      continue;
    }
    if (t.stage === "done" && t.completed_at) {
      const day = riyadhDateOf(t.completed_at);
      const deadline = t.due_date ?? t.planned_date;
      const onTime = deadline != null && day <= deadline;
      // Delivered counts ALL done (incl. archived); the on-time RATE denominator
      // is all delivered (spec KPI 4) — a no-deadline task counts as not-on-time.
      if (day >= range.from && day <= range.to) {
        cur.delivered += 1;
        if (onTime) cur.onTime += 1;
      } else if (day >= prevFrom && day <= prevTo) {
        cur.prevDelivered += 1;
        if (onTime) cur.prevOnTime += 1;
      }
      // Sparkline: range + 6 lead-in days so the rolling 7d window is full.
      if (day >= sinceTrend && day <= range.to) {
        const slot = cur.daily.get(day) ?? { total: 0, onTime: 0 };
        slot.total += 1;
        if (onTime) slot.onTime += 1;
        cur.daily.set(day, slot);
      }
    }
  }

  // Build the day axis: 6 lead-in days + every day in [from,to]. Index 6 is the
  // first in-range day, so the rolling-7d series starts there.
  const days37: string[] = [];
  for (let d = sinceTrend; d <= range.to; d = addDaysIso(d, 1)) days37.push(d);
  const trendStart = 6;

  const pctOf = (num: number, den: number): number | null =>
    den > 0 ? Math.round((num / den) * 100) : null;

  // Build one row per physical service, then group by base name so
  // "Renewal Social Media" merges into "Social Media".
  type RawRow = ServiceHealthRow & {
    _onTime: number;
    _delivered: number;
    _prevOnTime: number;
    _prevDelivered: number;
    _cc: number;
    _ccPrev: number;
    _dailyTotals: Array<{ total: number; onTime: number }>;
  };

  const rawRows: RawRow[] = (servicesRes.data ?? []).map((s) => {
    const sid = s.id as string;
    const v = agg.get(sid);
    const cc = ccByService.get(sid);
    const dailyTotals: Array<{ total: number; onTime: number }> = [];
    for (let i = trendStart; i < days37.length; i++) {
      let total = 0;
      let onTime = 0;
      for (let j = i - 6; j <= i; j++) {
        const d = v?.daily.get(days37[j]);
        if (d) { total += d.total; onTime += d.onTime; }
      }
      dailyTotals.push({ total, onTime });
    }
    const trend: Array<number | null> = dailyTotals.map((d) => pctOf(d.onTime, d.total));
    return {
      serviceId: sid,
      name: s.name as string,
      slug: s.slug as string,
      openCount: v?.open ?? 0,
      overdueCount: v?.overdue ?? 0,
      delivered30d: v?.delivered ?? 0,
      onTimePct30d: pctOf(v?.onTime ?? 0, v?.delivered ?? 0),
      onTimePctPrev: pctOf(v?.prevOnTime ?? 0, v?.prevDelivered ?? 0),
      clientChanges: cc?.sel.size ?? 0,
      clientChangesPrev: cc?.prev.size ?? 0,
      trend,
      _onTime: v?.onTime ?? 0,
      _delivered: v?.delivered ?? 0,
      _prevOnTime: v?.prevOnTime ?? 0,
      _prevDelivered: v?.prevDelivered ?? 0,
      _cc: cc?.sel.size ?? 0,
      _ccPrev: cc?.prev.size ?? 0,
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
      existing.openCount += row.openCount;
      existing.overdueCount += row.overdueCount;
      existing._delivered += row._delivered;
      existing._onTime += row._onTime;
      existing._prevDelivered += row._prevDelivered;
      existing._prevOnTime += row._prevOnTime;
      existing._cc += row._cc;
      existing._ccPrev += row._ccPrev;
      existing.includesRenewals = true;
      for (let i = 0; i < existing._dailyTotals.length; i++) {
        existing._dailyTotals[i].total += row._dailyTotals[i].total;
        existing._dailyTotals[i].onTime += row._dailyTotals[i].onTime;
      }
      if (!isRenewal) {
        existing.name = displayServiceName(row.name);
        existing.serviceId = row.serviceId;
        existing.slug = row.slug;
      }
    }
  }

  // Re-derive rates / trend from the merged buckets.
  const rows: ServiceHealthRow[] = Array.from(grouped.values()).map((r) => ({
    serviceId: r.serviceId,
    name: r.name,
    slug: r.slug,
    openCount: r.openCount,
    overdueCount: r.overdueCount,
    delivered30d: r._delivered,
    onTimePct30d: pctOf(r._onTime, r._delivered),
    onTimePctPrev: pctOf(r._prevOnTime, r._prevDelivered),
    clientChanges: r._cc,
    clientChangesPrev: r._ccPrev,
    trend: r._dailyTotals.map((d) => pctOf(d.onTime, d.total)),
    includesRenewals: r.includesRenewals,
  }));

  return rows
    .filter((r) => r.openCount > 0 || r.delivered30d > 0 || r.clientChanges > 0)
    .sort((a, b) => b.openCount - a.openCount);
}

export const getServiceLineHealth = cache(_getServiceLineHealth);

// ---- Supporting-department health ----------------------------------------
// الجرافيك / محتوى السيو are SUPPORTING departments: their work is embedded
// INSIDE service tasks (a Social-Media task carries a graphics assignee), so
// they have no service_id of their own and never appear in the service-health
// section above. This section shows the SAME KPIs (open / delivered / on-time% /
// overdue-now / client-changes-in-period, each with a previous-period trend and
// an on-time sparkline) but SCOPED BY DEPARTMENT MEMBERSHIP — every task where an
// assignee belongs to the department. We scope by membership, NOT by the dept
// HEAD's own assignments, because a supporting head is often not an assignee at
// all (e.g. عمر الخيام, graphics head, has 0 task_assignees rows; the work sits
// on the department's specialists). Add a department slug here to include it.
const UUID_RE_EXEC = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SUPPORTING_DEPARTMENT_SLUGS = [
  "art-graphic",
  // Motion is a separate supporting dept: it shares a head with الجرافيك but
  // has its own specialists, and the metric is scoped by team membership (not
  // the head's assignments), so it earns its own row.
  "art-motion",
  "seo-content",
] as const;

// Category exception (Sky Light, 2026-07-13): محتوى السيو (seo-content) supports
// the SEO line specifically. Its head occasionally picks up simple one-off tasks
// for OTHER services individually — those must NOT count as supporting-dept load.
// So for seo-content only, tasks are filtered to the SEO service group
// (🟠SEO + 🟠Renewal SEO, matched via serviceGroupKey). الجرافيك / الموشن are
// unscoped (they support every service line).
const CATEGORY_SCOPED_DEPT_SLUG = "seo-content";
const CATEGORY_SCOPED_SERVICE_GROUP = "seo";

async function execRunSql<R = Record<string, unknown>>(sql: string): Promise<R[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`supporting-dept query failed: ${error.message}`);
  return (data ?? []) as R[];
}

async function _getSupportingDepartmentHealth(
  orgId: string,
  range: DashboardRange = resolveRange(undefined),
): Promise<ServiceHealthRow[]> {
  if (!UUID_RE_EXEC.test(orgId)) throw new Error("supporting-dept: invalid org id");

  // Windowing — identical semantics to the service-health section.
  const from = range.from;
  const to = range.to;
  const today = riyadhTodayIso();
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(range.days - 1));
  const sinceTrend = addDaysIso(from, -6);

  const slugList = SUPPORTING_DEPARTMENT_SLUGS.map((s) => `'${s}'`).join(", ");

  // Resolve the SEO service group → concrete service ids, for the seo-content
  // category exception. Matched via serviceGroupKey so both 🟠SEO and its
  // 🟠Renewal SEO variant are included and future renamings still resolve.
  const { data: svcRows, error: svcErr } = await supabaseAdmin
    .from("services")
    .select("id, name")
    .eq("organization_id", orgId);
  if (svcErr) throw svcErr;
  const seoServiceIds = (svcRows ?? [])
    .filter((s) => serviceGroupKey(s.name ?? "") === CATEGORY_SCOPED_SERVICE_GROUP)
    .map((s) => s.id)
    .filter((id) => UUID_RE_EXEC.test(id));
  // Predicate applied ONLY to the category-scoped dept. If no SEO service
  // resolves (shouldn't happen), fall back to `false` so we never silently
  // widen the scope to every service.
  const seoInList = seoServiceIds.length
    ? `t.service_id in (${seoServiceIds.map((id) => `'${id}'`).join(", ")})`
    : "false";

  // Shared scope CTEs: active members of the supporting departments, then the
  // DISTINCT (department, task) pairs reachable through their task_assignees.
  // seo-content is category-scoped to the SEO line (see CATEGORY_SCOPED_*);
  // the other supporting depts see all of their members' tasks.
  const scopeCte = `
    dept_emp as (
      select e.id emp, d.id dep, d.slug slug
        from employee_profiles e
        join departments d on d.id = e.department_id
       where e.organization_id = '${orgId}'
         and e.employment_status = 'active'
         and d.slug in (${slugList})
    ),
    td as (
      select distinct de.dep, ta.task_id
        from task_assignees ta
        join dept_emp de on de.emp = ta.employee_id
        join tasks t on t.id = ta.task_id
       where ta.organization_id = '${orgId}'
         and (de.slug <> '${CATEGORY_SCOPED_DEPT_SLUG}' or ${seoInList})
    )`;

  // Q1 — per-department scalars (open / overdue / delivered / on-time for the
  // selected AND previous period) plus client-changes entered in each period.
  const scalarSql = `
    with ${scopeCte},
    tk as (
      select td.dep, t.stage, t.archived_at, t.completed_at, t.due_date, t.planned_date,
             (t.completed_at at time zone 'Asia/Riyadh')::date cdate,
             coalesce(t.due_date, t.planned_date) deadline
        from td join tasks t on t.id = td.task_id
    ),
    cc as (
      select td.dep,
             count(distinct h.task_id) filter (
               where (h.entered_at at time zone 'Asia/Riyadh')::date between '${from}' and '${to}') cc_sel,
             count(distinct h.task_id) filter (
               where (h.entered_at at time zone 'Asia/Riyadh')::date between '${prevFrom}' and '${prevTo}') cc_prev
        from td
        join tasks ct on ct.id = td.task_id and ct.archived_at is null
        join task_stage_history h
          on h.task_id = td.task_id and h.to_stage = 'client_changes'
       where (h.entered_at at time zone 'Asia/Riyadh')::date between '${prevFrom}' and '${to}'
       group by td.dep
    )
    select k.dep,
      count(*) filter (where stage <> 'done' and archived_at is null) open_now,
      count(*) filter (where stage <> 'done' and archived_at is null and planned_date < '${today}') overdue_now,
      count(*) filter (where stage = 'done' and completed_at is not null
                         and cdate between '${from}' and '${to}') delivered_sel,
      count(*) filter (where stage = 'done' and completed_at is not null
                         and cdate between '${from}' and '${to}'
                         and deadline is not null and cdate <= deadline) ontime_sel,
      count(*) filter (where stage = 'done' and completed_at is not null
                         and cdate between '${prevFrom}' and '${prevTo}') delivered_prev,
      count(*) filter (where stage = 'done' and completed_at is not null
                         and cdate between '${prevFrom}' and '${prevTo}'
                         and deadline is not null and cdate <= deadline) ontime_prev,
      coalesce(max(cc.cc_sel), 0) cc_sel,
      coalesce(max(cc.cc_prev), 0) cc_prev
    from tk k
    left join cc on cc.dep = k.dep
    group by k.dep`;

  // Q2 — per-department per-day delivered/on-time over the 37-day sparkline
  // window (range + 6 lead-in days), for the rolling-7d on-time trend.
  const dailySql = `
    with ${scopeCte},
    done as (
      select td.dep, (t.completed_at at time zone 'Asia/Riyadh')::date cdate,
             (coalesce(t.due_date, t.planned_date) is not null
              and (t.completed_at at time zone 'Asia/Riyadh')::date <= coalesce(t.due_date, t.planned_date)) ontime
        from td join tasks t on t.id = td.task_id
       where t.stage = 'done' and t.completed_at is not null
         and (t.completed_at at time zone 'Asia/Riyadh')::date between '${sinceTrend}' and '${to}'
    )
    select dep, cdate::text daykey, count(*) total, count(*) filter (where ontime) ontime
      from done group by dep, cdate`;

  const [deptRows, scalarRows, dailyRows] = await Promise.all([
    supabaseAdmin
      .from("departments")
      .select("id, name, slug")
      .eq("organization_id", orgId)
      .in("slug", SUPPORTING_DEPARTMENT_SLUGS as unknown as string[]),
    execRunSql<{
      dep: string;
      open_now: number;
      overdue_now: number;
      delivered_sel: number;
      ontime_sel: number;
      delivered_prev: number;
      ontime_prev: number;
      cc_sel: number;
      cc_prev: number;
    }>(scalarSql),
    execRunSql<{ dep: string; daykey: string; total: number; ontime: number }>(dailySql),
  ]);
  if (deptRows.error) throw deptRows.error;

  const scalarByDep = new Map(scalarRows.map((r) => [r.dep, r]));
  const dailyByDep = new Map<string, Map<string, { total: number; onTime: number }>>();
  for (const r of dailyRows) {
    const m = dailyByDep.get(r.dep) ?? new Map();
    m.set(r.daykey, { total: r.total, onTime: r.ontime });
    dailyByDep.set(r.dep, m);
  }

  // 37-day axis (6 lead-in + range) — the rolling-7d series starts at index 6.
  const days37: string[] = [];
  for (let d = sinceTrend; d <= to; d = addDaysIso(d, 1)) days37.push(d);
  const trendStart = 6;
  const pctOf = (num: number, den: number): number | null =>
    den > 0 ? Math.round((num / den) * 100) : null;

  const rows: ServiceHealthRow[] = ((deptRows.data ?? []) as { id: string; name: string; slug: string }[]).map(
    (d) => {
      const s = scalarByDep.get(d.id);
      const daily = dailyByDep.get(d.id) ?? new Map<string, { total: number; onTime: number }>();
      const trend: Array<number | null> = [];
      for (let i = trendStart; i < days37.length; i++) {
        let total = 0;
        let onTime = 0;
        for (let j = i - 6; j <= i; j++) {
          const cell = daily.get(days37[j]);
          if (cell) {
            total += cell.total;
            onTime += cell.onTime;
          }
        }
        trend.push(pctOf(onTime, total));
      }
      return {
        serviceId: d.id,
        name: d.name,
        slug: d.slug,
        openCount: s?.open_now ?? 0,
        overdueCount: s?.overdue_now ?? 0,
        delivered30d: s?.delivered_sel ?? 0,
        onTimePct30d: pctOf(s?.ontime_sel ?? 0, s?.delivered_sel ?? 0),
        onTimePctPrev: pctOf(s?.ontime_prev ?? 0, s?.delivered_prev ?? 0),
        clientChanges: s?.cc_sel ?? 0,
        clientChangesPrev: s?.cc_prev ?? 0,
        trend,
      };
    },
  );

  return rows
    .filter((r) => r.openCount > 0 || r.delivered30d > 0 || r.clientChanges > 0)
    .sort((a, b) => b.openCount - a.openCount);
}

export const getSupportingDepartmentHealth = cache(_getSupportingDepartmentHealth);

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
      "id, stage, planned_date, progress_slip_percent, updated_at, archived_at, project:projects!inner(id, name, project_code, client:clients!inner(id, name))",
    )
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .neq("stage", "done");
  if (error) throw error;

  type Row = {
    planned_date: string | null;
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
  // Overdue = open task past deadline (team's Rwasem method).
  const todayStr = riyadhTodayIso();
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
    if (r.planned_date != null && r.planned_date < todayStr) cur.overdue += 1;
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
    .select("id, created_at, planned_date, stage, archived_at")
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
  // Overdue = open task past deadline (team's Rwasem method); rows are already
  // open + non-archived, so planned_date < today is the flag.
  const todayStr = riyadhTodayIso();
  for (const r of (data ?? []) as Array<{ created_at: string; planned_date: string | null }>) {
    const ageDays = Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000);
    const key: WipAgeBucket =
      ageDays <= 7 ? "0-7"
      : ageDays <= 14 ? "8-14"
      : ageDays <= 30 ? "15-30"
      : ageDays <= 90 ? "31-90"
      : "90+";
    buckets[key].count += 1;
    if (r.planned_date != null && r.planned_date < todayStr) buckets[key].overdueCount += 1;
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

async function _getStageFlowMatrix(
  orgId: string,
  range: DashboardRange = resolveRange(undefined),
): Promise<{
  cells: StageFlowCell[];
  topBackward: Array<{ from: TaskStage; to: TaskStage; count: number }>;
  totalForward: number;
  totalBackward: number;
}> {
  // Stage transitions that occurred within the selected window. PAGINATED: a
  // wide window easily exceeds the 1000-row PostgREST cap, and without paging the
  // arbitrary 1000-row slice made a LARGER window return FEWER transitions — so
  // the counts SHRANK as the period grew (Sky Light feedback 2026-07-07).
  const { start, endExclusive } = riyadhDateRangeUtcBounds(range.from, range.to);
  type Row = {
    task_id: string;
    from_stage: TaskStage;
    to_stage: TaskStage;
    // Embedded so we can drop moves on ARCHIVED tasks — those never appear in the
    // /tasks drill-down (it filters archived_at is null), so counting them made
    // the cell (e.g. 4) exceed the tasks the drill-down showed (e.g. 2). Inner
    // join = every history row still has its task. (Sky Light feedback 2026-07-12.)
    task: { archived_at: string | null } | { archived_at: string | null }[] | null;
  };
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("task_stage_history")
      .select("task_id, from_stage, to_stage, task:tasks!inner(archived_at)")
      .eq("organization_id", orgId)
      .gte("entered_at", start)
      .lt("entered_at", endExclusive)
      .not("from_stage", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }

  const orderIdx: Record<string, number> = {};
  FUNNEL_STAGE_ORDER.forEach((s, i) => (orderIdx[s] = i));

  // Per-edge count = DISTINCT tasks (a task that bounces the same from→to edge
  // twice is ONE task in the drill-down `/tasks?flow=` list, which de-dupes by
  // task_id — so the card count must too, else "the number differs when you open
  // the tasks"). totalForward/Backward stay movement-based (they drive the
  // backward-% ratio, a property of movements, not tasks).
  const edgeTasks = new Map<string, Set<string>>();
  let totalForward = 0;
  let totalBackward = 0;
  for (const r of rows) {
    if (!r.from_stage || !r.to_stage || r.from_stage === r.to_stage) continue;
    // Skip moves on archived tasks — the drill-down (/tasks) excludes them, so
    // counting them here would inflate the cell above the tasks it lands on.
    const task = Array.isArray(r.task) ? r.task[0] : r.task;
    if (task?.archived_at != null) continue;
    const key = `${r.from_stage}>${r.to_stage}`;
    const set = edgeTasks.get(key) ?? new Set<string>();
    set.add(r.task_id);
    edgeTasks.set(key, set);
    const fi = orderIdx[r.from_stage] ?? 0;
    const ti = orderIdx[r.to_stage] ?? 0;
    if (ti < fi) totalBackward += 1;
    else totalForward += 1;
  }

  const cells: StageFlowCell[] = [];
  for (const from of FUNNEL_STAGE_ORDER) {
    for (const to of FUNNEL_STAGE_ORDER) {
      if (from === to) continue;
      const c = edgeTasks.get(`${from}>${to}`)?.size ?? 0;
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
  // Tasks currently sitting at client_changes right now (point-in-time).
  activeNow: number;
  // Distinct tasks that ENTERED client_changes during the selected window.
  enteredThisPeriod: number;
  // Distinct tasks that were IN client_changes at any point during the selected
  // window — entered during it OR carried over from before (still there).
  existedThisPeriod: number;
  // Same "existed" (occupancy) count for the immediately-preceding window — used
  // for the period-over-period trend.
  existedLastPeriod: number;
  // Per-service breakdown of tasks currently at client_changes.
  byService: Array<{ name: string; slug: string; count: number }>;
}

async function _getTopRevisedTasks(
  orgId: string,
  range: DashboardRange = resolveRange(undefined),
): Promise<ClientEditsMetrics> {
  // "Entered client_changes" is windowed to the picker (this window vs the
  // immediately-preceding one of equal length); active-now / by-service are
  // point-in-time (tasks sitting at client_changes right now).
  const rangeStartDay = range.from;
  const priorStartDay = addDaysIso(range.from, -range.days);
  const { start: priorStart, endExclusive } = riyadhDateRangeUtcBounds(
    priorStartDay,
    range.to,
  );
  const { start: rangeStart } = riyadhDateRangeUtcBounds(rangeStartDay, range.to);

  type LiveRow = { id: string; service_id: string | null };
  type HistRow = { task_id: string; entered_at: string; exited_at: string | null };

  async function fetchLiveRows(): Promise<LiveRow[]> {
    const rows: LiveRow[] = [];
    const PAGE = 1000;

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .select("id, service_id")
        .eq("organization_id", orgId)
        .eq("stage", "client_changes")
        .is("archived_at", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      rows.push(...((data ?? []) as LiveRow[]));
      if (!data || data.length < PAGE) break;
    }

    return rows;
  }

  async function fetchHistoryRows(): Promise<HistRow[]> {
    const rows: HistRow[] = [];
    const PAGE = 1000;

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("task_stage_history")
        .select("task_id, entered_at, exited_at, task:tasks!inner(archived_at)")
        .eq("organization_id", orgId)
        .eq("to_stage", "client_changes")
        // Match the live count's scope: exclude archived (wound-down / lost-
        // client) tasks. Otherwise the period count is inflated and its trend
        // can invert (a lost-client batch in the prior window made client-
        // changes look like they were falling when they were rising).
        .is("task.archived_at", null)
        // Fetch every client_changes occupancy that OVERLAPS the combined
        // [priorStart, endExclusive) window — i.e. entered before the window
        // ended AND had not yet left when the window began. This captures tasks
        // that entered earlier but were still sitting in the stage during the
        // window (carried over), not just those that entered inside it.
        .lt("entered_at", endExclusive)
        .or(`exited_at.is.null,exited_at.gt.${priorStart}`)
        .order("entered_at", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      rows.push(...((data ?? []) as HistRow[]));
      if (!data || data.length < PAGE) break;
    }

    return rows;
  }

  const [live, hist, servicesRes] = await Promise.all([
    fetchLiveRows(),
    fetchHistoryRows(),

    // Service name map.
    supabaseAdmin
      .from("services")
      .select("id, name, slug")
      .eq("organization_id", orgId)
      .eq("is_active", true),
  ]);

  if (servicesRes.error) throw servicesRes.error;

  const activeNow = live.length;

  // The period card breaks into three counters:
  //   • entered   — tasks that newly ENTERED client_changes during the window.
  //   • existed   — tasks that were IN client_changes at any point during the
  //                 window (entered during it OR carried over and still there).
  //   • activeNow — tasks sitting in client_changes right now (computed above).
  // A stage occupancy is the interval [entered_at, exited_at) (open-ended while
  // still in the stage); "existed" counts it when the interval overlaps the
  // window, "entered" counts it only when entered_at falls inside the window.
  const enteredThisIds = new Set<string>();
  const existedThisIds = new Set<string>();
  const existedLastIds = new Set<string>();
  for (const r of hist) {
    // existed — this window [rangeStart, endExclusive): entered before it ends
    // (always true given the fetch) AND had not left before it began.
    if (r.exited_at === null || r.exited_at > rangeStart) {
      existedThisIds.add(r.task_id);
      // entered — occupancy that began inside this window.
      if (r.entered_at >= rangeStart) enteredThisIds.add(r.task_id);
    }
    // existed — prior window [priorStart, rangeStart): entered before it ends AND
    // had not left before it began.
    if (r.entered_at < rangeStart && (r.exited_at === null || r.exited_at > priorStart)) {
      existedLastIds.add(r.task_id);
    }
  }
  // Safety net: any task sitting in client_changes right now was, by definition,
  // present during the current window — include it in "existed" even if its
  // history row is missing (data-quality gaps in imported stage history).
  for (const t of live) existedThisIds.add(t.id);

  const enteredThisPeriod = enteredThisIds.size;
  const existedThisPeriod = existedThisIds.size;
  const existedLastPeriod = existedLastIds.size;

  // Count active tasks per service.
  const svcCount = new Map<string, number>();
  for (const t of live) {
    if (t.service_id) svcCount.set(t.service_id, (svcCount.get(t.service_id) ?? 0) + 1);
  }

  type SvcRow = { id: string; name: string; slug: string };
  const svcMap = new Map<string, { name: string; slug: string }>();
  for (const s of (servicesRes.data ?? []) as SvcRow[]) svcMap.set(s.id, { name: s.name, slug: s.slug });

  // Merge Renewal variants onto the base service. Names carry a leading emoji
  // (e.g. "🔵Renewal Social Media"), so we key on serviceGroupKey() — which drops
  // the emoji AND the Renewal prefix — and display via displayServiceName() (keeps
  // the emoji, drops the Renewal word). Same helpers the service-health card uses.
  const byServiceMerged = new Map<string, { name: string; slug: string; count: number }>();
  for (const [svcId, count] of svcCount.entries()) {
    const svc = svcMap.get(svcId);
    if (!svc) continue;
    const key = serviceGroupKey(svc.name);
    const existing = byServiceMerged.get(key);
    if (existing) {
      existing.count += count;
      // Prefer the base (non-renewal) service's slug/name for tone + label.
      if (!isRenewalName(svc.name)) {
        existing.name = displayServiceName(svc.name);
        existing.slug = svc.slug;
      }
    } else {
      byServiceMerged.set(key, { name: displayServiceName(svc.name), slug: svc.slug, count });
    }
  }

  const byService = Array.from(byServiceMerged.values()).sort((a, b) => b.count - a.count);

  return { activeNow, enteredThisPeriod, existedThisPeriod, existedLastPeriod, byService };
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

// Live "currently overdue" count using the method the Sky Light team actually
// uses in Rwasem: an OPEN task (stage <> done) whose deadline (planned_date) is
// before today. NOT tasks.is_overdue — the team confirmed Odoo's is_overdue
// flag is buggy in their build (it excludes not-started open work, under-
// reporting ~41 vs the real ~138). planned_date < current_date is evaluated at
// query time, so this is always fresh and reconciles with Rwasem.
//
// "today" MUST be Riyadh-local: the team filters Rwasem in Asia/Riyadh, so using
// the UTC date here under-counts by a full day between 21:00–24:00 UTC (verified
// 2026-06-30: UTC said 119, Rwasem/Riyadh said 139). See src/lib/tz.ts.
async function countOverdueNow(orgId: string): Promise<number> {
  const today = riyadhTodayIso();
  const { count, error } = await supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .lt("planned_date", today)
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
    .select("id, task:tasks!inner(archived_at)", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("to_stage", "client_changes")
    // Exclude archived (wound-down / lost-client) tasks — consistent scoping
    // with the live count so the score input isn't inflated.
    .is("task.archived_at", null)
    .gte("entered_at", isoTs);
  if (error) return 0;
  return count ?? 0;
}

// Re-export the Odoo metrics shape for the page composition layer.
export type { DashboardOdooMetrics };
