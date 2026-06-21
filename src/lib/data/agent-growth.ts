import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Agent self-growth scorecard — the PRIVATE counterpart to /accountability.
//
// /accountability is a CEO/department-head view that ranks the whole team and
// is used to spot risk. This module computes the SAME verified operational
// metrics for ONE signed-in specialist, framed as a private self-trend
// (this 30 days vs the prior 30 days) — never a leaderboard. The goal is
// reflection + improvement, not surveillance.
//
// Semantic parity: the SQL below is the single-employee, two-window rewrite of
// refresh_accountability_scorecard() (migration 0193). It reuses the exact
// dwell source (task_stage_dwell cache → business_minutes_between fallback),
// the exact role→stage attribution, and the exact SLA-decidable counting. The
// per-employee fan-out is tiny, so it runs live under the 12s
// agent_run_readonly_sql cap (no cron cache needed for one person).
//
// Metric polarity (used by the UI trend arrows + the AI coach):
//   onTimeRate     — higher is better
//   avgTurnaround  — lower is better  (business hours in stage)
//   reworkReturns  — lower is better  (client_changes re-entries)
//   score          — higher is better (current-window composite only)
// =========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`agent-growth: invalid ${label}`);
  return value.toLowerCase();
}

// Single read-only analytics statement (migration 0126). trim() is load-bearing
// — the RPC validates with btrim() + a `^(select|with)` regex, so a leading
// newline gets the whole statement rejected.
async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`agent-growth analytics query failed: ${error.message}`);
  return (data ?? []) as T[];
}

// Below this many SLA-decidable intervals the rate is shown neutrally — the
// same LOW_SAMPLE gate /accountability uses, so we never coach off noise.
const LOW_SAMPLE = 5;

export interface MetricTrend {
  /** Current-window value (last 30 days), or null when unmeasured. */
  value: number | null;
  /** Prior-window value (30–60 days ago), or null when unmeasured. */
  prev: number | null;
  /** Signed change (value − prev) in the metric's own unit, or null. */
  delta: number | null;
  /** Whether the change is an improvement given the metric's polarity. */
  improved: boolean | null;
  /** True when the prior window had too little data to compare against. */
  noBaseline: boolean;
  /** Current-window sample size behind this metric (events the value rests on). */
  sampleSize: number;
}

export interface AgentGrowth {
  specialization: string;
  /** 0–100 craft composite for the current window (see scoring notes below). */
  score: number | null;
  /** Trust in the headline score: low when even the well-sampled signals are thin. */
  scoreConfidence: "high" | "low";
  /** Deadline-based on-time delivery % (drives the score) + its sample size. */
  deliveryOnTimePct: number | null;
  deliveryDecidable: number;
  onTimeRate: MetricTrend; // % — SLA-decidable intervals (secondary display metric)
  avgTurnaroundHours: MetricTrend; // business hours — sampleSize = closed intervals
  reworkReturns: MetricTrend; // client_changes re-entries (count) — sampleSize = closed intervals
  openTasks: number;
  overdueOwned: number;
  /** Recently returned / overdue tasks — grounding for the AI coach. */
  recentReturns: { id: string; title: string; service: string | null; stage: string }[];
}

type MeasuredRow = {
  win: "cur" | "prev";
  avg_dwell: number | null;
  sample_size: number;
  sla_n: number;
  sla_ok: number;
  rework: number;
};

type OpenRow = { open_tasks: number; overdue_owned: number };
type DeadlineRow = { cur_dec: number; cur_ot: number };

const HIGHER_BETTER = "higher" as const;
const LOWER_BETTER = "lower" as const;

function trend(
  cur: number | null,
  prev: number | null,
  curSample: number,
  prevSample: number,
  polarity: typeof HIGHER_BETTER | typeof LOWER_BETTER,
): MetricTrend {
  const noBaseline = prev === null || prevSample < LOW_SAMPLE;
  const delta = cur !== null && prev !== null && !noBaseline ? round1(cur - prev) : null;
  let improved: boolean | null = null;
  if (delta !== null && delta !== 0) {
    improved = polarity === HIGHER_BETTER ? delta > 0 : delta < 0;
  } else if (delta === 0) {
    improved = null; // flat
  }
  return { value: cur, prev, delta, improved, noBaseline, sampleSize: curSample };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Weighted blend that skips null components and renormalizes — the same honesty
// rule accountability/executive-scores use. Returns null when nothing measures.
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

async function _getAgentGrowth(orgId: string, employeeId: string): Promise<AgentGrowth> {
  const org = uuid(orgId, "orgId");
  const emp = uuid(employeeId, "employeeId");

  // ---- Measured intervals, bucketed into current (0–30d) + prior (30–60d) ---
  // Mirrors refresh_accountability_scorecard()'s `intervals` + `measured` CTEs,
  // scoped to this one employee and split across two windows by entry date.
  const measuredSql = `
with live as (
  select id from public.tasks
   where archived_at is null and organization_id = '${org}'
),
attrib as (
  select ta.task_id, 'agent'::text as role
    from public.task_assignees ta join live lt on lt.id = ta.task_id
   where ta.organization_id = '${org}' and ta.role_type = 'agent' and ta.employee_id = '${emp}'
  union
  select ta.task_id, 'account_manager'
    from public.task_assignees ta join live lt on lt.id = ta.task_id
   where ta.organization_id = '${org}' and ta.role_type = 'account_manager' and ta.employee_id = '${emp}'
  union
  select ta.task_id, 'team_manager'
    from public.task_assignees ta join live lt on lt.id = ta.task_id
   where ta.organization_id = '${org}' and ta.team_manager_employee_id = '${emp}'
),
intervals as (
  select a.role, h.to_stage::text as stage_key, h.exited_at,
         case when h.entered_at >= now() - interval '30 days' then 'cur' else 'prev' end as win,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min
    from attrib a
    join public.task_stage_history h on h.task_id = a.task_id
    left join public.task_stage_dwell d on d.history_id = h.id
   where (
       (a.role = 'agent' and h.to_stage in ('in_progress', 'client_changes'))
    or (a.role = 'team_manager' and h.to_stage in ('manager_review'))
    or (a.role = 'account_manager' and h.to_stage in ('ready_to_send', 'sent_to_client'))
   )
     and h.entered_at >= now() - interval '60 days'
)
select i.win,
       avg(i.dwell_min) filter (where i.exited_at is not null) as avg_dwell,
       count(*) filter (where i.exited_at is not null) as sample_size,
       count(*) filter (where s.max_minutes is not null
                          and (i.exited_at is not null or i.dwell_min > s.max_minutes)) as sla_n,
       count(*) filter (where s.max_minutes is not null
                          and i.exited_at is not null
                          and i.dwell_min <= s.max_minutes) as sla_ok,
       count(*) filter (where i.role = 'agent' and i.stage_key = 'client_changes') as rework
  from intervals i
  left join public.sla_rules s on s.organization_id = '${org}' and s.stage_key = i.stage_key
 group by 1`;

  // ---- Current open-board counts (current-state, no prior window) -----------
  const openSql = `
with live as (
  select id, stage, is_overdue from public.tasks
   where archived_at is null and organization_id = '${org}'
),
attrib as (
  select ta.task_id
    from public.task_assignees ta join live lt on lt.id = ta.task_id
   where ta.organization_id = '${org}' and ta.role_type = 'agent' and ta.employee_id = '${emp}'
  union
  select ta.task_id
    from public.task_assignees ta join live lt on lt.id = ta.task_id
   where ta.organization_id = '${org}' and ta.role_type = 'account_manager' and ta.employee_id = '${emp}'
  union
  select ta.task_id
    from public.task_assignees ta join live lt on lt.id = ta.task_id
   where ta.organization_id = '${org}' and ta.team_manager_employee_id = '${emp}'
)
select count(distinct a.task_id) filter (where lt.stage <> 'done') as open_tasks,
       count(distinct a.task_id) filter (where lt.stage <> 'done' and lt.is_overdue) as overdue_owned
  from attrib a join live lt on lt.id = a.task_id`;

  // ---- Deadline-based on-time (the headline-driving signal) -----------------
  // The score anchors on whether work is DELIVERED by its deadline — the real,
  // well-sampled commitment signal — NOT the stage-SLA rate (which is starved:
  // in_progress has no SLA rule). Deadline = coalesce(due_date, planned_date)
  // since due_date is ~100% null on Odoo-synced tasks; completion =
  // coalesce(actual_done_date, completed_at). Mirrors delivery-commitment.ts.
  const deadlineSql = `
with mine as (
  select coalesce(t.due_date, t.planned_date) as dl,
         coalesce(t.actual_done_date, t.completed_at::date) as done_d,
         (t.stage = 'done' or t.actual_done_date is not null) as completed
    from public.tasks t
    join public.task_assignees ta on ta.task_id = t.id and ta.role_type = 'agent' and ta.employee_id = '${emp}'
   where t.organization_id = '${org}' and t.archived_at is null
)
select
  count(*) filter (where completed and done_d >= (now() - interval '30 days')::date and dl is not null) as cur_dec,
  count(*) filter (where completed and done_d >= (now() - interval '30 days')::date and dl is not null and done_d <= dl) as cur_ot
from mine`;

  const [measured, openRows, deadlineRows, profileRes, returns] = await Promise.all([
    runSql<MeasuredRow>(measuredSql),
    runSql<OpenRow>(openSql),
    runSql<DeadlineRow>(deadlineSql),
    supabaseAdmin
      .from("employee_profiles")
      .select("department:departments!employee_profiles_department_id_fkey(name)")
      .eq("organization_id", org)
      .eq("id", emp)
      .maybeSingle(),
    // Recently returned / overdue owned tasks — concrete anchors for the coach.
    supabaseAdmin
      .from("task_assignees")
      .select(
        "task:tasks!inner(id, title, stage, is_overdue, archived_at, service:services(name))",
      )
      .eq("organization_id", org)
      .eq("employee_id", emp)
      .neq("task.stage", "done")
      .is("task.archived_at", null)
      .limit(40),
  ]);

  const cur = measured.find((m) => m.win === "cur");
  const prev = measured.find((m) => m.win === "prev");

  const rate = (m?: MeasuredRow) =>
    m && m.sla_n > 0 ? Math.round((m.sla_ok / m.sla_n) * 100) : null;
  const dwellHours = (m?: MeasuredRow) =>
    m && m.avg_dwell != null && m.sample_size > 0 ? round1(m.avg_dwell / 60) : null;
  const reworkOf = (m?: MeasuredRow) => (m ? m.rework : null);

  const open = openRows[0] ?? { open_tasks: 0, overdue_owned: 0 };
  const closedN = cur?.sample_size ?? 0;
  const reworkN = cur?.rework ?? 0;
  const onTimeCur = rate(cur); // SLA on-time — kept as a secondary display metric

  // Deadline-based on-time (the real delivery-commitment signal) — drives the score.
  const deadline = deadlineRows[0] ?? { cur_dec: 0, cur_ot: 0 };
  const deliveryDecidable = deadline.cur_dec;
  const deliveryOnTimePct =
    deliveryDecidable > 0 ? Math.round((deadline.cur_ot / deliveryDecidable) * 100) : null;

  // ---- Craft score (well-sampled, confidence-weighted) --------------------
  // Anchored on DEADLINE on-time (well-sampled, the same signal the Delivery
  // Commitment index shows) — NOT the stage-SLA rate, which is starved for
  // specialists (in_progress has no SLA rule) and over-credited the headline.
  // The well-sampled craft signals carry the rest:
  //   - nonOverdue: share of the live board that isn't overdue (open_tasks N)
  //   - reworkScore: 1 − (client_changes returns / closed work intervals)
  //   - on-time: weighted up to 0.5, scaled by min(deliveryDecidable,5)/5
  const nonOverdue =
    open.open_tasks > 0 ? round1(100 * (1 - open.overdue_owned / open.open_tasks)) : null;
  const reworkScore = closedN > 0 ? round1(100 * (1 - Math.min(reworkN / closedN, 1))) : null;
  const onTimeWeight = (0.5 * Math.min(deliveryDecidable, LOW_SAMPLE)) / LOW_SAMPLE;
  const score = blend([
    { w: onTimeWeight, v: deliveryOnTimePct },
    { w: 0.3, v: nonOverdue },
    { w: 0.2, v: reworkScore },
  ]);
  // The headline is trustworthy when the dominant (well-sampled) signals exist:
  // a real open board OR enough deadline-decidable deliveries.
  const scoreConfidence: "high" | "low" =
    open.open_tasks >= 3 || deliveryDecidable >= LOW_SAMPLE ? "high" : "low";

  const department =
    (Array.isArray(profileRes.data?.department)
      ? profileRes.data?.department[0]
      : profileRes.data?.department) ?? null;
  const specialization = (department as { name?: string } | null)?.name ?? "";

  // Pick concrete returned/overdue tasks to ground the coach (returns first).
  type RawAssignee = {
    task: {
      id: string;
      title: string;
      stage: string;
      is_overdue: boolean | null;
      archived_at: string | null;
      service: { name: string } | { name: string }[] | null;
    } | null;
  };
  const recentReturns: AgentGrowth["recentReturns"] = [];
  const seen = new Set<string>();
  for (const row of (returns.data ?? []) as unknown as RawAssignee[]) {
    const t = row.task;
    if (!t || t.archived_at || t.stage === "done" || seen.has(t.id)) continue;
    const isReturn = t.stage === "client_changes";
    const isOverdue = !!t.is_overdue;
    if (!isReturn && !isOverdue) continue;
    seen.add(t.id);
    const svc = Array.isArray(t.service) ? t.service[0] : t.service;
    recentReturns.push({
      id: t.id,
      title: t.title,
      service: svc?.name ?? null,
      stage: t.stage,
    });
    if (recentReturns.length >= 5) break;
  }

  return {
    specialization,
    score,
    scoreConfidence,
    deliveryOnTimePct,
    deliveryDecidable,
    onTimeRate: trend(onTimeCur, rate(prev), cur?.sla_n ?? 0, prev?.sla_n ?? 0, HIGHER_BETTER),
    avgTurnaroundHours: trend(
      dwellHours(cur),
      dwellHours(prev),
      closedN,
      prev?.sample_size ?? 0,
      LOWER_BETTER,
    ),
    reworkReturns: trend(reworkOf(cur), reworkOf(prev), closedN, prev?.sample_size ?? 0, LOWER_BETTER),
    openTasks: open.open_tasks,
    overdueOwned: open.overdue_owned,
    recentReturns,
  };
}

export const getAgentGrowth = cache(_getAgentGrowth);
