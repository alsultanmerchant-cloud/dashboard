import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Index 1 — Delivery Commitment Score (مؤشر الالتزام بالتسليم), per individual.
//
// Measures whether the person keeps their work moving and delivered on time:
//   - tasks delivered on their deadline   (on-time %)
//   - currently overdue tasks             (open board)
//   - average lateness on missed deliveries
//   - projects running late that they're in
//   - blocked tasks (derived from dependencies — flagged low-confidence)
//
// DATA-QUALITY NOTE (verified against prod): Odoo-synced tasks carry their
// deadline in `planned_date`, NOT `due_date` (which is ~100% null), so the
// deadline is coalesce(due_date, planned_date). Completion date is
// coalesce(actual_done_date, completed_at::date). When a window has no
// deadline-bearing completions, on-time is N/A (never fabricated as 100%) —
// the same honesty rule as the growth scorecard. The score is confidence-
// weighted so a thin on-time sample can't dominate the headline.
// =========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`delivery-commitment: invalid ${label}`);
  return value.toLowerCase();
}

async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", { p_sql: sql.trim() });
  if (error) throw new Error(`delivery-commitment query failed: ${error.message}`);
  return (data ?? []) as T[];
}

// Below this many deadline-decidable deliveries the on-time rate is treated as
// thin (mirrors the growth scorecard's LOW_SAMPLE gate).
const LOW_SAMPLE = 5;
// Average lateness (calendar days) at which the delay sub-score bottoms out.
const DELAY_FLOOR_DAYS = 14;

const round1 = (n: number) => Math.round(n * 10) / 10;

function blend(parts: Array<{ w: number; v: number | null }>): number | null {
  let sumW = 0;
  let sum = 0;
  for (const p of parts) {
    if (p.v === null) continue;
    sumW += p.w;
    sum += p.w * p.v;
  }
  return sumW === 0 ? null : Math.round(Math.max(0, Math.min(100, sum / sumW)));
}

export interface OnTimeTrend {
  pct: number | null; // current-window on-time %
  onTime: number; // delivered on or before deadline
  decidable: number; // completions that HAD a deadline (the denominator)
  prevPct: number | null; // prior-window %, when comparable
  delta: number | null; // pct − prevPct
  improved: boolean | null;
  noBaseline: boolean; // prior window too thin to compare
}

export interface DeliveryCommitment {
  score: number | null; // 0–100 composite
  scoreConfidence: "high" | "low";
  onTime: OnTimeTrend;
  openTasks: number;
  overdueTasks: number; // currently open & overdue
  avgLatenessDays: number | null; // mean calendar-day lateness on MISSED deliveries (window)
  lateProjects: number; // distinct projects with an open overdue owned task
  blockedTasks: number; // derived: open owned task whose dependency isn't done
}

type WindowRow = {
  cur_decidable: number;
  cur_ontime: number;
  cur_avg_late: number | null;
  prev_decidable: number;
  prev_ontime: number;
  open_overdue: number;
  open_tasks: number;
  late_projects: number;
};

async function _getDeliveryCommitment(
  orgId: string,
  employeeId: string,
): Promise<DeliveryCommitment> {
  const org = uuid(orgId, "orgId");
  const emp = uuid(employeeId, "employeeId");

  // The person's executing (agent-role) tasks, with normalized deadline +
  // completion date. Deadline = coalesce(due_date, planned_date) per the Odoo
  // data-quality note above.
  const mainSql = `
with mine as (
  select t.id, t.stage, t.is_overdue, t.project_id,
         coalesce(t.due_date, t.planned_date) as dl,
         coalesce(t.actual_done_date, t.completed_at::date) as done_d,
         (t.stage = 'done' or t.actual_done_date is not null) as completed
    from tasks t
    join task_assignees ta on ta.task_id = t.id and ta.role_type = 'agent' and ta.employee_id = '${emp}'
   where t.organization_id = '${org}' and t.archived_at is null
)
select
  count(*) filter (where completed and done_d >= (now() - interval '30 days')::date and dl is not null) as cur_decidable,
  count(*) filter (where completed and done_d >= (now() - interval '30 days')::date and dl is not null and done_d <= dl) as cur_ontime,
  round(avg(greatest(done_d - dl, 0)) filter (where completed and done_d >= (now() - interval '30 days')::date and dl is not null and done_d > dl), 1) as cur_avg_late,
  count(*) filter (where completed and done_d >= (now() - interval '60 days')::date and done_d < (now() - interval '30 days')::date and dl is not null) as prev_decidable,
  count(*) filter (where completed and done_d >= (now() - interval '60 days')::date and done_d < (now() - interval '30 days')::date and dl is not null and done_d <= dl) as prev_ontime,
  count(*) filter (where stage <> 'done' and is_overdue) as open_overdue,
  count(*) filter (where stage <> 'done') as open_tasks,
  count(distinct project_id) filter (where stage <> 'done' and is_overdue and project_id is not null) as late_projects
from mine`;

  // Blocked (derived): an open owned task that is the TARGET of a dependency
  // whose SOURCE task isn't done yet. Sparse data → flagged low-confidence in UI.
  const blockedSql = `
with mine as (
  select t.id from tasks t
  join task_assignees ta on ta.task_id = t.id and ta.role_type = 'agent' and ta.employee_id = '${emp}'
  where t.organization_id = '${org}' and t.archived_at is null and t.stage <> 'done'
)
select count(distinct m.id) as blocked
  from mine m
  join task_links l on l.target_task_id = m.id and l.organization_id = '${org}'
  join tasks s on s.id = l.source_task_id
 where s.stage <> 'done' and s.archived_at is null`;

  const [mainRows, blockedRows] = await Promise.all([
    runSql<WindowRow>(mainSql),
    runSql<{ blocked: number }>(blockedSql),
  ]);
  const r = mainRows[0] ?? {
    cur_decidable: 0,
    cur_ontime: 0,
    cur_avg_late: null,
    prev_decidable: 0,
    prev_ontime: 0,
    open_overdue: 0,
    open_tasks: 0,
    late_projects: 0,
  };
  const blocked = blockedRows[0]?.blocked ?? 0;

  const pct = r.cur_decidable > 0 ? Math.round((r.cur_ontime / r.cur_decidable) * 100) : null;
  const prevPct =
    r.prev_decidable > 0 ? Math.round((r.prev_ontime / r.prev_decidable) * 100) : null;
  const noBaseline = prevPct === null || r.prev_decidable < LOW_SAMPLE;
  const delta = pct !== null && prevPct !== null && !noBaseline ? pct - prevPct : null;
  const improved = delta === null || delta === 0 ? null : delta > 0;

  const avgLate = r.cur_avg_late != null ? round1(r.cur_avg_late) : null;
  const nonOverdue =
    r.open_tasks > 0 ? round1(100 * (1 - r.open_overdue / r.open_tasks)) : null;
  // Delay sub-score: 100 when nothing was late this window, else decays toward 0
  // as average lateness approaches DELAY_FLOOR_DAYS. Null when nothing decidable.
  const delayScore =
    r.cur_decidable === 0
      ? null
      : avgLate === null
        ? 100 // had deadline-bearing deliveries, none late
        : round1(100 * Math.max(0, 1 - avgLate / DELAY_FLOOR_DAYS));

  // On-time weight scales with its own sample so a thin rate can't dominate.
  const onTimeWeight = (0.55 * Math.min(r.cur_decidable, LOW_SAMPLE)) / LOW_SAMPLE;
  const score = blend([
    { w: onTimeWeight, v: pct },
    { w: 0.3, v: nonOverdue },
    { w: 0.15, v: delayScore },
  ]);
  const scoreConfidence: "high" | "low" =
    r.open_tasks >= 3 || r.cur_decidable >= LOW_SAMPLE ? "high" : "low";

  return {
    score,
    scoreConfidence,
    onTime: {
      pct,
      onTime: r.cur_ontime,
      decidable: r.cur_decidable,
      prevPct,
      delta,
      improved,
      noBaseline,
    },
    openTasks: r.open_tasks,
    overdueTasks: r.open_overdue,
    avgLatenessDays: avgLate,
    lateProjects: r.late_projects,
    blockedTasks: blocked,
  };
}

export const getDeliveryCommitment = cache(_getDeliveryCommitment);
