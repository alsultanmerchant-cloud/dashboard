import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TASK_OWNER_ROLE_LABELS, type TaskOwnerRoleKey } from "@/lib/labels";
import { nonLeadershipFilter } from "@/lib/data/leadership";
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
  // Structural role from the employee's position (positions.role) — what the
  // الدور column shows. Distinct from `role` below (the accountability/stage
  // attribution that the SCORE is scoped to). Source: /organization/employees.
  positionRole: string | null;
  positionLabel: string | null; // positionRole → Arabic, else jobTitle
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
const REWORK_STAGES = ["in_progress", "client_changes"];
const REWORK_WINDOW_DAYS = 14;

// Which stage intervals each role is accountable for is now TEMPLATE-DRIVEN:
// the SQL function public.accountable_role_for_stage(stage_owner_positions, stage)
// (migration 0222) reads each task's per-stage owner map (organised in
// /task-templates) and falls back to the canonical Rwasem workflow (agents
// execute new/in_progress/specialist_review/client_changes, team managers
// review manager_review, account managers handle ready_to_send/sent_to_client).
// See roleStagePredicate() below.

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

// Stage-specific "pass" (forward) destinations. A review "passes" when its task
// advances to a stage AFTER the review stage in the workflow:
//   new → in_progress → manager_review → specialist_review → ready_to_send →
//   sent_to_client → (client_changes) → done
const MANAGER_PASS_STAGES = ["specialist_review", "ready_to_send", "sent_to_client", "done"];
const SPECIALIST_PASS_STAGES = ["ready_to_send", "sent_to_client", "done"];

// Stage-history reviewer query, parameterized per review stage + attribution.
// On Odoo-synced data moved_by is 100% NULL, so reviews are credited by
// ASSIGNMENT (a team-level proxy, not a personal verdict):
//   - manager_review    → team_manager_employee_id (the Manager/Head who
//                         "reviews quality" — Sky Light ops manual)
//   - specialist_review → the executing assignee (role_type='agent' — the
//                         Specialist who "reviews final work in Specialist Review")
// The chosen reviewer is deduplicated to ONE deterministic person per task
// (most-frequent value across the task's assignee rows, uuid as tie-break)
// because a task can carry conflicting assignee rows and naive fan-out would
// count one review for several people. The UI labels this "attributed by
// assignment, not action".
function buildStageReviewerSql(
  org: string,
  opts: { stage: string; passStages: string[]; attribution: "team_manager" | "agent" },
): string {
  const actorCol =
    opts.attribution === "team_manager" ? "team_manager_employee_id" : "employee_id";
  const actorFilter =
    opts.attribution === "team_manager"
      ? "ta.team_manager_employee_id is not null"
      : "ta.role_type = 'agent' and ta.employee_id is not null";
  // Specialist Review is review WORK, so it must be credited to the المتخصص
  // (positions.role = 'specialist') — not to every agent assignee. The
  // executing المنفّذ (and assignees with no position) are NOT reviewers and
  // were wrongly surfaced here. Manager Review keys off team_manager and needs
  // no such join.
  const actorRoleJoin =
    opts.attribution === "agent"
      ? `join employee_profiles ae on ae.id = ta.employee_id
         join positions ap on ap.id = ae.position_id and ap.role = 'specialist'`
      : "";
  return `
with hist as (
  select h.id, h.task_id, h.to_stage::text as stage, h.entered_at, h.exited_at,
         lead(h.to_stage::text) over (partition by h.task_id order by h.entered_at) as next_stage
    from task_stage_history h
    join tasks t on t.id = h.task_id and t.archived_at is null
   where h.organization_id = '${org}'
),
tm as (
  select distinct on (g.task_id) g.task_id, g.employee_id
    from (
      select ta.task_id, ta.${actorCol} as employee_id, count(*) as n
        from task_assignees ta
         ${actorRoleJoin}
       where ta.organization_id = '${org}'
         and ${actorFilter}
       group by 1, 2
    ) g
   order by g.task_id, g.n desc, g.employee_id
),
reviews as (
  -- dwell from the task_stage_dwell cache (0163) — live fallback only for
  -- rows the Odoo sync rewrote since the last 10-min refresh.
  select hist.id, hist.task_id, hist.exited_at, tm.employee_id,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(hist.entered_at, hist.exited_at)) as rev_min,
         (hist.next_stage in (${stageList(opts.passStages)})) as passed
    from hist
    join tm on tm.task_id = hist.task_id
    left join task_stage_dwell d on d.history_id = hist.id
   where hist.stage = '${opts.stage}' and hist.exited_at is not null
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
   where hist.stage = '${opts.stage}' and hist.exited_at is null
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
  left join positions pe on pe.id = e.position_id
  left join agg a on a.employee_id = k.employee_id
  left join pend p on p.employee_id = k.employee_id
 -- Manager Review is BY managers (team_manager → leadership), so the agents-only
 -- filter must NOT apply there or the section comes back empty. Specialist
 -- Review keeps it (the executing المنفّذ tier).
 where ${opts.attribution === "team_manager" ? "true" : nonLeadershipFilter("pe")}
 order by coalesce(a.reviews, 0) desc`;
}

// Manager Review rigor — approval-gate decisions preferred (real decider,
// inheritance-proof), else the stage-history assignment fallback.
async function loadManagerReviewers(org: string): Promise<ReviewerRigorRow[]> {
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
  left join positions pe on pe.id = e.position_id
  left join agg a on a.employee_id = k.employee_id
  left join pend p on p.employee_id = k.employee_id
 -- Approval-gate path is Manager Review (deciders are managers/leads) — no
 -- agents-only filter, or the section empties.
 order by coalesce(a.reviews, 0) desc`;

  const gateRows = await runSql<ReviewerSqlRow>(gateSql);
  if (gateRows.length > 0) return mapReviewerRows(gateRows, "approval_gate");

  // Fallback — the Odoo sync never writes the approval-gate columns, so on
  // synced data the gate query is structurally empty while thousands of real
  // manager_review intervals sit in task_stage_history. Credit the task's team
  // manager (assignment proxy). See buildStageReviewerSql for the caveat.
  const fallbackRows = await runSql<ReviewerSqlRow>(
    buildStageReviewerSql(org, {
      stage: "manager_review",
      passStages: MANAGER_PASS_STAGES,
      attribution: "team_manager",
    }),
  );
  return mapReviewerRows(fallbackRows, "stage_history_assignment");
}

// Specialist Review rigor — the executing specialist (task assignee, role_type
// 'agent') reviews final work in this stage. There is no approval-gate
// equivalent for it, so attribution is always stage-history (assignment proxy).
async function loadSpecialistReviewers(org: string): Promise<ReviewerRigorRow[]> {
  const rows = await runSql<ReviewerSqlRow>(
    buildStageReviewerSql(org, {
      stage: "specialist_review",
      passStages: SPECIALIST_PASS_STAGES,
      attribution: "agent",
    }),
  );
  return mapReviewerRows(rows, "stage_history_assignment");
}

// Both review stages, computed in parallel. Manager Review (Manager/Head) and
// Specialist Review (executing Specialist) are shown as two separate sections.
async function loadReviewers(
  org: string,
): Promise<{ managerReview: ReviewerRigorRow[]; specialistReview: ReviewerRigorRow[] }> {
  const [managerReview, specialistReview] = await Promise.all([
    loadManagerReviewers(org),
    loadSpecialistReviewers(org),
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
      and t.stage not in ('done', 'new') and t.planned_date < current_date
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

async function _getAccountabilityOverview(orgId: string): Promise<AccountabilityOverview> {
  const org = assertUuid(orgId, "organization id");
  const [rows, reviewers, coverage, aiSignals] = await Promise.all([
    getAccountabilityScorecard(orgId),
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
select t.id as task_id, t.task_code, t.title, (t.stage <> 'done' and t.planned_date < current_date) as is_overdue, t.delay_days,
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
