import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TASK_OWNER_ROLE_LABELS, type TaskOwnerRoleKey } from "@/lib/labels";
import { nonLeadershipFilter } from "@/lib/data/leadership";
import {
  getEmployeeOwnedDeskTasks,
  getEmployeePendingLateTasks,
} from "@/lib/data/team-pulse";
import type { SatisfactionResult } from "@/lib/satisfaction-schema";
import { resolveRange } from "@/lib/dashboard-range";
import { riyadhDateRangeUtcBounds } from "@/lib/tz";

// =========================================================================
// Accountability Engine (/accountability) — CEO/department-head scorecard
// built on the Odoo stage-history mirror (`task_stage_history`).
//
// Data-semantics ground rules (verified against the prod dataset):
//   * `duration_seconds` is NEVER read — dwell is always
//     business_minutes_between(entered_at, coalesce(exited_at, now()))
//     (holiday-aware since migration 0161).
//   * `moved_by` is 100% NULL → attribution comes from `task_assignees`
//     (role_type + team_manager_employee_id), with honest N/A degradation
//     for the ~50% of tasks that carry no agent assignee.
//   * Archived tasks are excluded everywhere (and counted in coverage).
//   * One stage-history row per (task, to_stage) entry — sample sizes are
//     interval counts, not re-entry counts.
//   * Measurement window: stage intervals ENTERED in the last WINDOW_DAYS
//     (30) days. Open-board counts (openTasks/overdueOwned) are
//     current-state, not windowed.
//   * SLA counting: a closed interval with a rule is always measured; an
//     OPEN interval counts as a breach once its dwell already exceeds the
//     rule (the verdict is decidable — dwell only grows). Open intervals
//     still within their SLA stay out of the denominator (undecided).
//     avg dwell stays closed-intervals-only.
//   * Attribution fan-out: scorecard counters are PER (employee, role)
//     RELATIONSHIP. A task with several agents / conflicting team-manager
//     rows charges the same interval to each of them ("each accountable").
//     NEVER sum counters across scorecard rows — org-level rollups must
//     aggregate over distinct tasks (see coverage.distinctOverdueTasks).
//
// Heavy aggregation runs through `agent_run_readonly_sql` (migration 0126,
// service_role-only, single read-only SELECT/WITH) so the SQL
// business-calendar function is the single source of truth for dwell —
// no TS re-implementation that could drift.
//
// Tier-A (scores) comes only from operational tables. Tier-B (AI-linked
// signals from WhatsApp satisfaction analyses) is returned separately and
// NEVER feeds a Tier-A number.
// =========================================================================

export type AccountabilityRole = "agent" | "account_manager" | "team_manager";

export interface AccountabilityPeriodTrend {
  currentRate: number | null;
  previousRate: number | null;
  difference: number | null; // percentage points: current - previous
  direction: "increase" | "decrease" | "no_change" | "unavailable";
  currentSampleSize: number;
  previousSampleSize: number;
  currentWithinSla: number;
  previousWithinSla: number;
  // إجمالي المراحل / مراحل متأخرة for the CURRENT period — folded into this same
  // query (they reuse its owned-intervals CTE) so the roster runs one heavy
  // stage-history fan-out instead of two (the second one timed out under load).
  currentTotalStages: number;
  currentLateStages: number;
}

export interface AccountabilityScorecardRow {
  employeeId: string;
  fullName: string;
  jobTitle: string | null;
  // Structural role from the employee's position (positions.role) — what the
  // الدور column shows. Distinct from `role` below (the accountability/stage
  // attribution that the SCORE is scoped to). Source: /organization/employees.
  positionRole: string | null;
  positionLabel: string | null; // positionRole → Arabic, else jobTitle
  role: AccountabilityRole;
  // General live workload owned by this employee's current stage. "Overdue"
  // means the task delivery deadline passed; it is deliberately NOT stage SLA.
  openTasks: number;
  overdueOwned: number;
  avgDwellBusinessMinutes: number | null; // closed intervals in window
  onTimeRate: number | null; // 0-100 — share of SLA-decidable intervals within their stage SLA
  reworkReturns30d: number; // client_changes re-entries in the window (agent role)
  score: number | null; // 0-100
  sampleSize: number; // closed stage intervals in the window
  slaSampleSize: number; // SLA-decidable intervals (closed + open-already-breached)
  confidence: "high" | "low"; // low when slaSampleSize < 5 — gates trust in onTimeRate
  // Selected period vs the immediately preceding period of equal duration.
  // Historical work stays attributable after the task is archived.
  periodTrend: AccountabilityPeriodTrend;
}

export interface ReviewerRigorRow {
  employeeId: string;
  fullName: string;
  reviewsCompleted: number;
  medianReviewBusinessMinutes: number | null; // percentile_cont(0.5) — dwell is right-skewed
  fastReviewCount: number; // distinct reviewed tasks completed in < FAST_REVIEW_MINUTES
  fastReviewShare: number | null; // retained for confidence/risk classification; UI shows the count
  reviewedTaskCount: number;
  clientChangesAfterReviewCount: number; // reviewed tasks that later entered client_changes
  clientChangesAfterReviewRate: number | null;
  // Backward-compatible aliases used by the CEO brief/case engine. Their
  // semantics now follow the template-attributed client_changes rule above.
  passCount: number;
  reworkCount: number;
  reworkAfterPassRate: number | null;
  pendingReviews: number;
  oldestPendingBusinessMinutes: number | null;
  // How reviews were credited: real approval-gate actions (inheritance-proof)
  // vs. team-manager assignment on the task (Odoo records no stage actor —
  // read those as team-level attribution, not personal verdicts).
  attribution: "template_stage_owner";
  sampleSize: number;
  confidence: "high" | "low";
}

// Overdue live tasks of the same client — surfaced next to a complaint as
// "related open work" context. Heuristic by design: NEVER presented as the
// complaint's cause and never feeds a Tier-A number.
export interface AiSignalRelatedTask {
  taskId: string;
  taskCode: string | null;
  title: string;
  assigneeNames: string | null; // agent + account-manager names, comma-joined
}

export interface AiLinkedSignal {
  id: string;
  clientId: string | null;
  clientName: string | null;
  kind: "complaint" | "praise" | "delay_mention" | "risk" | string;
  quote: string;
  source: string;
  occurredAt: string | null;
  relatedOpenTasks: AiSignalRelatedTask[];
}

export interface AccountabilityCoverage {
  totalTasks: number;
  tasksWithHistory: number;
  tasksWithAgent: number;
  tasksWithAccountManager: number;
  archivedExcluded: number;
  // Distinct live tasks past their delivery deadline — the organization-level
  // overdue number. Per-row overdueOwned can fan out across co-owners and must
  // not be summed.
  distinctOverdueTasks: number;
  // The analysis window (now - WINDOW_DAYS → now), NOT the history extent.
  windowStart: string | null;
  windowEnd: string | null;
}

export interface AccountabilityOverview {
  generatedAt: string;
  rows: AccountabilityScorecardRow[];
  // Two review stages, shown as separate sections: Manager Review (credited to
  // the Manager/Head) and Specialist Review (credited to the executing specialist).
  reviewers: { managerReview: ReviewerRigorRow[]; specialistReview: ReviewerRigorRow[] };
  aiSignals: AiLinkedSignal[];
  coverage: AccountabilityCoverage;
}

export interface AccountabilityEvidenceItem {
  taskId: string;
  taskCode: string | null;
  title: string;
  clientName: string | null;
  projectName: string | null;
  stage: string; // task_stage value — labeled via TasksBoard.stages in the UI
  enteredAt: string;
  exitedAt: string | null; // null = still in this stage
  dwellBusinessMinutes: number | null;
  isOverdue: boolean;
  delayDays: number | null;
}

export interface AccountabilityEvidence {
  employeeId: string;
  fullName: string;
  role: AccountabilityRole;
  items: AccountabilityEvidenceItem[];
}

// Sample threshold below which a score is shown neutrally ("عينة محدودة").
const LOW_SAMPLE = 5;
// A review decided in under this many BUSINESS minutes counts as "fast"
// (possible rubber-stamp). UI flags reviewers with ≥30% fast share.
const FAST_REVIEW_MINUTES = 10;
// Measurement window for stage-dwell / SLA / rework counters (days).
const WINDOW_DAYS = 30;
// Rework-after-pass: task re-enters one of these within this many days.

// Which stage intervals each role is accountable for is now TEMPLATE-DRIVEN:
// the SQL function public.accountable_role_for_stage(stage_owner_positions, stage)
// (migration 0222) reads each task's per-stage owner map (organised in
// /task-templates) and falls back to the canonical Rwasem workflow (agents
// execute new/in_progress/specialist_review/client_changes, team managers
// review manager_review, account managers handle ready_to_send/sent_to_client).
// See roleStagePredicate() below.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_PERIOD_TREND: AccountabilityPeriodTrend = {
  currentRate: null,
  previousRate: null,
  difference: null,
  direction: "unavailable",
  currentSampleSize: 0,
  previousSampleSize: 0,
  currentWithinSla: 0,
  previousWithinSla: 0,
  currentTotalStages: 0,
  currentLateStages: 0,
};

function assertUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`accountability: invalid ${label}`);
  return value.toLowerCase();
}

// Single read-only analytics statement (0126). Throws on failure so the page
// error boundary surfaces real problems instead of silently rendering zeros.
async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  // trim() is load-bearing: agent_run_readonly_sql validates with btrim()
  // (spaces only) + a `^(select|with)` regex, so a leading newline from a
  // template literal gets the whole statement rejected.
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`accountability analytics query failed: ${error.message}`);
  return (data ?? []) as T[];
}

// The attribution CTE shared by the scorecard and evidence queries (migration
// 0223): one (task_id, employee_id, position_role, role) row per assignee.
// role_type is NOT used — every assignee is matched to stages by their POSITION
// (carried as position_role; `role` is the collapsed accountability role for
// display). This mirrors the cached scorecard so the drill-down matches it.
function attribCte(org: string, employeeFilter?: { id: string }): string {
  const emp = employeeFilter ? `and ta.employee_id = '${employeeFilter.id}'` : "";
  return `
attrib as (
  select distinct ta.task_id, ta.employee_id,
         pos.role as position_role,
         public.accountability_role_of_position(pos.role) as role
    from task_assignees ta
    join employee_profiles e on e.id = ta.employee_id
    join positions pos on pos.id = e.position_id
   where ta.organization_id = '${org}'
     and public.accountability_role_of_position(pos.role) is not null ${emp}
)`;
}

// Template-driven POSITION ownership (migration 0223). An assignee is accountable
// for a stage interval only when their position matches the template's stage
// owner — the same gate the cached scorecard uses, so the drill-down matches the
// score. Requires the query to expose a tasks row `t` (for stage_owner_positions)
// and a stage-history row `h` (for to_stage).
function roleStagePredicate(alias: string): string {
  return `${alias}.position_role = public.accountable_position_for_stage(t.stage_owner_positions, h.to_stage::text)`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Weighted blend that skips null components and renormalizes (same honesty
// rule as executive-scores). Returns null when nothing is measurable.
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

// ---- Scorecard ------------------------------------------------------------

interface ScorecardSqlRow {
  employee_id: string;
  full_name: string;
  job_title: string | null;
  position_role: string | null;
  role: AccountabilityRole;
  open_tasks: number;
  overdue_owned: number;
  avg_dwell: number | null;
  sample_size: number;
  sla_n: number;
  sla_ok: number;
  rework_30d: number;
}

async function loadScorecard(org: string): Promise<AccountabilityScorecardRow[]> {
  // Reads the precomputed per-(employee, role) rollup from the
  // `accountability_scorecard` cache (migration 0193), refreshed by pg_cron
  // every 10 min via refresh_accountability_scorecard(). The live aggregate
  // (30 days of stage-history × the whole org's assignee fan-out) exceeded
  // the 12s agent_run_readonly_sql statement timeout on cold cache (57014),
  // tripping the page error boundary. The heavy work now runs off the request
  // path under the cron role's 120s budget; the page reads a trivial indexed
  // join. The cached counters are byte-for-byte identical to the former live
  // output — names/positions are joined fresh here so they never go stale.
  const sql = `
select sc.employee_id, e.full_name, e.job_title, pp.role as position_role, sc.role,
       sc.open_tasks, sc.overdue_owned, sc.avg_dwell, sc.sample_size,
       sc.sla_n, sc.sla_ok, sc.rework_30d
  from accountability_scorecard sc
  join employee_profiles e on e.id = sc.employee_id and e.organization_id = '${org}'
  left join positions pp on pp.id = e.position_id
 where sc.organization_id = '${org}'
   and ${nonLeadershipFilter("pp")}`;

  const raw = await runSql<ScorecardSqlRow>(sql);

  // Collapse to one row per employee: counters sum across the employee's
  // accountable roles (every interval is already restricted to stages that
  // role owns); the displayed role is the dominant attribution.
  const byEmp = new Map<
    string,
    {
      fullName: string;
      jobTitle: string | null;
      positionRole: string | null;
      openTasks: number;
      overdueOwned: number;
      dwellSum: number;
      sampleSize: number;
      slaN: number;
      slaOk: number;
      rework30d: number;
      roleWeight: Map<AccountabilityRole, number>;
    }
  >();

  for (const r of raw) {
    let agg = byEmp.get(r.employee_id);
    if (!agg) {
      agg = {
        fullName: r.full_name ?? "—",
        jobTitle: r.job_title,
        positionRole: r.position_role,
        openTasks: 0,
        overdueOwned: 0,
        dwellSum: 0,
        sampleSize: 0,
        slaN: 0,
        slaOk: 0,
        rework30d: 0,
        roleWeight: new Map(),
      };
      byEmp.set(r.employee_id, agg);
    }
    agg.openTasks += r.open_tasks;
    agg.overdueOwned += r.overdue_owned;
    agg.dwellSum += (r.avg_dwell ?? 0) * r.sample_size;
    agg.sampleSize += r.sample_size;
    agg.slaN += r.sla_n;
    agg.slaOk += r.sla_ok;
    agg.rework30d += r.rework_30d;
    agg.roleWeight.set(
      r.role,
      (agg.roleWeight.get(r.role) ?? 0) + r.sample_size * 2 + r.open_tasks,
    );
  }

  const rows: AccountabilityScorecardRow[] = [];
  for (const [employeeId, a] of byEmp) {
    let role: AccountabilityRole = "agent";
    let best = -1;
    for (const [rl, w] of a.roleWeight) {
      if (w > best) {
        best = w;
        role = rl;
      }
    }
    const onTimeRate = a.slaN > 0 ? Math.round((a.slaOk / a.slaN) * 100) : null;
    const overdueFactor =
      a.openTasks > 0 ? 100 * (1 - a.overdueOwned / a.openTasks) : null;
    // Score: SLA adherence of measured intervals (0.6) + share of the
    // employee's open board that is NOT overdue (0.4). Null components drop
    // out; fully unmeasurable employees stay null ("غير مُقاس").
    const score = blend([
      { w: 0.6, v: onTimeRate },
      { w: 0.4, v: overdueFactor },
    ]);
    rows.push({
      employeeId,
      fullName: a.fullName,
      jobTitle: a.jobTitle,
      positionRole: a.positionRole,
      positionLabel: a.positionRole
        ? (TASK_OWNER_ROLE_LABELS[a.positionRole as TaskOwnerRoleKey] ??
          a.jobTitle)
        : a.jobTitle,
      role,
      openTasks: a.openTasks,
      overdueOwned: a.overdueOwned,
      avgDwellBusinessMinutes:
        a.sampleSize > 0 ? round1(a.dwellSum / a.sampleSize) : null,
      onTimeRate,
      reworkReturns30d: a.rework30d,
      score,
      sampleSize: a.sampleSize,
      slaSampleSize: a.slaN,
      // Confidence gates trust in onTimeRate (the 0.6-weight score driver),
      // so it must key off the SLA-decidable events — NOT sampleSize, which
      // counts rule-less stages (in_progress) and can read "high" while the
      // rate rests on a single event.
      confidence: a.slaN >= LOW_SAMPLE ? "high" : "low",
      periodTrend: EMPTY_PERIOD_TREND,
    });
  }
  return rows;
}

interface PeriodTrendSqlRow {
  employee_id: string;
  current_n: number;
  current_ok: number;
  previous_n: number;
  previous_ok: number;
  total_stages: number;
  late_stages: number;
}

function addDaysIso(iso: string, delta: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Historical SLA adherence by employee. The interval belongs to the period in
// which it entered the employee-owned stage. There is intentionally no
// live-only predicate: a task archived after completion remains historical
// evidence. Archived tasks that never reached done stay excluded, matching the
// dashboard historical-evaluation contract.
async function loadPeriodTrends(
  org: string,
  range: ReturnType<typeof resolveRange>,
): Promise<Record<string, AccountabilityPeriodTrend>> {
  const previousTo = addDaysIso(range.from, -1);
  const previousFrom = addDaysIso(previousTo, -(range.days - 1));
  const currentBounds = riyadhDateRangeUtcBounds(range.from, range.to);
  const previousBounds = riyadhDateRangeUtcBounds(previousFrom, previousTo);

  const sql = `
with periods as (
  select 'current'::text as period_key,
         '${currentBounds.start}'::timestamptz as p_start,
         least(now(), '${currentBounds.endExclusive}'::timestamptz) as p_end
  union all
  select 'previous',
         '${previousBounds.start}'::timestamptz,
         '${previousBounds.endExclusive}'::timestamptz
), owned_intervals as (
  -- Every stage interval the person OWNED that OVERLAPS a period.
  --
  -- The old filter keyed on entered_at alone ("entered inside the window"),
  -- which silently dropped the longest-held work — precisely the work that
  -- matters. A stage entered 13 Jul and left 21 Jul vanished from a 14–20 Jul
  -- period even though he held it the entire week, and anything still OPEN that
  -- started before the window (a task sitting in قيد التنفيذ for 5 days) never
  -- appeared at all. Overlap is the correct test: started before the period
  -- ended AND had not already left before it began.
  -- planned_date is deliberately NOT selected: lateness here is the stage SLA,
  -- not the task deadline, and pulling it widened every row of a scan that is
  -- already the heaviest query on this page.
  select distinct h.id, ta.employee_id, h.entered_at, h.exited_at, s.max_minutes
    from task_stage_history h
    join tasks t
      on t.id = h.task_id
     and t.organization_id = '${org}'
    join task_assignees ta
      on ta.task_id = t.id
     and ta.organization_id = '${org}'
    join employee_profiles e on e.id = ta.employee_id
    join positions pos on pos.id = e.position_id
    left join sla_rules s
      on s.organization_id = '${org}'
     and s.stage_key = h.to_stage::text
   where h.entered_at < '${currentBounds.endExclusive}'::timestamptz
     and (h.exited_at is null or h.exited_at >= '${previousBounds.start}'::timestamptz)
     and (t.archived_at is null or t.stage = 'done')
     and pos.role = public.accountable_position_for_stage(t.stage_owner_positions, h.to_stage::text)
), expanded as (
  -- One row per (interval, period it overlaps). An interval spanning both
  -- periods is judged once against each, so current-vs-previous asks the same
  -- question of both instead of assigning each interval to a single bucket.
  select oi.*, p.period_key, p.p_end as period_end
    from owned_intervals oi
    join periods p
      on oi.entered_at < p.p_end
     and (oi.exited_at is null or oi.exited_at >= p.p_start)
), evaluated as (
  select employee_id, period_key, max_minutes,
         exited_at is not null and exited_at < period_end as exited_in_time,
         -- Dwell runs from the REAL stage entry, even if that predates the
         -- window: the SLA measures total time held, not time-inside-the-window.
         --
         -- Guarded on max_minutes: business_minutes_between is plpgsql and slow,
         -- and since the overlap rewrite this CTE carries every open interval in
         -- the org (~13k × the assignee fan-out × 2 periods). Stages with no SLA
         -- rule can never be late, so computing their dwell is pure waste — and
         -- it was enough waste to blow the 12s statement timeout.
         -- (Careful: agent_run_readonly_sql rejects a few English words anywhere
         -- in the text, even inside comments — see its keyword regex.)
         case
           when max_minutes is null then null
           else public.business_minutes_between(
             entered_at,
             least(coalesce(exited_at, period_end), period_end)
           )
         end as dwell_at_period_end
    from expanded
), measured as (
  select employee_id, period_key,
         count(*) filter (
           where max_minutes is not null
             and (exited_in_time or dwell_at_period_end > max_minutes)
         )::int as sample_n,
         count(*) filter (
           where max_minutes is not null
             and exited_in_time
             and dwell_at_period_end <= max_minutes
         )::int as within_sla
    from evaluated
   group by employee_id, period_key
), stage_counts as (
  -- إجمالي المراحل / مراحل متأخرة for the CURRENT period.
  --
  -- إجمالي المراحل = EVERY stage the person owned during the period, including
  -- stages with no SLA rule (جديد / قيد التنفيذ). The client reads this column
  -- as "what was on his plate", so a New task the template makes him responsible
  -- for must appear here even though no rule can judge how long he held it.
  --
  -- مراحل متأخرة = of those, the ones where he blew the STAGE's SLA (business
  -- minutes held > the stage's limit) — NOT the task's delivery deadline, which
  -- is the separate متأخرة column. Only SLA-bearing stages can breach, so an
  -- un-judgeable stage counts in the denominator and never in the numerator.
  --
  -- Consequence, and it is intentional: الالتزام keeps its own SLA-measurable
  -- denominator (sample_n), so it is NOT (total - late)/total for anyone holding
  -- un-judgeable stages. Same reason a New stage can't be "on time" either.
  select employee_id,
         count(*) filter (where period_key = 'current')::int as total_stages,
         count(*) filter (
           where period_key = 'current'
             and max_minutes is not null
             and dwell_at_period_end > max_minutes
         )::int as late_stages
    from evaluated
   group by employee_id
)
select m.employee_id,
       coalesce(max(m.sample_n) filter (where m.period_key = 'current'), 0)::int as current_n,
       coalesce(max(m.within_sla) filter (where m.period_key = 'current'), 0)::int as current_ok,
       coalesce(max(m.sample_n) filter (where m.period_key = 'previous'), 0)::int as previous_n,
       coalesce(max(m.within_sla) filter (where m.period_key = 'previous'), 0)::int as previous_ok,
       coalesce(max(sc.total_stages), 0)::int as total_stages,
       coalesce(max(sc.late_stages), 0)::int as late_stages
  from measured m
  left join stage_counts sc on sc.employee_id = m.employee_id
 group by m.employee_id`;

  const rows = await runSql<PeriodTrendSqlRow>(sql);
  const result: Record<string, AccountabilityPeriodTrend> = {};
  for (const row of rows) {
    const currentRate = row.current_n > 0 ? Math.round((row.current_ok / row.current_n) * 100) : null;
    const previousRate = row.previous_n > 0 ? Math.round((row.previous_ok / row.previous_n) * 100) : null;
    const difference = currentRate !== null && previousRate !== null ? currentRate - previousRate : null;
    result[row.employee_id] = {
      currentRate,
      previousRate,
      difference,
      direction:
        difference === null
          ? "unavailable"
          : difference > 0
            ? "increase"
            : difference < 0
              ? "decrease"
              : "no_change",
      currentSampleSize: row.current_n,
      previousSampleSize: row.previous_n,
      currentWithinSla: row.current_ok,
      previousWithinSla: row.previous_ok,
      currentTotalStages: row.total_stages,
      currentLateStages: row.late_stages,
    };
  }
  return result;
}

// ---- Reviewer rigor ---------------------------------------------------------

interface ReviewerSqlRow {
  employee_id: string;
  full_name: string;
  reviews: number;
  median_min: number | null;
  fast_n: number;
  client_changes_n: number;
  pending: number;
  oldest_min: number | null;
}

function mapReviewerRows(raw: ReviewerSqlRow[]): ReviewerRigorRow[] {
  return raw.map((r) => ({
    employeeId: r.employee_id,
    fullName: r.full_name ?? "—",
    reviewsCompleted: r.reviews,
    medianReviewBusinessMinutes: r.median_min === null ? null : round1(r.median_min),
    fastReviewCount: r.fast_n,
    fastReviewShare:
      r.reviews > 0 ? Math.round((r.fast_n / r.reviews) * 100) : null,
    reviewedTaskCount: r.reviews,
    clientChangesAfterReviewCount: r.client_changes_n,
    clientChangesAfterReviewRate:
      r.reviews > 0 ? Math.round((r.client_changes_n / r.reviews) * 100) : null,
    passCount: r.reviews,
    reworkCount: r.client_changes_n,
    reworkAfterPassRate:
      r.reviews > 0 ? Math.round((r.client_changes_n / r.reviews) * 100) : null,
    pendingReviews: r.pending,
    oldestPendingBusinessMinutes: r.oldest_min === null ? null : round1(r.oldest_min),
    attribution: "template_stage_owner",
    sampleSize: r.reviews,
    confidence: r.reviews >= LOW_SAMPLE ? "high" : "low",
  }));
}

// A review belongs to the employee whose POSITION matches the owner configured
// for that review stage on the task. `tasks.stage_owner_positions` is copied
// from the task template, so manager_review may legitimately resolve to a
// department manager OR a supporting-department lead depending on the task.
// One deterministic matching employee is chosen per task to prevent fan-out.
function buildStageReviewerSql(
  org: string,
  opts: { stage: "manager_review" | "specialist_review"; from: string; to: string },
): string {
  const { start, endExclusive } = riyadhDateRangeUtcBounds(opts.from, opts.to);
  return `
with hist as (
  -- Archived tasks are KEPT here. A completed review (exited the review stage
  -- in the window) is a historical fact about the reviewer's work — it doesn't
  -- un-happen when the task is later archived. Excluding archived rows dropped
  -- >half of some reviewers' work (حسن ياسر: 5 of 9 in 90d), which is exactly
  -- the undercount the team reported. archived_at is carried so the PENDING
  -- CTE can still restrict itself to live tasks (an archived task isn't waiting
  -- for review).
  -- Narrowed to THIS review stage. hist is only ever read with
  -- hist.stage = opts.stage below, so materializing every stage's history was
  -- waste — and once the archived filter was dropped (to count archived-but-
  -- delivered reviews) that waste tipped the query over the 12s RPC ceiling.
  select h.id, h.task_id, h.to_stage::text as stage, h.entered_at, h.exited_at,
         t.archived_at
    from task_stage_history h
    join tasks t on t.id = h.task_id
   where h.organization_id = '${org}'
     and h.to_stage = '${opts.stage}'
),
reviewer_by_task as (
  -- Attribute only tasks that actually have a review interval (in hist), not
  -- the whole org — evaluating accountable_position_for_stage per assignee is
  -- the expensive part, so restricting which tasks enter here is the real win.
  select distinct on (g.task_id) g.task_id, g.employee_id
    from (
      select ta.task_id, candidate.employee_id, count(*) as n
        from task_assignees ta
        join tasks t on t.id = ta.task_id
        cross join lateral (
          values
            (ta.employee_id),
            (ta.team_manager_employee_id),
            (ta.head_of_dept_employee_id)
        ) as candidate(employee_id)
        join employee_profiles e on e.id = candidate.employee_id
        join positions p on p.id = e.position_id
       where ta.organization_id = '${org}'
         and ta.task_id in (select task_id from hist)
         and candidate.employee_id is not null
         and p.role = public.accountable_position_for_stage(
               t.stage_owner_positions, '${opts.stage}')
       group by 1, 2
    ) g
   order by g.task_id, g.n desc, g.employee_id
),
review_intervals as (
  select hist.id, hist.task_id, hist.exited_at, reviewer.employee_id,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(hist.entered_at, hist.exited_at)) as rev_min,
         hist.exited_at as reviewed_at
    from hist
    join reviewer_by_task reviewer on reviewer.task_id = hist.task_id
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = '${opts.stage}'
     and hist.exited_at >= '${start}'::timestamptz
     and hist.exited_at < '${endExclusive}'::timestamptz
),
reviewed_tasks as (
  select employee_id, task_id,
         min(rev_min) as rev_min,
         min(reviewed_at) as first_reviewed_at
    from review_intervals
   group by 1, 2
),
agg as (
  select r.employee_id, count(*)::int as reviews,
         percentile_cont(0.5) within group (order by r.rev_min) as median_min,
         count(*) filter (where r.rev_min < ${FAST_REVIEW_MINUTES})::int as fast_n,
         count(*) filter (where exists (
           select 1 from task_stage_history h3
            where h3.task_id = r.task_id
              and h3.to_stage = 'client_changes'
              and h3.entered_at > r.first_reviewed_at
              and h3.entered_at < '${endExclusive}'::timestamptz
         ))::int as client_changes_n
    from reviewed_tasks r
   group by 1
),
pend as (
  select reviewer.employee_id, count(distinct hist.task_id)::int as pending,
         max(coalesce(d.dwell_business_minutes::numeric,
                      public.business_minutes_between(
                        hist.entered_at,
                        least(now(), '${endExclusive}'::timestamptz)
                      ))) as oldest_min
    from hist
    join reviewer_by_task reviewer on reviewer.task_id = hist.task_id
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = '${opts.stage}'
     and hist.archived_at is null
     and hist.entered_at >= '${start}'::timestamptz
     and hist.entered_at < '${endExclusive}'::timestamptz
     and (hist.exited_at is null or hist.exited_at >= '${endExclusive}'::timestamptz)
   group by 1
),
keys as (
  select employee_id from agg union select employee_id from pend
)
select e.id as employee_id, e.full_name,
       coalesce(a.reviews, 0) as reviews, a.median_min, coalesce(a.fast_n, 0) as fast_n,
       coalesce(a.client_changes_n, 0) as client_changes_n,
       coalesce(p.pending, 0) as pending, p.oldest_min
  from keys k
  join employee_profiles e on e.id = k.employee_id and e.organization_id = '${org}'
  left join agg a on a.employee_id = k.employee_id
  left join pend p on p.employee_id = k.employee_id
 order by coalesce(a.reviews, 0) desc`;
}

async function loadManagerReviewers(
  org: string,
  from: string,
  to: string,
): Promise<ReviewerRigorRow[]> {
  const fallbackRows = await runSql<ReviewerSqlRow>(
    buildStageReviewerSql(org, {
      stage: "manager_review",
      from,
      to,
    }),
  );
  return mapReviewerRows(fallbackRows);
}

async function loadSpecialistReviewers(
  org: string,
  from: string,
  to: string,
): Promise<ReviewerRigorRow[]> {
  const rows = await runSql<ReviewerSqlRow>(
    buildStageReviewerSql(org, {
      stage: "specialist_review",
      from,
      to,
    }),
  );
  return mapReviewerRows(rows);
}

// Both review stages, computed in parallel. Manager Review (Manager/Head) and
// Specialist Review (executing Specialist) are shown as two separate sections.
async function loadReviewers(
  org: string,
  from: string,
  to: string,
): Promise<{ managerReview: ReviewerRigorRow[]; specialistReview: ReviewerRigorRow[] }> {
  const [managerReview, specialistReview] = await Promise.all([
    loadManagerReviewers(org, from, to),
    loadSpecialistReviewers(org, from, to),
  ]);
  return { managerReview, specialistReview };
}

// ---- Coverage ---------------------------------------------------------------

interface CoverageSqlRow {
  total_tasks: number;
  tasks_with_history: number;
  tasks_with_agent: number;
  tasks_with_am: number;
  archived_excluded: number;
  distinct_overdue: number;
  window_start: string | null;
  window_end: string | null;
}

async function loadCoverage(org: string): Promise<AccountabilityCoverage> {
  // window_start/window_end report the ANALYSIS window the scorecard
  // counters are computed over (last WINDOW_DAYS days) — not the history
  // extent, which used to imply (wrongly) that the metrics were windowed
  // to the full mirror.
  const sql = `
select
  (select count(*) from tasks
    where organization_id = '${org}' and archived_at is null)::int as total_tasks,
  (select count(distinct h.task_id) from task_stage_history h
     join tasks t on t.id = h.task_id and t.archived_at is null
    where h.organization_id = '${org}')::int as tasks_with_history,
  (select count(distinct ta.task_id) from task_assignees ta
     join tasks t on t.id = ta.task_id and t.archived_at is null
    where ta.organization_id = '${org}' and ta.role_type = 'agent')::int as tasks_with_agent,
  (select count(distinct ta.task_id) from task_assignees ta
     join tasks t on t.id = ta.task_id and t.archived_at is null
    where ta.organization_id = '${org}' and ta.role_type = 'account_manager')::int as tasks_with_am,
  (select count(*) from tasks
    where organization_id = '${org}' and archived_at is not null)::int as archived_excluded,
  (select count(*) from tasks t
    where t.organization_id = '${org}' and t.archived_at is null
      and t.stage <> 'done' and t.planned_date < current_date
      and exists (select 1 from task_assignees ta where ta.task_id = t.id))::int as distinct_overdue,
  (now() - interval '${WINDOW_DAYS} days') as window_start,
  now() as window_end`;

  const [row] = await runSql<CoverageSqlRow>(sql);
  return {
    totalTasks: row?.total_tasks ?? 0,
    tasksWithHistory: row?.tasks_with_history ?? 0,
    tasksWithAgent: row?.tasks_with_agent ?? 0,
    tasksWithAccountManager: row?.tasks_with_am ?? 0,
    archivedExcluded: row?.archived_excluded ?? 0,
    distinctOverdueTasks: row?.distinct_overdue ?? 0,
    windowStart: row?.window_start ?? null,
    windowEnd: row?.window_end ?? null,
  };
}

// ---- Tier-B: AI-linked signals ------------------------------------------------
// Quoted highlights from the current WhatsApp satisfaction analyses (0141).
// Each surfaced signal is linked to the client's OVERDUE live tasks
// ("related open work" — a deterministic client_id → projects → tasks join,
// labeled as context, never as the complaint's cause). These signals NEVER
// feed Tier-A.

type Highlight = SatisfactionResult["highlights"][number];

const DELAY_RE = /تأخير|تأخر|متأخر|تأخّر|delay|late/i;

function highlightKind(h: Highlight): AiLinkedSignal["kind"] | null {
  if (h.type === "complaint") return DELAY_RE.test(h.text) ? "delay_mention" : "complaint";
  if (h.type === "praise") return "praise";
  if (h.type === "escalation") return "risk";
  return null; // requests / milestones are not accountability signals
}

const RELATED_TASKS_PER_SIGNAL = 3;

interface RelatedTaskSqlRow {
  client_id: string;
  task_id: string;
  task_code: string | null;
  title: string | null;
  assignee_names: string | null;
}

async function loadAiSignals(org: string): Promise<AiLinkedSignal[]> {
  // The candidate pool is ALL current analyses (73 rows today — trivial).
  // The old `.limit(30)` truncated the pool mid-batch with no deterministic
  // secondary order, silently and permanently dropping the most
  // complaint-heavy clients. `.order("id")` keeps same-timestamp batches
  // (bulk re-analyses) deterministic; limit(1000) is a safety cap only.
  const { data, error } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("id, client_id, highlights, created_at, window_end, client:clients!inner(name)")
    .eq("organization_id", org)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(1000);
  if (error) throw error;

  const signals: AiLinkedSignal[] = [];
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const client = Array.isArray(raw.client) ? raw.client[0] : raw.client;
    const clientName = (client as { name?: string } | null)?.name ?? null;
    const highlights = (raw.highlights as Highlight[] | null) ?? [];
    highlights.forEach((h, idx) => {
      const kind = highlightKind(h);
      if (!kind || !h.text) return;
      signals.push({
        id: `${raw.id as string}:${idx}`,
        clientId: (raw.client_id as string | null) ?? null,
        clientName,
        kind,
        quote: h.text,
        source: "WhatsApp",
        occurredAt:
          h.date ?? (raw.window_end as string | null) ?? (raw.created_at as string | null),
        relatedOpenTasks: [],
      });
    });
  }

  // Complaints/risks before praise, newest first, capped for the board.
  const kindRank: Record<string, number> = { complaint: 0, delay_mention: 0, risk: 1, praise: 2 };
  signals.sort((a, b) => {
    const k = (kindRank[a.kind] ?? 3) - (kindRank[b.kind] ?? 3);
    if (k !== 0) return k;
    const d = (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "");
    if (d !== 0) return d;
    return a.id.localeCompare(b.id); // deterministic cut point
  });
  const surfaced = signals.slice(0, 12);

  // Link each surfaced signal to its client's overdue live tasks + their
  // agent/AM assignees. Deterministic heuristic (client_id → projects →
  // tasks), worst delays first — context for the conversation, never blame.
  const clientIds = [...new Set(surfaced.map((s) => s.clientId).filter((c): c is string => !!c))];
  if (clientIds.length > 0) {
    const inList = clientIds.map((c) => `'${assertUuid(c, "client id")}'`).join(", ");
    const related = await runSql<RelatedTaskSqlRow>(`
select p.client_id, t.id as task_id, t.task_code, t.title,
       (select string_agg(distinct ep.full_name, '، ')
          from task_assignees ta
          join employee_profiles ep on ep.id = ta.employee_id
         where ta.task_id = t.id
           and ta.role_type in ('agent', 'account_manager')) as assignee_names
  from tasks t
  join projects p on p.id = t.project_id
 where t.organization_id = '${org}'
   and t.archived_at is null
   and t.stage <> 'done'
   and t.planned_date < current_date
   and p.client_id in (${inList})
 order by p.client_id, t.delay_days desc nulls last, t.id`);

    const byClient = new Map<string, AiSignalRelatedTask[]>();
    for (const r of related) {
      const list = byClient.get(r.client_id) ?? [];
      if (list.length < RELATED_TASKS_PER_SIGNAL) {
        list.push({
          taskId: r.task_id,
          taskCode: r.task_code,
          title: (r.title ?? "").trim() || "—",
          assigneeNames: r.assignee_names,
        });
      }
      byClient.set(r.client_id, list);
    }
    for (const s of surfaced) {
      if (s.clientId) s.relatedOpenTasks = byClient.get(s.clientId) ?? [];
    }
  }

  return surfaced;
}

// ---- Public loaders -----------------------------------------------------------

// Scorecard rows only — reads the precomputed accountability_scorecard cache
// (a trivial indexed join), with NONE of the heavy live queries (reviewers /
// coverage / AI signals) the full overview also runs. Callers that only need
// the per-employee scores (e.g. the Team Pulse fusion + dashboard band) MUST
// use this so a slow live query can't trip their error boundary.
async function _getAccountabilityScorecard(
  orgId: string,
): Promise<AccountabilityScorecardRow[]> {
  const org = assertUuid(orgId, "organization id");
  return loadScorecard(org);
}

export const getAccountabilityScorecard = cache(_getAccountabilityScorecard);

async function _getAccountabilityPeriodTrends(
  orgId: string,
  from?: string,
  to?: string,
): Promise<Record<string, AccountabilityPeriodTrend>> {
  const org = assertUuid(orgId, "organization id");
  const range = reviewerRange(from, to);
  // Degrade instead of taking the page down. This is the heaviest live query on
  // /accountability and it runs concurrently with five others; on a loaded
  // instance any one of them can hit the 12s agent_run_readonly_sql ceiling.
  // The roster already falls back per-employee (`trends[id] ?? r.periodTrend`),
  // so an empty map costs a stale trend, not an error boundary — the same
  // "each degrades so a single timeout can't take the page down" rule the cases
  // loader follows.
  try {
    return await loadPeriodTrends(org, range);
  } catch (e) {
    console.error("[accountability] period trends failed, falling back:", e);
    return {};
  }
}

export const getAccountabilityPeriodTrends = cache(_getAccountabilityPeriodTrends);

// ---- Live desk totals (مفتوحة / معلّقة متأخرة) -------------------------------
// This is intentionally the SAME cache and meaning as نبض الفريق:
//   openLive    = tasks whose current stage this employee owns now;
//   overdueLive = those tasks whose current-stage SLA has been breached.
// Keeping the alias names avoids a wide API churn while making the displayed
// values and their drill-downs reconcile exactly across both pages.
export interface AccountabilityLiveTotals {
  openLive: number;
  overdueLive: number;
}

interface LiveTotalsSqlRow {
  employee_id: string;
  open_live: number;
  overdue_live: number;
}

async function _getAccountabilityLiveTotals(
  orgId: string,
): Promise<Record<string, AccountabilityLiveTotals>> {
  const org = assertUuid(orgId, "organization id");
  const sql = `
select employee_id,
       owned_open::int as open_live,
       pending_late::int as overdue_live
  from team_activity_cache
 where organization_id = '${org}'`;
  const rows = await runSql<LiveTotalsSqlRow>(sql);
  const result: Record<string, AccountabilityLiveTotals> = {};
  for (const r of rows) {
    result[r.employee_id] = { openLive: r.open_live, overdueLive: r.overdue_live };
  }
  return result;
}

export const getAccountabilityLiveTotals = cache(_getAccountabilityLiveTotals);

// ---- Silent days (أيام صامتة) ------------------------------------------------
// Working days in the SELECTED PERIOD on which the person authored ZERO actions.
// Deliberately archived-INCLUSIVE (no tasks join): working an archived task is
// still working, so it must NOT read as a silent day. This is the one place the
// engine counts archived activity — the productivity number (إجراءات ٣٠ي) stays
// live-only to reconcile with نبض الفريق; silence answers a different question
// ("was the person present at all?"). Window follows the range picker instead of
// the old fixed 14 days.
export interface AccountabilitySilence {
  silentDays: number; // Sun–Thu days in the period with zero authored actions
  windowDays: number; // calendar days in the period (for the label)
  dailyActivity: { date: string; count: number }[]; // full period axis, oldest→newest
  // Authored actions inside the SELECTED PERIOD, counted the نبض الفريق way:
  // non-archived tasks only. dailyActivity/silentDays stay archived-INCLUSIVE on
  // purpose (a silent day is silent even if the work was later archived), so the
  // two numbers are deliberately different populations — don't "reconcile" them.
  actionsInPeriod: number;
}

// Sun–Thu working day (getUTCDay: 5=Fri, 6=Sat are the Saudi weekend).
function isWorkingDayIso(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow !== 5 && dow !== 6;
}

interface SilenceSqlRow {
  actor_employee_id: string;
  d: string;
  n: number;
  n_live: number;
}

async function _getAccountabilitySilence(
  orgId: string,
  from?: string,
  to?: string,
): Promise<Record<string, AccountabilitySilence>> {
  const org = assertUuid(orgId, "organization id");
  const range = reviewerRange(from, to);
  const { start, endExclusive } = riyadhDateRangeUtcBounds(range.from, range.to);

  // Riyadh calendar axis for the whole period (oldest→newest).
  const axis: string[] = [];
  for (let d = range.from; d <= range.to; d = addDaysIso(d, 1)) axis.push(d);
  const workingAxis = axis.filter(isWorkingDayIso);

  // n = all authored actions per day (heatmap + silent-days);
  // n_live = of those, the ones on a still-live task (نبض الفريق's non-archived
  // definition, for actionsInPeriod). The archived split is via a LEFT JOIN to
  // ONLY the non-archived tasks (~1.4k of 13k here — 90% are archived Odoo
  // history), so the covering index idx_task_comments_org_created_actor_task
  // (0260) serves this as an index-only scan + tiny hash. An inner `join tasks`
  // instead forced a 26k-row heap fetch and pushed a 90-day window over the 12s
  // RPC ceiling, taking the whole page down.
  const sql = `
select c.actor_employee_id,
       (c.created_at at time zone 'Asia/Riyadh')::date::text as d,
       count(*)::int as n,
       count(live.id)::int as n_live
  from task_comments c
  left join (
    select id from tasks
     where organization_id = '${org}' and archived_at is null
  ) live on live.id = c.task_id
 where c.organization_id = '${org}'
   and c.actor_employee_id is not null
   and c.created_at >= '${start}'::timestamptz
   and c.created_at <  '${endExclusive}'::timestamptz
 group by 1, 2`;
  // Degrade rather than take the page down: on the widest windows this runs
  // alongside five other live queries against the 12s RPC ceiling. An empty
  // map makes the roster fall back to emptySilence per employee (all working
  // days silent, actionsInPeriod 0) — same "each degrades" rule the trends,
  // reviewers and cases loaders follow.
  let rows: SilenceSqlRow[];
  try {
    rows = await runSql<SilenceSqlRow>(sql);
  } catch (e) {
    console.error("[accountability] silence failed, degrading:", e);
    return {};
  }

  const byEmpDay = new Map<string, Map<string, number>>();
  const liveActions = new Map<string, number>();
  for (const r of rows) {
    let m = byEmpDay.get(r.actor_employee_id);
    if (!m) {
      m = new Map();
      byEmpDay.set(r.actor_employee_id, m);
    }
    m.set(r.d, r.n);
    liveActions.set(r.actor_employee_id, (liveActions.get(r.actor_employee_id) ?? 0) + r.n_live);
  }

  const result: Record<string, AccountabilitySilence> = {};
  for (const [employeeId, m] of byEmpDay) {
    const silentDays = workingAxis.filter((d) => !(m.get(d) ?? 0)).length;
    result[employeeId] = {
      silentDays,
      windowDays: axis.length,
      dailyActivity: axis.map((date) => ({ date, count: m.get(date) ?? 0 })),
      actionsInPeriod: liveActions.get(employeeId) ?? 0,
    };
  }
  return result;
}

export const getAccountabilitySilence = cache(_getAccountabilitySilence);

// A person absent from the silence query authored nothing all period — every
// working day is silent. Roster/consumers use this to fill those gaps without
// re-deriving the axis.
export function emptySilence(from?: string, to?: string): AccountabilitySilence {
  const range = reviewerRange(from, to);
  const axis: string[] = [];
  for (let d = range.from; d <= range.to; d = addDaysIso(d, 1)) axis.push(d);
  return {
    silentDays: axis.filter(isWorkingDayIso).length,
    windowDays: axis.length,
    dailyActivity: axis.map((date) => ({ date, count: 0 })),
    actionsInPeriod: 0,
  };
}

function reviewerRange(from?: string, to?: string) {
  return from && to
    ? resolveRange({ preset: "custom", from, to })
    : resolveRange({ preset: "last_30" });
}

async function _getAccountabilityReviewers(
  orgId: string,
  from?: string,
  to?: string,
): Promise<AccountabilityOverview["reviewers"]> {
  const org = assertUuid(orgId, "organization id");
  const range = reviewerRange(from, to);
  return loadReviewers(org, range.from, range.to);
}

export const getAccountabilityReviewers = cache(_getAccountabilityReviewers);

// =========================================================================
// Client edits (تعديلات العميل) — the sibling of reviewer rigor, pointed at
// the `client_changes` stage. Review rigor asks "is the review real?"; this
// asks "when a client sends work back, do we turn it around on time?".
//
// Attribution is the SAME template rule the rest of the engine uses: the
// every assigned employee whose position matches the owner configured for
// client_changes on that task (`accountable_position_for_stage`). A task can
// legitimately belong to multiple matching assignees, exactly like Rwasem's
// Assignees filter; arbitrarily selecting one hid work from the others. Live,
// that spans 8 departments (الجرافيك، UI، السوشيال ميديا،
// Motion، محتوى السيو، السيو، البرمجة، الميديا) — not only the supporting
// ones — so the section covers every owner and the UI filters by department.
//
// The SLA is real, not invented: `sla_rules.client_changes` (480 business
// minutes today, business_hours_only). Dwell is business minutes too, so the
// comparison is apples-to-apples.
//
// The period's completed edit population is the INTERSECTION of:
//   1. tasks whose client_changes interval EXITED inside the selected window;
//   2. tasks whose Actual Done Date is inside the same window and whose final
//      state is Done or Cancelled (archived locally).
// This closes the Rwasem-filter exception where a task left client_changes
// before the window but reached Done during it. The main table adds the separate
// live/pending snapshot; SLA/rate calculations continue to use completed edits.
//
// `editRate` is completed client edits divided by tasks delivered in the same
// period. It is capped at 100%, matching the organization-level quality score.
// =========================================================================
export interface ClientEditsRow {
  employeeId: string;
  fullName: string;
  department: string | null;
  editsCompleted: number; // finalized in period AND exited client_changes in period
  editsTotal: number; // editsCompleted + tasks sitting in client_changes now
  medianEditBusinessMinutes: number | null;
  slaBreachCount: number; // …of which blew the client_changes SLA
  slaTargetMinutes: number;
  deliveredCount: number; // owned tasks with Actual Done in-period, Done/Cancelled
  editRate: number | null; // editsCompleted / deliveredCount, capped at 100%
  pendingEdits: number; // sitting in client_changes right now
  pendingSlaBreachCount: number; // …of which have already passed the client_changes SLA
  oldestPendingBusinessMinutes: number | null;
  sampleSize: number;
  confidence: "high" | "low";
}

interface ClientEditsSqlRow {
  employee_id: string;
  full_name: string | null;
  department: string | null;
  edits: number;
  median_min: number | null;
  sla_breach: number;
  sla_target: number;
  delivered: number;
  pending: number;
  pending_over_sla: number;
  oldest_min: number | null;
}

function buildClientEditsSql(org: string, from: string, to: string): string {
  const { start, endExclusive } = riyadhDateRangeUtcBounds(from, to);
  return `
with sla as (
  select coalesce(max(max_minutes), 480)::int as m
    from sla_rules
   where organization_id = '${org}' and stage_key = 'client_changes'
),
hist as (
  -- Archived history stays visible. Candidate completed edits exited
  -- client_changes inside the selected window.
  -- Live rows are also fetched for the separate active-now snapshot, even when
  -- their entry predates the selected window.
  select h.id, h.task_id, h.to_stage::text as stage, h.entered_at, h.exited_at,
         t.archived_at, t.stage::text as current_stage
    from task_stage_history h
    join tasks t on t.id = h.task_id
   where h.organization_id = '${org}'
     and h.to_stage = 'client_changes'
     and (
       (h.exited_at >= '${start}'::timestamptz and h.exited_at < '${endExclusive}'::timestamptz)
       or (h.exited_at is null and t.archived_at is null and t.stage = 'client_changes')
     )
),
period_completed as (
  -- Mirrors Rwasem's Done/Cancelled + Actual Done Date filters. Requiring this
  -- AND an in-period client_changes exit prevents a late Done from pulling an
  -- earlier edit into the selected period.
  select t.id as task_id, t.actual_done_date
    from tasks t
   where t.organization_id = '${org}'
     and t.actual_done_date >= '${from}'::date
     and t.actual_done_date <= '${to}'::date
     and (t.stage = 'done' or t.archived_at is not null)
),
relevant_tasks as (
  select distinct task_id from hist
  union
  select task_id from period_completed
),
owner_by_task as (
  select distinct ta.task_id, candidate.employee_id
        from task_assignees ta
        join relevant_tasks rt on rt.task_id = ta.task_id
        join tasks t on t.id = ta.task_id
        cross join lateral (
          values (ta.employee_id), (ta.team_manager_employee_id), (ta.head_of_dept_employee_id)
        ) as candidate(employee_id)
        join employee_profiles e on e.id = candidate.employee_id
        join positions p on p.id = e.position_id
       where ta.organization_id = '${org}'
         and candidate.employee_id is not null
         and p.role = public.accountable_position_for_stage(t.stage_owner_positions, 'client_changes')
),
edits as (
  select o.employee_id, h.task_id,
         max(coalesce(d.dwell_business_minutes::numeric,
                      public.business_minutes_between(h.entered_at, h.exited_at))) as mins
    from hist h
    join owner_by_task o on o.task_id = h.task_id
    join period_completed pc on pc.task_id = h.task_id
    left join task_stage_dwell d on d.history_id = h.id
   where h.stage = 'client_changes'
     and h.exited_at >= '${start}'::timestamptz
     and h.exited_at < '${endExclusive}'::timestamptz
   group by 1, 2
),
agg as (
  select employee_id, count(*)::int as edits,
         percentile_cont(0.5) within group (order by mins) as median_min,
         count(*) filter (where mins > (select m from sla))::int as sla_breach
    from edits group by 1
),
delivered as (
  select o.employee_id,
         count(distinct pc.task_id)::int as delivered
    from period_completed pc
    join owner_by_task o on o.task_id = pc.task_id
   group by 1
),
pend_tasks as (
  -- Per-task pending duration, computed once (business_minutes_between is slow),
  -- so both the oldest clock and the "how many already blew the SLA" count read
  -- from the same value.
  select o.employee_id, h.task_id,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(h.entered_at, now())) as mins
    from hist h
    join owner_by_task o on o.task_id = h.task_id
    left join task_stage_dwell d on d.history_id = h.id
   where h.stage = 'client_changes'
     and h.archived_at is null
     and h.current_stage = 'client_changes'
     and h.exited_at is null
),
pend as (
  select employee_id, count(distinct task_id)::int as pending,
         count(distinct task_id) filter (where mins > (select m from sla))::int as pending_over_sla,
         max(mins) as oldest_min
    from pend_tasks
   group by 1
),
keys as (
  select employee_id from agg
  union select employee_id from pend
)
select e.id as employee_id, e.full_name, dep.name as department,
       coalesce(a.edits, 0) as edits, a.median_min, coalesce(a.sla_breach, 0) as sla_breach,
       (select m from sla) as sla_target,
       coalesce(dl.delivered, 0) as delivered,
       coalesce(p.pending, 0) as pending,
       coalesce(p.pending_over_sla, 0) as pending_over_sla, p.oldest_min
  from keys k
  join employee_profiles e on e.id = k.employee_id and e.organization_id = '${org}'
  left join departments dep on dep.id = e.department_id
  left join agg a on a.employee_id = k.employee_id
  left join delivered dl on dl.employee_id = k.employee_id
  left join pend p on p.employee_id = k.employee_id
 order by (coalesce(a.edits, 0) + coalesce(p.pending, 0)) desc,
          coalesce(a.edits, 0) desc`;
}

async function _getClientEditsRigor(
  orgId: string,
  from?: string,
  to?: string,
): Promise<ClientEditsRow[]> {
  const org = assertUuid(orgId, "organization id");
  const range = reviewerRange(from, to);
  const rows = await runSql<ClientEditsSqlRow>(buildClientEditsSql(org, range.from, range.to));
  return rows.map((r) => ({
    employeeId: r.employee_id,
    fullName: r.full_name ?? "—",
    department: r.department,
    editsCompleted: r.edits,
    editsTotal: r.edits + r.pending,
    medianEditBusinessMinutes: r.median_min === null ? null : round1(r.median_min),
    slaBreachCount: r.sla_breach,
    slaTargetMinutes: r.sla_target,
    deliveredCount: r.delivered,
    editRate: r.delivered > 0 ? Math.min(100, Math.round((r.edits / r.delivered) * 100)) : null,
    pendingEdits: r.pending,
    pendingSlaBreachCount: r.pending_over_sla,
    oldestPendingBusinessMinutes: r.oldest_min === null ? null : round1(r.oldest_min),
    sampleSize: r.edits,
    confidence: r.edits >= LOW_SAMPLE ? "high" : "low",
  }));
}

export const getClientEditsRigor = cache(_getClientEditsRigor);

// =========================================================================
// Drill-downs for صرامة المراجعة + تعديلات العميل — click any number and get
// the exact tasks behind it, so the figures can be reconciled against Rwasem
// (which has no equivalent filters). Each returns one flat, per-task list; the
// UI slices it by `kind`/`flag` per clicked metric. Attribution mirrors the
// aggregate SQL exactly so the drill-down count matches the cell.
// =========================================================================
export interface DrillTask {
  taskId: string;
  taskCode: string | null;
  title: string;
  projectName: string | null;
  clientName: string | null;
  minutes: number | null; // review / edit / pending business minutes
  occurredAt: string | null; // reviewed_at / delivered_at / deadline / entered_at (kind-dependent)
  flag: boolean; // reviewer: entered client_changes after · edits: over SLA / was edited · stage: late
  kind: string; // reviewer: reviewed|pending · edits: edit|delivered|pending · roster: task|stage
  stage: string | null; // raw stage enum for stage-interval rows (roster إجمالي/متأخرة المراحل)
}

interface DrillSqlRow {
  task_id: string;
  task_code: string | null;
  title: string | null;
  project_name: string | null;
  client_name: string | null;
  minutes: number | null;
  occurred_at: string | null;
  flag: boolean | null;
  kind: string;
  stage?: string | null;
}

function mapDrill(rows: DrillSqlRow[]): DrillTask[] {
  return rows.map((r) => ({
    taskId: r.task_id,
    taskCode: r.task_code,
    title: (r.title ?? "").trim() || "—",
    projectName: r.project_name,
    clientName: r.client_name,
    minutes: r.minutes === null ? null : round1(r.minutes),
    occurredAt: r.occurred_at,
    flag: r.flag ?? false,
    kind: r.kind,
    stage: r.stage ?? null,
  }));
}

// Reviewer rigor detail: the reviewed tasks (with review minutes + whether the
// task later bounced to client_changes) and the tasks still pending this
// person's review — for one reviewer, one stage, one window.
function buildReviewerDetailSql(
  org: string,
  opts: { stage: "manager_review" | "specialist_review"; from: string; to: string; employeeId: string },
): string {
  const { start, endExclusive } = riyadhDateRangeUtcBounds(opts.from, opts.to);
  const emp = opts.employeeId;
  return `
with hist as (
  -- Archived kept (carry archived/current stage so PENDING can stay live-only). A closed
  -- review/edit interval and a delivery are historical facts. See the main
  -- reviewer query for why excluding them undercounted.
  select h.id, h.task_id, h.to_stage::text as stage, h.entered_at, h.exited_at,
         t.archived_at, t.stage::text as current_stage
    from task_stage_history h
    join tasks t on t.id = h.task_id
   where h.organization_id = '${org}'
     and h.to_stage = '${opts.stage}'
),
reviewer_by_task as (
  select distinct on (g.task_id) g.task_id, g.employee_id
    from (
      select ta.task_id, candidate.employee_id, count(*) as n
        from task_assignees ta
        join tasks t on t.id = ta.task_id
        cross join lateral (
          values (ta.employee_id), (ta.team_manager_employee_id), (ta.head_of_dept_employee_id)
        ) as candidate(employee_id)
        join employee_profiles e on e.id = candidate.employee_id
        join positions p on p.id = e.position_id
       where ta.organization_id = '${org}'
         and ta.task_id in (select task_id from hist)
         and candidate.employee_id is not null
         and p.role = public.accountable_position_for_stage(t.stage_owner_positions, '${opts.stage}')
       group by 1, 2
    ) g
   order by g.task_id, g.n desc, g.employee_id
),
review_intervals as (
  select hist.id, hist.task_id, reviewer.employee_id,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(hist.entered_at, hist.exited_at)) as rev_min,
         hist.exited_at as reviewed_at
    from hist
    join reviewer_by_task reviewer on reviewer.task_id = hist.task_id and reviewer.employee_id = '${emp}'
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = '${opts.stage}'
     and hist.exited_at >= '${start}'::timestamptz
     and hist.exited_at < '${endExclusive}'::timestamptz
),
reviewed_tasks as (
  select task_id, min(rev_min) as rev_min, min(reviewed_at) as first_reviewed_at
    from review_intervals group by 1
),
pending as (
  select distinct hist.task_id,
         max(coalesce(d.dwell_business_minutes::numeric,
                      public.business_minutes_between(hist.entered_at, least(now(), '${endExclusive}'::timestamptz)))) as pending_min
    from hist
    join reviewer_by_task reviewer on reviewer.task_id = hist.task_id and reviewer.employee_id = '${emp}'
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = '${opts.stage}'
     and hist.archived_at is null
     and hist.entered_at >= '${start}'::timestamptz
     and hist.entered_at < '${endExclusive}'::timestamptz
     and (hist.exited_at is null or hist.exited_at >= '${endExclusive}'::timestamptz)
   group by 1
)
select t.id as task_id, t.task_code, t.title, pj.name as project_name, cl.name as client_name,
       rt.rev_min as minutes, rt.first_reviewed_at as occurred_at,
       exists (
         select 1 from task_stage_history h3
          where h3.task_id = rt.task_id and h3.to_stage = 'client_changes'
            and h3.entered_at > rt.first_reviewed_at
            and h3.entered_at < '${endExclusive}'::timestamptz
       ) as flag,
       'reviewed' as kind
  from reviewed_tasks rt
  join tasks t on t.id = rt.task_id
  left join projects pj on pj.id = t.project_id
  left join clients cl on cl.id = pj.client_id
union all
select t.id, t.task_code, t.title, pj.name, cl.name,
       p.pending_min as minutes, null::timestamptz as occurred_at, false as flag, 'pending' as kind
  from pending p
  join tasks t on t.id = p.task_id
  left join projects pj on pj.id = t.project_id
  left join clients cl on cl.id = pj.client_id
 order by minutes asc nulls last`;
}

async function _getReviewerRigorDetail(
  orgId: string,
  employeeId: string,
  stage: "manager_review" | "specialist_review",
  from?: string,
  to?: string,
): Promise<DrillTask[]> {
  const org = assertUuid(orgId, "organization id");
  const emp = assertUuid(employeeId, "employee id");
  const range = reviewerRange(from, to);
  return mapDrill(
    await runSql<DrillSqlRow>(buildReviewerDetailSql(org, { stage, from: range.from, to: range.to, employeeId: emp })),
  );
}

export const getReviewerRigorDetail = cache(_getReviewerRigorDetail);

// Client-edits detail: finalized tasks that also exited client_changes in the
// window, all finalized tasks in the denominator, and the point-in-time live
// snapshot — for one stage owner and one window.
function buildClientEditsDetailSql(org: string, from: string, to: string, employeeId: string): string {
  const { start, endExclusive } = riyadhDateRangeUtcBounds(from, to);
  const emp = employeeId;
  return `
with sla as (
  select coalesce(max(max_minutes), 480)::int as m
    from sla_rules where organization_id = '${org}' and stage_key = 'client_changes'
),
hist as (
  -- Archived history stays visible. Candidate completed edits exited
  -- client_changes inside the selected window.
  -- Live rows are also fetched for the separate active-now snapshot, even when
  -- their entry predates the selected window.
  select h.id, h.task_id, h.to_stage::text as stage, h.entered_at, h.exited_at,
         t.archived_at, t.stage::text as current_stage
    from task_stage_history h
    join tasks t on t.id = h.task_id
   where h.organization_id = '${org}'
     and h.to_stage = 'client_changes'
     and (
       (h.exited_at >= '${start}'::timestamptz and h.exited_at < '${endExclusive}'::timestamptz)
       or (h.exited_at is null and t.archived_at is null and t.stage = 'client_changes')
     )
),
period_completed as (
  select t.id as task_id, t.actual_done_date
    from tasks t
   where t.organization_id = '${org}'
     and t.actual_done_date >= '${from}'::date
     and t.actual_done_date <= '${to}'::date
     and (t.stage = 'done' or t.archived_at is not null)
),
relevant_tasks as (
  select distinct task_id from hist
  union
  select task_id from period_completed
),
owner_by_task as (
  select distinct ta.task_id, candidate.employee_id
        from task_assignees ta
        join relevant_tasks rt on rt.task_id = ta.task_id
        join tasks t on t.id = ta.task_id
        cross join lateral (
          values (ta.employee_id), (ta.team_manager_employee_id), (ta.head_of_dept_employee_id)
        ) as candidate(employee_id)
        join employee_profiles e on e.id = candidate.employee_id
        join positions p on p.id = e.position_id
       where ta.organization_id = '${org}'
         and candidate.employee_id is not null
         and p.role = public.accountable_position_for_stage(t.stage_owner_positions, 'client_changes')
),
edits as (
  select h.task_id,
         max(coalesce(d.dwell_business_minutes::numeric,
                      public.business_minutes_between(h.entered_at, h.exited_at))) as mins,
         max(h.exited_at) as exited_at
    from hist h
    join owner_by_task o on o.task_id = h.task_id and o.employee_id = '${emp}'
    join period_completed pc on pc.task_id = h.task_id
    left join task_stage_dwell d on d.history_id = h.id
   where h.stage = 'client_changes'
     and h.exited_at >= '${start}'::timestamptz
     and h.exited_at < '${endExclusive}'::timestamptz
   group by 1
),
delivered as (
  select pc.task_id, pc.actual_done_date::timestamptz as delivered_at,
         exists (
           select 1 from task_stage_history c
            where c.task_id = pc.task_id
              and c.to_stage = 'client_changes'
              and c.entered_at < (pc.actual_done_date + 1)::timestamptz
         ) as was_edited
    from period_completed pc
    join owner_by_task o on o.task_id = pc.task_id and o.employee_id = '${emp}'
),
pending as (
  select distinct h.task_id,
         max(coalesce(d.dwell_business_minutes::numeric,
                      public.business_minutes_between(h.entered_at, now()))) as pending_min,
         min(h.entered_at) as entered_at
    from hist h
    join owner_by_task o on o.task_id = h.task_id and o.employee_id = '${emp}'
    left join task_stage_dwell d on d.history_id = h.id
   where h.stage = 'client_changes'
     and h.archived_at is null
     and h.current_stage = 'client_changes'
     and h.exited_at is null
   group by 1
)
select t.id as task_id, t.task_code, t.title, pj.name as project_name, cl.name as client_name,
       e.mins as minutes, e.exited_at as occurred_at,
       (e.mins > (select m from sla)) as flag, 'edit' as kind
  from edits e
  join tasks t on t.id = e.task_id
  left join projects pj on pj.id = t.project_id
  left join clients cl on cl.id = pj.client_id
union all
select t.id, t.task_code, t.title, pj.name, cl.name,
       null::numeric as minutes, dl.delivered_at as occurred_at, dl.was_edited as flag, 'delivered' as kind
  from delivered dl
  join tasks t on t.id = dl.task_id
  left join projects pj on pj.id = t.project_id
  left join clients cl on cl.id = pj.client_id
union all
select t.id, t.task_code, t.title, pj.name, cl.name,
       p.pending_min as minutes, p.entered_at as occurred_at,
       (p.pending_min > (select m from sla)) as flag, 'pending' as kind
  from pending p
  join tasks t on t.id = p.task_id
  left join projects pj on pj.id = t.project_id
  left join clients cl on cl.id = pj.client_id
 order by kind, minutes desc nulls last`;
}

async function _getClientEditsDetail(
  orgId: string,
  employeeId: string,
  from?: string,
  to?: string,
): Promise<DrillTask[]> {
  const org = assertUuid(orgId, "organization id");
  const emp = assertUuid(employeeId, "employee id");
  const range = reviewerRange(from, to);
  return mapDrill(await runSql<DrillSqlRow>(buildClientEditsDetailSql(org, range.from, range.to, emp)));
}

export const getClientEditsDetail = cache(_getClientEditsDetail);

// Drill-down for the /accountability team-table numbers (مفتوحة / معلّقة متأخرة live,
// إجمالي المراحل / مراحل متأخرة period). Same TaskDrillSheet plumbing as the
// reviewer/edits sections, so a number can be reconciled against Rwasem.
//   • open / overdue: exact نبض الفريق desk queries. `open` means the person
//     owns the current stage; `overdue` means that stage breached its SLA.
//   • totalStages / lateStages: the owned stage INTERVALS entered in the window
//     that are SLA-measurable (per interval, incl. archived-delivered), same
//     gate as the merged period-trends stage counts, occurredAt = entered_at,
//     minutes = business-minutes held. This is the STAGE-SLA failure — a
//     different question from the task deadline above; don't conflate them.
export type EmployeeMetric = "open" | "overdue" | "totalStages" | "lateStages";

function buildEmployeeMetricDrillSql(
  org: string,
  emp: string,
  metric: "totalStages" | "lateStages",
  from: string,
  to: string,
): string {
  const { start, endExclusive } = riyadhDateRangeUtcBounds(from, to);
  const lateFilter = metric === "lateStages" ? "where flag" : "";
  return `
with owned as (
  select distinct h.id as hid, t.id as task_id, t.task_code, t.title,
         pj.name as project_name, cl.name as client_name,
         h.to_stage::text as stage, h.entered_at as entered_at,
         s.max_minutes,
         public.business_minutes_between(
           h.entered_at,
           least(coalesce(h.exited_at, now()), '${endExclusive}'::timestamptz)
         ) as dwell_min,
         h.exited_at is not null and h.exited_at < '${endExclusive}'::timestamptz as exited_in_time
    from task_stage_history h
    join tasks t on t.id = h.task_id and t.organization_id = '${org}'
    join task_assignees ta on ta.task_id = t.id and ta.organization_id = '${org}' and ta.employee_id = '${emp}'
    join employee_profiles e on e.id = ta.employee_id
    join positions pos on pos.id = e.position_id
    left join projects pj on pj.id = t.project_id
    left join clients cl on cl.id = pj.client_id
    left join sla_rules s
      on s.organization_id = '${org}' and s.stage_key = h.to_stage::text
   where h.entered_at <  '${endExclusive}'::timestamptz
     and (h.exited_at is null or h.exited_at >= '${start}'::timestamptz)
     and (t.archived_at is null or t.stage = 'done')
     and pos.role = public.accountable_position_for_stage(t.stage_owner_positions, h.to_stage::text)
), judged as (
  -- Mirrors loadPeriodTrends.stage_counts exactly: EVERY owned interval that
  -- overlaps the period is listed (incl. جديد / قيد التنفيذ, which carry no SLA),
  -- and «متأخرة» = the stage's business-minute SLA was blown — not the task's
  -- delivery deadline. A stage with no SLA rule can never carry the flag.
  select *, (max_minutes is not null and dwell_min > max_minutes) as flag
    from owned
)
select task_id, task_code, title, project_name, client_name,
       round(dwell_min)::numeric as minutes, entered_at::text as occurred_at, stage, flag, 'stage' as kind
  from judged
 ${lateFilter}
 order by entered_at desc`;
}

async function _getEmployeeMetricDrill(
  orgId: string,
  employeeId: string,
  metric: EmployeeMetric,
  from?: string,
  to?: string,
): Promise<DrillTask[]> {
  const org = assertUuid(orgId, "organization id");
  const emp = assertUuid(employeeId, "employee id");
  if (metric === "open") {
    const rows = await getEmployeeOwnedDeskTasks(org, emp);
    return rows.map((row) => ({
      taskId: row.taskId,
      taskCode: row.taskCode,
      title: row.title,
      projectName: row.projectName,
      clientName: null,
      minutes: row.elapsedMinutes,
      occurredAt: row.stageEnteredAt,
      flag: row.isLate,
      kind: "task",
      stage: row.stage,
    }));
  }
  if (metric === "overdue") {
    const rows = await getEmployeePendingLateTasks(org, emp);
    return rows.map((row) => ({
      taskId: row.taskId,
      taskCode: row.taskCode,
      title: row.title,
      projectName: row.projectName,
      clientName: null,
      minutes: row.overdueMinutes,
      occurredAt: row.stageEnteredAt,
      flag: true,
      kind: "task",
      stage: row.stage,
    }));
  }
  const range = reviewerRange(from, to);
  return mapDrill(
    await runSql<DrillSqlRow>(
      buildEmployeeMetricDrillSql(org, emp, metric, range.from, range.to),
    ),
  );
}

export const getEmployeeMetricDrill = cache(_getEmployeeMetricDrill);

// The team and cases lenses need operational scores plus reviewer signals, but
// never the coverage counters or AI-signal board. Those fields each trigger
// live analytics work, so keep them off the default request path.
export type AccountabilityCaseOverview = Pick<
  AccountabilityOverview,
  "rows" | "reviewers"
>;

async function _getAccountabilityCaseOverview(
  orgId: string,
): Promise<AccountabilityCaseOverview> {
  const org = assertUuid(orgId, "organization id");
  const range = reviewerRange();
  const [rows, reviewers] = await Promise.all([
    getAccountabilityScorecard(orgId),
    getAccountabilityReviewers(org, range.from, range.to).catch((e) => {
      console.error("[accountability] loadReviewers failed, degrading:", e);
      return { managerReview: [], specialistReview: [] };
    }),
  ]);
  return { rows, reviewers };
}

export const getAccountabilityCaseOverview = cache(_getAccountabilityCaseOverview);

// Empty coverage so a degraded load still renders. distinctOverdueTasks is
// derived from the scorecard as a floor when the live coverage query fails
// (see below) — never silently shown as a confident zero.
const EMPTY_COVERAGE: AccountabilityCoverage = {
  totalTasks: 0,
  tasksWithHistory: 0,
  tasksWithAgent: 0,
  tasksWithAccountManager: 0,
  archivedExcluded: 0,
  distinctOverdueTasks: 0,
  windowStart: null,
  windowEnd: null,
};

async function _getAccountabilityOverview(
  orgId: string,
  reviewerFrom?: string,
  reviewerTo?: string,
): Promise<AccountabilityOverview> {
  const org = assertUuid(orgId, "organization id");
  const range = reviewerRange(reviewerFrom, reviewerTo);
  // The scorecard reads the precomputed cache (0193) and is the page's core —
  // if it fails, the page genuinely can't render, so we let it throw. The other
  // three are live analytics queries under a 12s statement timeout; a timeout on
  // any of them must NOT white-screen the whole page, so they degrade to empty.
  const [baseRows, trendsR, reviewersR, coverageR, aiSignalsR] = await Promise.all([
    getAccountabilityScorecard(orgId),
    reviewerFrom && reviewerTo
      ? getAccountabilityPeriodTrends(orgId, range.from, range.to).catch((e) => {
          console.error("[accountability] loadPeriodTrends failed, degrading:", e);
          return {} as Record<string, AccountabilityPeriodTrend>;
        })
      : Promise.resolve({} as Record<string, AccountabilityPeriodTrend>),
    getAccountabilityReviewers(org, range.from, range.to).catch((e) => {
      console.error("[accountability] loadReviewers failed, degrading:", e);
      return { managerReview: [], specialistReview: [] };
    }),
    loadCoverage(org).catch((e) => {
      console.error("[accountability] loadCoverage failed, degrading:", e);
      return null;
    }),
    loadAiSignals(org).catch((e) => {
      console.error("[accountability] loadAiSignals failed, degrading:", e);
      return [] as AiLinkedSignal[];
    }),
  ]);

  const rows = baseRows.map((row) => ({
    ...row,
    periodTrend: trendsR[row.employeeId] ?? EMPTY_PERIOD_TREND,
  }));

  // When coverage times out, fall back to a distinct-overdue floor derived from
  // the scorecard rows. Per-row ownership can fan out across co-assignees, so
  // the maximum is an honest lower bound rather than a fabricated sum.
  const coverage: AccountabilityCoverage =
    coverageR ?? {
      ...EMPTY_COVERAGE,
      distinctOverdueTasks: rows.reduce((m, r) => Math.max(m, r.overdueOwned), 0),
    };

  return {
    generatedAt: new Date().toISOString(),
    rows,
    reviewers: reviewersR,
    aiSignals: aiSignalsR,
    coverage,
  };
}

export const getAccountabilityOverview = cache(_getAccountabilityOverview);

interface EvidenceSqlRow {
  task_id: string;
  task_code: string | null;
  title: string | null;
  is_overdue: boolean | null;
  delay_days: number | null;
  stage: string;
  entered_at: string;
  exited_at: string | null;
  dwell_min: number | null;
  client_name: string | null;
  project_name: string | null;
  role: AccountabilityRole;
}

async function _getEmployeeAccountabilityEvidence(
  orgId: string,
  employeeId: string,
  from?: string,
  to?: string,
): Promise<AccountabilityEvidence | null> {
  const org = assertUuid(orgId, "organization id");
  const emp = assertUuid(employeeId, "employee id");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name")
    .eq("organization_id", org)
    .eq("id", emp)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return null;

  // Two modes:
  //  • period (from+to given, the /accountability modal's «الفترة المحددة» tab):
  //    intervals OVERLAPPING the selected window, and archived-but-delivered
  //    (`done`) tasks stay attributable — the historical contract used elsewhere.
  //  • default (the scorecard deep-link + the «لايف» tab): last WINDOW_DAYS,
  //    live tasks only. NOTE these two tabs are different WINDOWS, not a
  //    subset relationship: a 7-day period legitimately shows fewer rows than a
  //    30-day لايف tab. The UI labels must say so or it reads as data loss.
  const usePeriod = !!from && !!to;
  const windowPredicate = usePeriod
    ? (() => {
        const { start, endExclusive } = riyadhDateRangeUtcBounds(from!, to!);
        // Overlap, not entered-inside — same fix as loadPeriodTrends. Selecting
        // on entered_at alone hid every stage a person was still holding from
        // before the window, which is exactly the evidence that matters.
        return `h.entered_at < '${endExclusive}'::timestamptz and (h.exited_at is null or h.exited_at >= '${start}'::timestamptz)`;
      })()
    : `h.entered_at >= now() - interval '${WINDOW_DAYS} days'`;
  const archivedPredicate = usePeriod
    ? `(t.archived_at is null or t.stage = 'done')`
    : `t.archived_at is null`;

  const sql = `
with ${attribCte(org, { id: emp })}
select t.id as task_id, t.task_code, t.title, (t.stage <> 'done' and t.planned_date < current_date) as is_overdue, t.delay_days,
       h.to_stage::text as stage, h.entered_at, h.exited_at,
       coalesce(d.dwell_business_minutes::numeric,
                public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min,
       c.name as client_name, p.name as project_name, a.role
  from attrib a
  join tasks t on t.id = a.task_id and ${archivedPredicate}
  join task_stage_history h on h.task_id = t.id
  left join task_stage_dwell d on d.history_id = h.id
  join projects p on p.id = t.project_id
  left join clients c on c.id = p.client_id
 where ${roleStagePredicate("a")}
   and h.to_stage::text <> 'done'
   and ${windowPredicate}
 order by dwell_min desc
 limit 60`;

  const raw = await runSql<EvidenceSqlRow>(sql);

  // Dominant role for the panel header — most evidence wins.
  const roleCounts = new Map<AccountabilityRole, number>();
  for (const r of raw) roleCounts.set(r.role, (roleCounts.get(r.role) ?? 0) + 1);
  let role: AccountabilityRole = "agent";
  let best = -1;
  for (const [rl, n] of roleCounts) {
    if (n > best) {
      best = n;
      role = rl;
    }
  }

  return {
    employeeId: emp,
    fullName: (profile.full_name as string) ?? "—",
    role,
    items: raw.map((r) => ({
      taskId: r.task_id,
      taskCode: r.task_code,
      title: (r.title ?? "").trim() || "—",
      clientName: r.client_name,
      projectName: r.project_name,
      stage: r.stage,
      enteredAt: r.entered_at,
      exitedAt: r.exited_at,
      dwellBusinessMinutes: r.dwell_min === null ? null : round1(r.dwell_min),
      isOverdue: r.is_overdue ?? false,
      delayDays: r.delay_days,
    })),
  };
}

export const getEmployeeAccountabilityEvidence = cache(_getEmployeeAccountabilityEvidence);
