import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TASK_OWNER_ROLE_LABELS, type TaskOwnerRoleKey } from "@/lib/labels";
import { isLeadershipPosition, isLeadershipSql } from "@/lib/data/leadership";

// =========================================================================
// Team Pulse (نبض الفريق) — employee MOVEMENT & ACTIVITY, not SLA quality.
//
// Per the Sky Light team's split of responsibilities:
//   * المساءلة (/accountability) owns SLA + stage compliance (quality).
//   * نبض الفريق owns "حركة ونشاط الموظفين" — who is moving work right now,
//     who has stalled, and how much work is stuck.
//
// So this reads RAW STAGE TRANSITIONS (task_stage_history) as the activity
// signal — NOT logins (the old employee_activity_daily feed was dead because
// agents don't log in) and NOT the SLA score (that lives in المساءلة).
//
// Scoped to LIVE (non-archived) tasks so the query is small and fast (~1.6k
// task-assignee pairs) and reflects CURRENT activity, not history. Leadership
// is excluded (agents-only, mirroring المساءلة). One query, rolled up to
// department + org in TS. Honest: an employee with no live tasks simply isn't
// on the board (no current duty), counted separately as noDuty.
// =========================================================================

export type ActivityStatus = "active" | "slow" | "stalled";
export type PulseStatus = "good" | "watch" | "risk" | "na";
// Workload vs the team: drowning / normal / has spare capacity.
export type LoadFlag = "overloaded" | "balanced" | "light";

// Activity-status thresholds (calendar days since last stage movement).
const ACTIVE_DAYS = 2;
const SLOW_DAYS = 5;
// A task with no stage movement in this many days is "stuck" (needs a push).
// (Encoded in the SQL below; kept here for documentation.)
export const STUCK_DAYS = 3;

export interface TeamMemberRow {
  employeeId: string;
  fullName: string;
  positionLabel: string | null;
  departmentId: string | null;
  // The core "is he working in Rwasem now" signal: most recent ACTION (a stage
  // move OR a Log Note) and how many actions today / this week.
  lastActionAt: string | null;
  actionsToday: number;
  actionsThisWeek: number;
  lastMoveAt: string | null;
  status: ActivityStatus;
  momentum: number; // actionsThisWeek - actionsPrevWeek (↑/↓)
  completedThisWeek: number;
  openWip: number; // open live tasks owned
  stuckTasks: number; // open tasks not moved in STUCK_DAYS+
  loadFlag: LoadFlag; // workload vs the team median
  lastUpdateAt: string | null; // most recent Log Note on their tasks
  updatesThisWeek: number; // Log Notes on their tasks in the last 7 days
  noUpdateTasks: number; // open tasks with no Log Note in STUCK_DAYS+
  // قائد الفريق / مدير القسم. Shown in the member list for visibility, but kept
  // OUT of the department status math (a lead who doesn't act on Rwasem must not
  // make the team read as "stalled").
  isLeadership: boolean;
}

export interface TeamPulseRow {
  departmentId: string;
  departmentName: string;
  headEmployeeId: string | null;
  headName: string | null;
  headcount: number; // members with current duty (live tasks)
  activeCount: number;
  slowCount: number;
  stalledCount: number;
  actionsToday: number;
  actionsThisWeek: number;
  momentum: number;
  completedThisWeek: number;
  openWip: number;
  stuckTasks: number;
  overloadedCount: number;
  lightCount: number;
  updatesThisWeek: number;
  noUpdateTasks: number;
  status: PulseStatus;
}

export interface TeamPulseTotals {
  departments: number;
  headcount: number;
  activeCount: number;
  slowCount: number;
  stalledCount: number;
  actionsToday: number;
  actionsThisWeek: number;
  momentum: number;
  completedThisWeek: number;
  openWip: number;
  stuckTasks: number;
  overloadedCount: number;
  lightCount: number;
  updatesThisWeek: number;
  noUpdateTasks: number;
}

export interface TeamPulseOverview {
  generatedAt: string;
  /** Most recent action timestamp across the org — the "last synced from Rwasem" freshness stamp. */
  lastActionAt: string | null;
  rows: TeamPulseRow[];
  totals: TeamPulseTotals;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Department visibility in نبض الفريق is per-department (departments.
// show_in_team_pulse, migration 0225) — editable from the departments admin.

// This page measures EMPLOYEE activity, so the team status reflects whether
// PEOPLE are moving — not the task backlog (which is shown separately as the
// "متوقّفة" count). A team is at risk when most of its people have stopped;
// watch when a quarter have stopped or movement is dropping.
function deptStatus(
  stalledCount: number,
  headcount: number,
  momentum: number,
): PulseStatus {
  if (headcount === 0) return "na";
  const stalledShare = stalledCount / headcount;
  if (stalledShare >= 0.5) return "risk";
  if (stalledShare >= 0.25 || momentum < 0) return "watch";
  return "good";
}

interface ActivitySqlRow {
  employee_id: string;
  full_name: string | null;
  job_title: string | null;
  position_role: string | null;
  position_name: string | null;
  department_id: string | null;
  last_action: string | null;
  last_move: string | null;
  actions_today: number;
  actions7: number;
  actions_prev: number;
  open_wip: number;
  stalled: number;
  done7: number;
  last_update: string | null;
  updates7: number;
  no_update: number;
}

async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`team-pulse query failed: ${error.message}`);
  return (data ?? []) as T[];
}

// Status from the most recent ACTION in Rwasem (stage move OR Log Note) — this
// is the "is he working now" signal the team asked for.
function statusOf(lastAction: string | null): ActivityStatus {
  if (!lastAction) return "stalled";
  const days = (Date.now() - new Date(lastAction).getTime()) / 86_400_000;
  if (days <= ACTIVE_DAYS) return "active";
  if (days <= SLOW_DAYS) return "slow";
  return "stalled";
}

// Shared per-employee activity loader (leadership-filtered). Scoped to live
// tasks. Cached per request so the overview + drill-down reuse one query.
async function _loadActivityRows(orgId: string): Promise<TeamMemberRow[]> {
  if (!UUID_RE.test(orgId)) throw new Error("team-pulse: invalid org id");
  // Read the precomputed team_activity_cache (0218), refreshed by pg_cron every
  // 10 min. The live per-task aggregate over task_stage_history + task_comments
  // is fast warm but spikes past the 12s RPC cap cold/under load → page error
  // boundary. The cache makes this a trivial indexed join. Names / position /
  // department are joined fresh so they never go stale; status / load / momentum
  // are still derived live in TS from the cached counters.
  // Start from active employees (so leadership shows even with no task activity)
  // and LEFT JOIN the cache. Keep only people who either have activity OR are
  // leadership — i.e. the executors with current work, plus قائد الفريق /
  // مدير القسم for visibility. Counters coalesce to 0 when there's no cache row.
  const rows = await runSql<ActivitySqlRow>(`
    select e.id employee_id, e.full_name, e.job_title,
           pp.role position_role, pp.name position_name, e.department_id,
           c.last_action, c.last_move,
           coalesce(c.actions_today,0) actions_today, coalesce(c.actions7,0) actions7,
           coalesce(c.actions_prev,0) actions_prev,
           coalesce(c.open_wip,0) open_wip, coalesce(c.stalled,0) stalled,
           coalesce(c.done7,0) done7,
           c.last_update, coalesce(c.updates7,0) updates7, coalesce(c.no_update,0) no_update
      from employee_profiles e
      left join positions pp on pp.id = e.position_id
      left join team_activity_cache c
        on c.employee_id = e.id and c.organization_id = e.organization_id
     where e.organization_id = '${orgId}'
       and e.employment_status = 'active'
       and e.department_id is not null
       and (c.employee_id is not null or ${isLeadershipSql("pp")})
  `);

  const out: TeamMemberRow[] = [];
  for (const r of rows) {
    // نبض الفريق INCLUDES leadership (قائد الفريق / مدير القسم) — unlike the
    // agents-only performance tables. The team wants to see who's active across
    // the whole department, leads included. (Accountability stays agents-only.)
    out.push({
      employeeId: r.employee_id,
      fullName: r.full_name ?? "—",
      // Prefer the real position NAME (e.g. "مدير القسم المساند", "قائد الفريق")
      // so leads aren't mislabeled by their attribution role (a dept head can
      // carry role='agent'). Fall back to the role label, then the job title.
      positionLabel:
        r.position_name ??
        (r.position_role
          ? (TASK_OWNER_ROLE_LABELS[r.position_role as TaskOwnerRoleKey] ?? r.job_title)
          : r.job_title),
      departmentId: r.department_id,
      lastActionAt: r.last_action,
      actionsToday: r.actions_today,
      actionsThisWeek: r.actions7,
      lastMoveAt: r.last_move,
      status: statusOf(r.last_action),
      momentum: r.actions7 - r.actions_prev,
      completedThisWeek: r.done7,
      openWip: r.open_wip,
      stuckTasks: r.stalled,
      loadFlag: "balanced", // set in the capacity pass below
      lastUpdateAt: r.last_update,
      updatesThisWeek: r.updates7,
      noUpdateTasks: r.no_update,
      isLeadership: isLeadershipPosition({ role: r.position_role, name: r.position_name }),
    });
  }

  // Capacity pass: classify workload vs the team median WIP. Overloaded =
  // well above median (and not trivially small); light = well below. This
  // surfaces the load imbalance (median ~15 but some agents carry 200+).
  const wips = out.map((m) => m.openWip).filter((v) => v > 0).sort((a, b) => a - b);
  const median = wips.length
    ? wips.length % 2
      ? wips[(wips.length - 1) / 2]
      : Math.round((wips[wips.length / 2 - 1] + wips[wips.length / 2]) / 2)
    : 0;
  for (const m of out) {
    if (median > 0 && m.openWip >= Math.max(8, median * 1.5)) m.loadFlag = "overloaded";
    else if (median > 0 && m.openWip <= median * 0.5) m.loadFlag = "light";
    else m.loadFlag = "balanced";
  }
  return out;
}

const loadActivityRows = cache(_loadActivityRows);

async function _getTeamPulseOverview(orgId: string): Promise<TeamPulseOverview> {
  const members = await loadActivityRows(orgId);

  const [{ data: depts }, { data: emps }] = await Promise.all([
    supabaseAdmin
      .from("departments")
      .select("id, name, head_employee_id, show_in_team_pulse")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("employee_profiles")
      .select("id, full_name")
      .eq("organization_id", orgId),
  ]);
  const deptById = new Map(
    (
      (depts as
        | {
            id: string;
            name: string;
            head_employee_id: string | null;
            show_in_team_pulse: boolean;
          }[]
        | null) ?? []
    ).map((d) => [d.id, d]),
  );
  const nameById = new Map(
    ((emps as { id: string; full_name: string | null }[] | null) ?? []).map((e) => [
      e.id,
      e.full_name,
    ]),
  );

  const byDept = new Map<string, TeamMemberRow[]>();
  for (const m of members) {
    if (!m.departmentId) continue;
    const list = byDept.get(m.departmentId) ?? [];
    list.push(m);
    byDept.set(m.departmentId, list);
  }

  const rows: TeamPulseRow[] = [];
  for (const [deptId, list] of byDept) {
    const dept = deptById.get(deptId);
    if (!dept) continue;
    if (!dept.show_in_team_pulse) continue;
    // Dept status/headcount reflect the EXECUTORS only; leads ride along in the
    // member list but don't move the activity signal. Skip pure-leadership depts
    // (e.g. القيادة) — they have no executing team to measure.
    const execList = list.filter((m) => !m.isLeadership);
    if (execList.length === 0) continue;
    const agg = execList.reduce(
      (a, m) => {
        a.activeCount += m.status === "active" ? 1 : 0;
        a.slowCount += m.status === "slow" ? 1 : 0;
        a.stalledCount += m.status === "stalled" ? 1 : 0;
        a.actionsToday += m.actionsToday;
        a.actionsThisWeek += m.actionsThisWeek;
        a.momentum += m.momentum;
        a.completedThisWeek += m.completedThisWeek;
        a.openWip += m.openWip;
        a.stuckTasks += m.stuckTasks;
        a.overloadedCount += m.loadFlag === "overloaded" ? 1 : 0;
        a.lightCount += m.loadFlag === "light" ? 1 : 0;
        a.updatesThisWeek += m.updatesThisWeek;
        a.noUpdateTasks += m.noUpdateTasks;
        return a;
      },
      {
        activeCount: 0,
        slowCount: 0,
        stalledCount: 0,
        actionsToday: 0,
        actionsThisWeek: 0,
        momentum: 0,
        completedThisWeek: 0,
        openWip: 0,
        stuckTasks: 0,
        overloadedCount: 0,
        lightCount: 0,
        updatesThisWeek: 0,
        noUpdateTasks: 0,
      },
    );
    rows.push({
      departmentId: deptId,
      departmentName: dept.name,
      headEmployeeId: dept.head_employee_id,
      headName: dept.head_employee_id ? (nameById.get(dept.head_employee_id) ?? null) : null,
      headcount: execList.length,
      ...agg,
      status: deptStatus(agg.stalledCount, execList.length, agg.momentum),
    });
  }

  // Worst-first: risk → watch → good → na; within a band, most stuck tasks first.
  const statusRank: Record<PulseStatus, number> = { risk: 0, watch: 1, good: 2, na: 3 };
  rows.sort((a, b) =>
    statusRank[a.status] !== statusRank[b.status]
      ? statusRank[a.status] - statusRank[b.status]
      : b.stuckTasks - a.stuckTasks,
  );

  const totals = rows.reduce<TeamPulseTotals>(
    (t, r) => {
      t.departments += 1;
      t.headcount += r.headcount;
      t.activeCount += r.activeCount;
      t.slowCount += r.slowCount;
      t.stalledCount += r.stalledCount;
      t.actionsToday += r.actionsToday;
      t.actionsThisWeek += r.actionsThisWeek;
      t.momentum += r.momentum;
      t.completedThisWeek += r.completedThisWeek;
      t.openWip += r.openWip;
      t.stuckTasks += r.stuckTasks;
      t.overloadedCount += r.overloadedCount;
      t.lightCount += r.lightCount;
      t.updatesThisWeek += r.updatesThisWeek;
      t.noUpdateTasks += r.noUpdateTasks;
      return t;
    },
    {
      departments: 0,
      headcount: 0,
      activeCount: 0,
      slowCount: 0,
      stalledCount: 0,
      actionsToday: 0,
      actionsThisWeek: 0,
      momentum: 0,
      completedThisWeek: 0,
      openWip: 0,
      stuckTasks: 0,
      overloadedCount: 0,
      lightCount: 0,
      updatesThisWeek: 0,
      noUpdateTasks: 0,
    },
  );

  // Org-wide freshness stamp: the most recent action timestamp.
  const lastActionAt = members.reduce<string | null>((max, m) => {
    if (m.lastActionAt && (!max || m.lastActionAt > max)) return m.lastActionAt;
    return max;
  }, null);

  return { generatedAt: new Date().toISOString(), lastActionAt, rows, totals };
}

export const getTeamPulseOverview = cache(_getTeamPulseOverview);

async function _getTeamMembers(orgId: string, departmentId: string): Promise<TeamMemberRow[]> {
  const members = await loadActivityRows(orgId);
  const statusRank: Record<ActivityStatus, number> = { stalled: 0, slow: 1, active: 2 };
  return members
    .filter((m) => m.departmentId === departmentId)
    .sort((a, b) => {
      // Executors first (worst-first within); leads (قائد الفريق / مدير القسم)
      // ride at the bottom so an inactive lead never tops the list.
      if (a.isLeadership !== b.isLeadership) return a.isLeadership ? 1 : -1;
      return statusRank[a.status] !== statusRank[b.status]
        ? statusRank[a.status] - statusRank[b.status]
        : b.stuckTasks - a.stuckTasks;
    });
}

export const getTeamMembers = cache(_getTeamMembers);

export interface AllMemberRow extends TeamMemberRow {
  departmentName: string | null;
}

// Flat cross-department roster, sorted LEAST active → MOST active (the team
// wants one place to spot who's quiet across the whole org, not per-dept).
async function _getAllMembersByActivity(orgId: string): Promise<AllMemberRow[]> {
  const [members, { data: depts }] = await Promise.all([
    loadActivityRows(orgId),
    supabaseAdmin
      .from("departments")
      .select("id, name, show_in_team_pulse")
      .eq("organization_id", orgId),
  ]);
  const deptRows =
    (depts as { id: string; name: string; show_in_team_pulse: boolean }[] | null) ?? [];
  const deptName = new Map(deptRows.map((d) => [d.id, d.name]));
  const visibleDept = new Map(deptRows.map((d) => [d.id, d.show_in_team_pulse]));
  return members
    .filter((m) => m.departmentId && visibleDept.get(m.departmentId) !== false)
    .map((m) => ({
      ...m,
      departmentName: m.departmentId ? (deptName.get(m.departmentId) ?? null) : null,
    }))
    // Least active first: fewest week actions, then fewest today, then stalest.
    .sort(
      (a, b) =>
        a.actionsThisWeek - b.actionsThisWeek ||
        a.actionsToday - b.actionsToday ||
        (a.lastActionAt ?? "").localeCompare(b.lastActionAt ?? ""),
    );
}

export const getAllMembersByActivity = cache(_getAllMembersByActivity);

// ---- Per-employee action breakdown (drill-down) --------------------------
// What the "actions in Rwasem" number is actually made of: which tasks the
// person acted on, in which project, and how many stage moves vs Log Notes.
// Scoped to one employee's tasks over a window → small + fast (live, no cache).

export interface ActionLogRow {
  taskId: string;
  taskCode: string | null;
  title: string;
  projectName: string | null;
  moves: number; // stage transitions in the window
  notes: number; // Log Notes in the window
  total: number;
  lastActionAt: string | null;
}

interface ActionLogSqlRow {
  task_id: string;
  task_code: string | null;
  title: string | null;
  project_name: string | null;
  moves: number;
  notes: number;
  total: number;
  last_action: string | null;
}

// Date-only bound (YYYY-MM-DD). Anything else is ignored.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function _getEmployeeActionLog(
  orgId: string,
  employeeId: string,
  days = 30,
  from?: string | null,
  to?: string | null,
): Promise<ActionLogRow[]> {
  if (!UUID_RE.test(orgId) || !UUID_RE.test(employeeId)) return [];

  // Two windowing modes:
  //   • explicit [from, to] calendar dates (the CEO's date filter — lets him
  //     drill into a single day or a custom span), inclusive of both ends.
  //   • rolling "last N days" (the default presets).
  // The explicit range wins when both bounds are valid dates.
  const useRange = !!from && !!to && ISO_DATE_RE.test(from) && ISO_DATE_RE.test(to) && from <= to;
  const win = Math.max(1, Math.min(365, Math.floor(days)));
  // `to` is inclusive → compare against the day AFTER it (exclusive upper bound).
  const movePredicate = useRange
    ? `h.entered_at >= '${from}'::date and h.entered_at < ('${to}'::date + 1)`
    : `h.entered_at >= now() - interval '${win} days'`;
  const notePredicate = useRange
    ? `c.created_at >= '${from}'::date and c.created_at < ('${to}'::date + 1)`
    : `c.created_at >= now() - interval '${win} days'`;

  const rows = await runSql<ActionLogSqlRow>(`
    with my as (
      select ta.task_id
        from task_assignees ta
        join tasks t on t.id = ta.task_id
       where ta.role_type = 'agent' and ta.employee_id = '${employeeId}'
         and ta.organization_id = '${orgId}'
         and t.archived_at is null
    ),
    mv as (
      select h.task_id, count(*) c, max(h.entered_at) la
        from task_stage_history h
       where h.task_id in (select task_id from my)
         and ${movePredicate}
       group by 1
    ),
    nt as (
      select c.task_id, count(*) c, max(c.created_at) la
        from task_comments c
       where c.task_id in (select task_id from my)
         and ${notePredicate}
       group by 1
    )
    select t.id task_id, t.task_code, t.title, p.name project_name,
           coalesce(mv.c,0) moves, coalesce(nt.c,0) notes,
           coalesce(mv.c,0) + coalesce(nt.c,0) total,
           greatest(mv.la, nt.la) last_action
      from tasks t
      left join projects p on p.id = t.project_id
      left join mv on mv.task_id = t.id
      left join nt on nt.task_id = t.id
     where t.id in (select task_id from my)
       and (mv.c is not null or nt.c is not null)
     order by total desc, last_action desc nulls last
     limit 100
  `);
  return rows.map((r) => ({
    taskId: r.task_id,
    taskCode: r.task_code,
    title: (r.title ?? "").trim() || "—",
    projectName: r.project_name,
    moves: r.moves,
    notes: r.notes,
    total: r.total,
    lastActionAt: r.last_action,
  }));
}

export const getEmployeeActionLog = cache(_getEmployeeActionLog);
