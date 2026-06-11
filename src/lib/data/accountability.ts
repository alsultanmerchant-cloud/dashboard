import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SatisfactionResult } from "@/lib/satisfaction-schema";

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
//     aggregate over distinct history rows (see coverage.distinctOverdueTasks).
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

export interface AccountabilityScorecardRow {
  employeeId: string;
  fullName: string;
  jobTitle: string | null;
  role: AccountabilityRole;
  openTasks: number;
  overdueOwned: number;
  avgDwellBusinessMinutes: number | null; // closed intervals in window
  onTimeRate: number | null; // 0-100 — share of SLA-decidable intervals within their stage SLA
  reworkReturns30d: number; // client_changes re-entries in the window (agent role)
  score: number | null; // 0-100
  sampleSize: number; // closed stage intervals in the window
  slaSampleSize: number; // SLA-decidable intervals (closed + open-already-breached)
  confidence: "high" | "low"; // low when slaSampleSize < 5 — gates trust in onTimeRate
}

export interface ReviewerRigorRow {
  employeeId: string;
  fullName: string;
  reviewsCompleted: number;
  medianReviewBusinessMinutes: number | null; // percentile_cont(0.5) — dwell is right-skewed
  fastReviewShare: number | null; // 0-100 — share decided in < FAST_REVIEW_MINUTES
  passCount: number; // reviews that exited FORWARD (specialist_review/ready_to_send/sent_to_client/done)
  reworkCount: number; // passes whose task re-entered in_progress/client_changes within 14 days
  reworkAfterPassRate: number | null; // 0-100 — reworkCount / passCount (passed-only denominator)
  pendingReviews: number;
  oldestPendingBusinessMinutes: number | null;
  // How reviews were credited: real approval-gate actions (inheritance-proof)
  // vs. team-manager assignment on the task (Odoo records no stage actor —
  // read those as team-level attribution, not personal verdicts).
  attribution: "approval_gate" | "stage_history_assignment";
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
  // Distinct live overdue tasks with at least one assignee — the org-level
  // overdue number. Per-row overdueOwned fans out across co-assignees and
  // must not be summed.
  distinctOverdueTasks: number;
  // The analysis window (now - WINDOW_DAYS → now), NOT the history extent.
  windowStart: string | null;
  windowEnd: string | null;
}

export interface AccountabilityOverview {
  generatedAt: string;
  rows: AccountabilityScorecardRow[];
  reviewers: ReviewerRigorRow[];
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
// A "pass" out of manager_review goes forward to one of these stages.
const PASS_STAGES = ["specialist_review", "ready_to_send", "sent_to_client", "done"];
// Rework-after-pass: task re-enters one of these within this many days.
const REWORK_STAGES = ["in_progress", "client_changes"];
const REWORK_WINDOW_DAYS = 14;

// Which stage intervals each role is accountable for. Mirrors the Sky Light
// workflow: agents execute, team managers review, account managers handle
// client-facing handoff.
const ROLE_STAGES: Record<AccountabilityRole, string[]> = {
  agent: ["in_progress", "client_changes"],
  team_manager: ["manager_review"],
  account_manager: ["ready_to_send", "sent_to_client"],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function stageList(stages: string[]): string {
  return stages.map((s) => `'${s}'`).join(", ");
}

// The attribution CTE shared by the scorecard and evidence queries:
// one (task_id, employee_id, role) row per accountable relationship.
function attribCte(org: string, employeeFilter?: { id: string }): string {
  const emp = employeeFilter ? `and ta.employee_id = '${employeeFilter.id}'` : "";
  const tm = employeeFilter
    ? `and ta.team_manager_employee_id = '${employeeFilter.id}'`
    : "";
  return `
attrib as (
  select ta.task_id, ta.employee_id, 'agent'::text as role
    from task_assignees ta
   where ta.organization_id = '${org}' and ta.role_type = 'agent' ${emp}
  union
  select ta.task_id, ta.employee_id, 'account_manager'
    from task_assignees ta
   where ta.organization_id = '${org}' and ta.role_type = 'account_manager' ${emp}
  union
  select ta.task_id, ta.team_manager_employee_id, 'team_manager'
    from task_assignees ta
   where ta.organization_id = '${org}' and ta.team_manager_employee_id is not null ${tm}
)`;
}

function roleStagePredicate(alias: string): string {
  return `(
       (${alias}.role = 'agent' and h.to_stage in (${stageList(ROLE_STAGES.agent)}))
    or (${alias}.role = 'team_manager' and h.to_stage in (${stageList(ROLE_STAGES.team_manager)}))
    or (${alias}.role = 'account_manager' and h.to_stage in (${stageList(ROLE_STAGES.account_manager)}))
  )`;
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
  const sql = `
with ${attribCte(org)},
live as (
  select id, is_overdue, stage
    from tasks
   where organization_id = '${org}' and archived_at is null
),
open_counts as (
  select a.employee_id, a.role,
         count(distinct a.task_id) filter (where lt.stage <> 'done') as open_tasks,
         count(distinct a.task_id) filter (where lt.stage <> 'done' and lt.is_overdue) as overdue_owned
    from attrib a
    join live lt on lt.id = a.task_id
   group by 1, 2
),
intervals as (
  -- dwell comes from the task_stage_dwell cache (migration 0163, pg_cron
  -- refresh every 10 min) — live business_minutes_between() only as a
  -- fallback for rows the Odoo sync rewrote since the last refresh.
  select a.employee_id, a.role, h.to_stage::text as stage_key, h.exited_at,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min
    from attrib a
    join live lt on lt.id = a.task_id
    join task_stage_history h on h.task_id = a.task_id
    left join task_stage_dwell d on d.history_id = h.id
   where ${roleStagePredicate("a")}
     and h.entered_at >= now() - interval '${WINDOW_DAYS} days'
),
measured as (
  -- avg dwell / sample_size: CLOSED intervals only (open dwell still grows).
  -- sla_n / sla_ok: closed intervals + OPEN intervals already past their
  -- rule (decidable breaches — excluding them is survivorship bias). Open
  -- intervals still within SLA stay out (verdict unknown).
  -- rework_30d: every client_changes re-entry in the window (agent role),
  -- open or closed.
  select i.employee_id, i.role,
         avg(i.dwell_min) filter (where i.exited_at is not null) as avg_dwell,
         count(*) filter (where i.exited_at is not null) as sample_size,
         count(*) filter (where s.max_minutes is not null
                            and (i.exited_at is not null or i.dwell_min > s.max_minutes)) as sla_n,
         count(*) filter (where s.max_minutes is not null
                            and i.exited_at is not null
                            and i.dwell_min <= s.max_minutes) as sla_ok,
         count(*) filter (where i.role = 'agent' and i.stage_key = 'client_changes') as rework_30d
    from intervals i
    left join sla_rules s
      on s.organization_id = '${org}' and s.stage_key = i.stage_key
   group by 1, 2
),
keys as (
  select employee_id, role from open_counts
  union
  select employee_id, role from measured
)
select e.id as employee_id, e.full_name, e.job_title, k.role,
       coalesce(oc.open_tasks, 0)::int as open_tasks,
       coalesce(oc.overdue_owned, 0)::int as overdue_owned,
       m.avg_dwell,
       coalesce(m.sample_size, 0)::int as sample_size,
       coalesce(m.sla_n, 0)::int as sla_n,
       coalesce(m.sla_ok, 0)::int as sla_ok,
       coalesce(m.rework_30d, 0)::int as rework_30d
  from keys k
  join employee_profiles e on e.id = k.employee_id and e.organization_id = '${org}'
  left join open_counts oc on oc.employee_id = k.employee_id and oc.role = k.role
  left join measured m on m.employee_id = k.employee_id and m.role = k.role`;

  const raw = await runSql<ScorecardSqlRow>(sql);

  // Collapse to one row per employee: counters sum across the employee's
  // accountable roles (every interval is already restricted to stages that
  // role owns); the displayed role is the dominant attribution.
  const byEmp = new Map<
    string,
    {
      fullName: string;
      jobTitle: string | null;
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
    });
  }
  return rows;
}

// ---- Reviewer rigor ---------------------------------------------------------

interface ReviewerSqlRow {
  employee_id: string;
  full_name: string;
  reviews: number;
  median_min: number | null;
  fast_n: number;
  pass_n: number;
  rework_n: number;
  pending: number;
  oldest_min: number | null;
}

function mapReviewerRows(
  raw: ReviewerSqlRow[],
  attribution: ReviewerRigorRow["attribution"],
): ReviewerRigorRow[] {
  return raw.map((r) => ({
    employeeId: r.employee_id,
    fullName: r.full_name ?? "—",
    reviewsCompleted: r.reviews,
    medianReviewBusinessMinutes: r.median_min === null ? null : round1(r.median_min),
    fastReviewShare:
      r.reviews > 0 ? Math.round((r.fast_n / r.reviews) * 100) : null,
    passCount: r.pass_n,
    reworkCount: r.rework_n,
    // Passed-only denominator; null when nothing passed (undecidable).
    reworkAfterPassRate:
      r.pass_n > 0 ? Math.round((r.rework_n / r.pass_n) * 100) : null,
    pendingReviews: r.pending,
    oldestPendingBusinessMinutes: r.oldest_min === null ? null : round1(r.oldest_min),
    attribution,
    sampleSize: r.reviews,
    confidence: r.reviews >= LOW_SAMPLE ? "high" : "low",
  }));
}

async function loadReviewers(org: string): Promise<ReviewerRigorRow[]> {
  // Preferred source — approval gates (0048): decided reviews carry
  // requested→decided timestamps and the ACTUAL decider (inheritance-proof
  // attribution). Pass/rework classification still comes from stage history
  // (gates record the decision, the stage flow records what happened next).
  const gateSql = `
with decided as (
  select t.id as task_id, approval_decided_by as employee_id, approval_decided_at,
         public.business_minutes_between(approval_requested_at, approval_decided_at) as rev_min,
         (approval_status = 'approved') as passed
    from tasks t
   where organization_id = '${org}'
     and archived_at is null
     and approval_decided_by is not null
     and approval_requested_at is not null
     and approval_decided_at is not null
),
agg as (
  select d.employee_id, count(*)::int as reviews,
         percentile_cont(0.5) within group (order by d.rev_min) as median_min,
         count(*) filter (where d.rev_min < ${FAST_REVIEW_MINUTES})::int as fast_n,
         count(*) filter (where d.passed)::int as pass_n,
         count(*) filter (where d.passed and exists (
           select 1 from task_stage_history h3
            where h3.task_id = d.task_id
              and h3.to_stage in (${stageList(REWORK_STAGES)})
              and h3.entered_at > d.approval_decided_at
              and h3.entered_at <= d.approval_decided_at + interval '${REWORK_WINDOW_DAYS} days'
         ))::int as rework_n
    from decided d
   group by 1
),
pend as (
  select first_approver_id as employee_id, count(*)::int as pending,
         max(public.business_minutes_between(approval_requested_at, now())) as oldest_min
    from tasks
   where organization_id = '${org}'
     and archived_at is null
     and approval_status = 'pending'
     and first_approver_id is not null
     and approval_requested_at is not null
   group by 1
),
keys as (
  select employee_id from agg union select employee_id from pend
)
select e.id as employee_id, e.full_name,
       coalesce(a.reviews, 0) as reviews, a.median_min, coalesce(a.fast_n, 0) as fast_n,
       coalesce(a.pass_n, 0) as pass_n, coalesce(a.rework_n, 0) as rework_n,
       coalesce(p.pending, 0) as pending, p.oldest_min
  from keys k
  join employee_profiles e on e.id = k.employee_id and e.organization_id = '${org}'
  left join agg a on a.employee_id = k.employee_id
  left join pend p on p.employee_id = k.employee_id
 order by coalesce(a.reviews, 0) desc`;

  const gateRows = await runSql<ReviewerSqlRow>(gateSql);
  if (gateRows.length > 0) return mapReviewerRows(gateRows, "approval_gate");

  // Fallback — the Odoo sync never writes the approval-gate columns, so on
  // synced data the gate query is structurally empty while hundreds of real
  // manager_review intervals sit in task_stage_history. Derive reviews from
  // those intervals (live tasks, closed = completed review, open = pending).
  //
  // Attribution caveat: moved_by is 100% NULL, so we credit the task's team
  // manager from task_assignees — deduplicated to ONE deterministic TM per
  // task (most frequent team_manager_employee_id across the task's assignee
  // rows, uuid as tie-break) because ~40% of tasks carry conflicting TM
  // values and naive fan-out would count one review for up to 5 people.
  // The UI labels this mode "attributed by assignment, not action".
  const fallbackSql = `
with hist as (
  select h.id, h.task_id, h.to_stage::text as stage, h.entered_at, h.exited_at,
         lead(h.to_stage::text) over (partition by h.task_id order by h.entered_at) as next_stage
    from task_stage_history h
    join tasks t on t.id = h.task_id and t.archived_at is null
   where h.organization_id = '${org}'
),
tm as (
  select distinct on (g.task_id) g.task_id, g.team_manager_employee_id as employee_id
    from (
      select ta.task_id, ta.team_manager_employee_id, count(*) as n
        from task_assignees ta
       where ta.organization_id = '${org}'
         and ta.team_manager_employee_id is not null
       group by 1, 2
    ) g
   order by g.task_id, g.n desc, g.team_manager_employee_id
),
reviews as (
  -- dwell from the task_stage_dwell cache (0163) — live fallback only for
  -- rows the Odoo sync rewrote since the last 10-min refresh.
  select hist.id, hist.task_id, hist.exited_at, tm.employee_id,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(hist.entered_at, hist.exited_at)) as rev_min,
         (hist.next_stage in (${stageList(PASS_STAGES)})) as passed
    from hist
    join tm on tm.task_id = hist.task_id
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = 'manager_review' and hist.exited_at is not null
),
agg as (
  select r.employee_id, count(*)::int as reviews,
         percentile_cont(0.5) within group (order by r.rev_min) as median_min,
         count(*) filter (where r.rev_min < ${FAST_REVIEW_MINUTES})::int as fast_n,
         count(*) filter (where r.passed)::int as pass_n,
         count(*) filter (where r.passed and exists (
           select 1 from task_stage_history h3
            where h3.task_id = r.task_id
              and h3.to_stage in (${stageList(REWORK_STAGES)})
              and h3.entered_at > r.exited_at
              and h3.entered_at <= r.exited_at + interval '${REWORK_WINDOW_DAYS} days'
         ))::int as rework_n
    from reviews r
   group by 1
),
pend as (
  select tm.employee_id, count(*)::int as pending,
         max(coalesce(d.dwell_business_minutes::numeric,
                      public.business_minutes_between(hist.entered_at, now()))) as oldest_min
    from hist
    join tm on tm.task_id = hist.task_id
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = 'manager_review' and hist.exited_at is null
   group by 1
),
keys as (
  select employee_id from agg union select employee_id from pend
)
select e.id as employee_id, e.full_name,
       coalesce(a.reviews, 0) as reviews, a.median_min, coalesce(a.fast_n, 0) as fast_n,
       coalesce(a.pass_n, 0) as pass_n, coalesce(a.rework_n, 0) as rework_n,
       coalesce(p.pending, 0) as pending, p.oldest_min
  from keys k
  join employee_profiles e on e.id = k.employee_id and e.organization_id = '${org}'
  left join agg a on a.employee_id = k.employee_id
  left join pend p on p.employee_id = k.employee_id
 order by coalesce(a.reviews, 0) desc`;

  const fallbackRows = await runSql<ReviewerSqlRow>(fallbackSql);
  return mapReviewerRows(fallbackRows, "stage_history_assignment");
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
      and t.stage <> 'done' and t.is_overdue
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
   and t.is_overdue
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

async function _getAccountabilityOverview(orgId: string): Promise<AccountabilityOverview> {
  const org = assertUuid(orgId, "organization id");
  const [rows, reviewers, coverage, aiSignals] = await Promise.all([
    loadScorecard(org),
    loadReviewers(org),
    loadCoverage(org),
    loadAiSignals(org),
  ]);
  return { generatedAt: new Date().toISOString(), rows, reviewers, aiSignals, coverage };
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

  const sql = `
with ${attribCte(org, { id: emp })}
select t.id as task_id, t.task_code, t.title, t.is_overdue, t.delay_days,
       h.to_stage::text as stage, h.entered_at, h.exited_at,
       coalesce(d.dwell_business_minutes::numeric,
                public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min,
       c.name as client_name, p.name as project_name, a.role
  from attrib a
  join tasks t on t.id = a.task_id and t.archived_at is null
  join task_stage_history h on h.task_id = t.id
  left join task_stage_dwell d on d.history_id = h.id
  join projects p on p.id = t.project_id
  left join clients c on c.id = p.client_id
 where ${roleStagePredicate("a")}
   and h.entered_at >= now() - interval '${WINDOW_DAYS} days'
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
