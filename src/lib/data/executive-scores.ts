import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrgSatisfactionAggregate } from "@/lib/data/satisfaction";
import { resolveRange, type DashboardRange } from "@/lib/dashboard-range";
import { riyadhDateOf, riyadhDateRangeUtcBounds, riyadhTodayIso } from "@/lib/tz";

// =========================================================================
// Executive index scores (/dashboard top band).
//
// Five composite 0-100 indices the CEO judges the operation by:
//   1. Delivery Commitment   — مؤشر الالتزام بالتسليم
//   2. Execution Quality     — مؤشر جودة التنفيذ (rework/rejection only;
//                              client-satisfaction sub-metric has NO data
//                              source yet → surfaced as "—")
//   3. Team Discipline       — مؤشر الالتزام والنشاط التشغيلي
//   4. Productivity & Capacity — مؤشر الإنتاجية والقدرة
//   5. Operational Stability — مؤشر الاستقرار التشغيلي (composite of 1-4)
//
// All numbers come from existing tables. On-time / overdue / throughput
// history (for period deltas) comes from `dashboard_daily_snapshots`.
// Everything is computed in ONE round of parallel queries and exposed via
// a single React-`cache()`d fetcher so every Suspense boundary reuses it.
// =========================================================================

export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

export interface DeliveryScore {
  score: number;
  delta: number | null; // points vs ~previous period (snapshot-backed)
  onTimePct: number | null;
  overdueCount: number;
  openCount: number;
  avgDelayDays: number | null; // null = no delay data in source
  lateProjects: number;
  blockedTasks: number;
}

export interface QualityScore {
  score: number;
  delta: number | null;
  reworkRate: number; // 0..1 — client_changes / delivered (30d)
  reworkCount: number;
  rejectionRate: number; // 0..1 — rejected / decided
  rejectedCount: number;
  decidedCount: number;
  avgRevisions: number | null; // null = revision_count not populated
  satisfactionScore: number | null; // avg AI client-satisfaction (WhatsApp), null = none analyzed
  briefAdherence: number | null; // avg AI brief-adherence from documented briefs, null = none analyzed
  analyzedClients: number;
  satisfactionAvailable: boolean; // true once any client has been analyzed
}

export interface DisciplineScore {
  score: number;
  delta: number | null;
  activeMembers: number | null; // distinct actors in window (task_comments attribution); null only if RPC errors
  totalMembers: number;
  actions7d: number;
  staleTasks: number; // open & no stage movement > 7 days
  openCount: number;
  slaCompliancePct: number | null;
}

export interface ProductivityScore {
  score: number;
  delta: number | null;
  completed30d: number;
  contributors: number;
  tasksPerMember: number;
  utilizationPct: number | null; // engaged-capacity %: contributors / active roster (hours absent, load stands in)
  overloaded: number; // by open-task count vs team mean
  underutilized: number;
}

export interface StabilityScore {
  score: number;
  delta: number | null;
  riskProjects: number;
  unackEscalations: number;
  criticalOverdue: number;
  atRiskClients: number; // low satisfaction / negative sentiment (AI)
}

export interface ExecutiveScores {
  delivery: DeliveryScore;
  quality: QualityScore;
  discipline: DisciplineScore;
  productivity: ProductivityScore;
  stability: StabilityScore;
}

export function gradeFor(score: number): ScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// Weighted blend that ignores unavailable (null) components and renormalizes
// the remaining weights. Returns 0 only when every component is null — the
// caller decides how to present that. This keeps a composite score honest
// when a sub-signal has no data in the current dataset.
function blend(parts: Array<{ w: number; v: number | null }>): number {
  let sumW = 0;
  let sum = 0;
  for (const p of parts) {
    if (p.v === null) continue;
    sumW += p.w;
    sum += p.w * p.v;
  }
  return sumW === 0 ? 0 : round(clamp(sum / sumW));
}

// ---- Snapshot history (for period-over-period deltas) --------------------

interface SnapshotRow {
  snapshot_date: string;
  overdue_count: number;
  open_count: number;
  done_30d_count: number;
  on_time_30d_count: number;
  on_time_pct_30d: number | null;
}

async function loadSnapshots(orgId: string): Promise<{
  current: SnapshotRow | null;
  previous: SnapshotRow | null;
}> {
  const { data, error } = await supabaseAdmin
    .from("dashboard_daily_snapshots")
    .select("snapshot_date, overdue_count, open_count, done_30d_count, on_time_30d_count, on_time_pct_30d")
    .eq("organization_id", orgId)
    .order("snapshot_date", { ascending: false })
    .limit(45);
  if (error || !data || data.length === 0) return { current: null, previous: null };

  const rows = data as unknown as SnapshotRow[];
  const current = rows[0];
  // ~4 weeks earlier: first row whose date is <= current-28d.
  const cutoff = new Date(new Date(current.snapshot_date).getTime() - 28 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const previous = rows.find((r) => r.snapshot_date <= cutoff) ?? null;
  return { current, previous };
}

// ---- Agent load (paginated) ----------------------------------------------
// Start from the small live-task set, then join its agent assignments. Starting
// from task_assignees made PostgREST join every historical assignment before
// the application discarded completed/archived tasks, turning this one input
// into the slowest dashboard query by a wide margin.
type AgentLoadRow = {
  employee_id: string;
  allocated_time_minutes: number | null;
};

// ---- SLA compliance (business-minutes, all SLA-configured stages) --------
// The «الالتزام بالـ SLA» tile used to read only v_review_backlog (the two
// review stages) and reported a misleading 0% — that view flags every review
// item as breached. The real, team-activity/accountability method compares
// public.business_minutes_between(stage_entered_at, now()) against the EFFECTIVE
// per-stage SLA (task override → template stage_sla_overrides snapshot →
// organization sla_rules) across ALL open tasks in an SLA-configured stage.
// Compliance = within-SLA / eligible. Read-only, one round-trip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSlaCompliance(
  orgId: string,
): Promise<{ eligible: number; breached: number; pct: number | null }> {
  if (!UUID_RE.test(orgId)) return { eligible: 0, breached: 0, pct: null };
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: `
      with eff as (
        select
          coalesce(
            t.sla_override_minutes,
            nullif(t.stage_sla_overrides ->> t.stage::text, '')::numeric,
            s.max_minutes
          ) sla_minutes,
          public.business_minutes_between(t.stage_entered_at, now()) elapsed
        from public.tasks t
        left join public.sla_rules s
          on s.organization_id = t.organization_id
         and s.stage_key = t.stage::text
        where t.organization_id = '${orgId}'
          and t.archived_at is null
          and t.stage <> 'done'
      )
      select
        count(*) filter (where sla_minutes is not null) eligible,
        count(*) filter (where sla_minutes is not null and elapsed > sla_minutes) breached
      from eff
    `.trim(),
  });
  if (error) {
    console.error("[executive-scores.loadSlaCompliance]", error.message);
    return { eligible: 0, breached: 0, pct: null };
  }
  const row = (Array.isArray(data) ? data[0] : null) as
    | { eligible: number | string; breached: number | string }
    | null;
  const eligible = Number(row?.eligible ?? 0);
  const breached = Number(row?.breached ?? 0);
  const pct = eligible > 0 ? round(((eligible - breached) / eligible) * 100) : null;
  return { eligible, breached, pct };
}

async function loadAgentRows(orgId: string): Promise<AgentLoadRow[]> {
  const page = 1000;
  const rows: AgentLoadRow[] = [];
  for (let offset = 0; ; offset += page) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id, allocated_time_minutes, assignees:task_assignees!inner(employee_id)")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .neq("stage", "done")
      .eq("assignees.organization_id", orgId)
      .eq("assignees.role_type", "agent")
      .order("id", { ascending: true })
      .range(offset, offset + page - 1);
    if (error || !data || data.length === 0) break;

    for (const task of data as unknown as Array<{
      allocated_time_minutes: number | null;
      assignees: { employee_id: string } | { employee_id: string }[] | null;
    }>) {
      const assignees = Array.isArray(task.assignees)
        ? task.assignees
        : task.assignees
          ? [task.assignees]
          : [];
      for (const assignee of assignees) {
        rows.push({
          employee_id: assignee.employee_id,
          allocated_time_minutes: task.allocated_time_minutes,
        });
      }
    }

    if (data.length < page) break;
  }
  return rows;
}

// =========================================================================
// Main fetcher
// =========================================================================

async function _getExecutiveScores(
  orgId: string,
  range: DashboardRange = resolveRange(undefined),
): Promise<ExecutiveScores> {
  // Windowed score inputs (rework, activity, contributors, on-time, throughput)
  // are scoped to the selected range; baselines are scaled by range length so a
  // longer window doesn't artificially inflate rate-based scores. Point-in-time
  // inputs (overdue rate, blocked, SLA backlog, escalations, headcount) stay
  // current.
  const { start: rangeStart, endExclusive: rangeEnd } = riyadhDateRangeUtcBounds(
    range.from,
    range.to,
  );

  const [
    snaps,
    openTasksRes,
    agentLoadRows,
    reworkRes,
    rejectedRes,
    decidedRes,
    moves7Res,
    comments7Res,
    timesheets7Res,
    activeMembersRes,
    membersRes,
    slaComplianceRes,
    escalationsRes,
    satAgg,
    doneInRangeRes,
  ] = await Promise.all([
    loadSnapshots(orgId),
    // Open (non-archived, not done) tasks — drives delivery + freshness.
    supabaseAdmin
      .from("tasks")
      .select("id, stage, planned_date, delay_days, hold_since, stage_entered_at, project_id, revision_count")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .neq("stage", "done"),
    // Agent load on open tasks — drives capacity/balance. Paginated: the full
    // agent-assignee set exceeds the 1000-row cap, so a plain select truncates.
    loadAgentRows(orgId),
    // Rework: client_changes transitions within the selected window. Exclude
    // archived (wound-down / lost-client) tasks so the rework score is scoped
    // like the live counts and isn't skewed by a lost-client batch.
    supabaseAdmin
      .from("task_stage_history")
      .select("id, task:tasks!inner(archived_at)", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("to_stage", "client_changes")
      .is("task.archived_at", null)
      .gte("entered_at", rangeStart)
      .lt("entered_at", rangeEnd),
    // Rejections / decided approvals (lifetime decided — the rate is stable).
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("approval_status", "rejected"),
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("approval_decided_at", "is", null),
    // Activity volume within the window (stage moves + comments + timesheets).
    supabaseAdmin
      .from("task_stage_history")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("entered_at", rangeStart)
      .lt("entered_at", rangeEnd),
    supabaseAdmin
      .from("task_comments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd),
    supabaseAdmin
      .from("task_timesheets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd),
    // Distinct active members within the window: employees who took ANY
    // attributed action (comment OR imported stage-change). Attribution lives in
    // task_comments.actor_employee_id — task_stage_history.moved_by is never
    // populated by the Odoo importer. Counted server-side (RPC) so a >1000-row
    // window doesn't truncate the distinct set.
    supabaseAdmin.rpc("dashboard_active_member_count", {
      p_org: orgId,
      p_from: rangeStart,
      p_to: rangeEnd,
    }),
    // Active team headcount.
    supabaseAdmin
      .from("employee_profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("employment_status", "active"),
    // SLA compliance across all SLA-configured stages (business-minutes vs the
    // effective per-stage SLA) — the same method Team Activity / Accountability
    // use. Replaces the review-only v_review_backlog basis that reported 0%.
    loadSlaCompliance(orgId),
    // Unacknowledged escalations.
    supabaseAdmin
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("acknowledged_at", null),
    // AI client-satisfaction aggregate (from imported WhatsApp chats).
    getOrgSatisfactionAggregate(orgId),
    // Delivered (done) tasks completed within the window — drives on-time % and
    // throughput so both track the selected range, not a fixed 30-day snapshot.
    supabaseAdmin
      .from("tasks")
      .select("completed_at, due_date, planned_date")
      .eq("organization_id", orgId)
      .eq("stage", "done")
      .is("archived_at", null)
      .gte("completed_at", rangeStart)
      .lt("completed_at", rangeEnd),
  ]);

  // ---- Open-task derived figures ----------------------------------------
  // Reality of the current (Odoo-synced) dataset: delay_days and due_date are
  // NOT populated on overdue tasks, revision_count is empty, allocated hours
  // are zero, and stage_history.moved_by carries no attribution. We therefore
  // derive what genuinely exists (counts, stage dwell, snapshot history) and
  // mark the rest as `null` so it renders N/A and drops out of the score.
  type OpenTask = {
    stage: string;
    // Overdue = open task with a passed deadline (team's Rwasem method); rows
    // are already open + non-archived, so the date test alone is the flag.
    planned_date: string | null;
    delay_days: number | null;
    hold_since: string | null;
    stage_entered_at: string;
    project_id: string;
    revision_count: number | null;
  };
  const openTasks = (openTasksRes.data ?? []) as unknown as OpenTask[];
  // Canonical overdue (migration 0257): open + non-archived + a passed deadline.
  // A not-started (`new`) task past its deadline counts too — 0219 exempted it as
  // "ordinary slip"; the team rejected that (un-started late work is the worst
  // delay) and Rwasem's own filter counts it. Rows are already open + non-archived
  // (query above), so we only test the date. Boundary is Riyadh "today", matching
  // the `tasks.is_overdue` column that /tasks?filter=overdue reads, so the
  // danger-card count and the drill-down list agree.
  const todayStr = riyadhTodayIso();
  const isOverdue = (t: OpenTask) => t.planned_date != null && t.planned_date < todayStr;
  const openCount = openTasks.length;
  const overdueCount = openTasks.filter(isOverdue).length;
  const blockedTasks = openTasks.filter((t) => t.hold_since !== null).length;

  const lateProjectIds = new Set(openTasks.filter(isOverdue).map((t) => t.project_id));
  const lateProjects = lateProjectIds.size;

  // Delay duration: only if delay_days is actually populated anywhere.
  const delays = openTasks.map((t) => t.delay_days ?? 0).filter((d) => d > 0);
  const avgDelayDays: number | null = delays.length
    ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
    : null;

  // Critical: overdue AND stuck in its current stage > 14 days (stage_entered_at
  // IS populated, so this is a real "stalled + late" signal).
  const criticalOverdue = openTasks.filter(
    (t) => isOverdue(t) && t.stage_entered_at < daysAgoIso(14),
  ).length;

  // Stalled WIP: started work with no stage movement in > 7 days (proxy for
  // "no updates"). Excludes the `new` stage — a not-started backlog task whose
  // stage_entered_at is just its creation date is ordinary unreached work, not
  // neglect, and would otherwise dominate this count (the batch is generated
  // up-front in `new`). Mirrors the is_overdue rule (migration 0219).
  const staleTasks = openTasks.filter(
    (t) => t.stage !== "new" && t.stage_entered_at < daysAgoIso(7),
  ).length;

  // Revisions: revision_count is unpopulated by the Odoo sync → N/A.
  const revisionFilled = openTasks.filter((t) => (t.revision_count ?? 0) > 0).length;
  const avgRevisions: number | null =
    revisionFilled > 0
      ? Math.round(
          (openTasks.reduce((a, t) => a + (t.revision_count ?? 0), 0) / openTasks.length) * 10,
        ) / 10
      : null;

  // ---- Range-windowed delivery figures ----------------------------------
  // On-time % and completed volume computed over the selected window (of the
  // deadline-bearing subset for on-time, all-done for completed volume).
  let completed30d = 0; // = completed in range; name kept for downstream refs
  let onTimeSampleInRange = 0;
  let onTimeHitsInRange = 0;
  for (const r of (doneInRangeRes.data ?? []) as Array<{
    completed_at: string | null;
    due_date: string | null;
    planned_date: string | null;
  }>) {
    if (!r.completed_at) continue;
    completed30d += 1;
    const deadline = r.due_date ?? r.planned_date;
    if (!deadline) continue;
    onTimeSampleInRange += 1;
    if (riyadhDateOf(r.completed_at) <= deadline) onTimeHitsInRange += 1;
  }
  const onTimePct: number | null =
    onTimeSampleInRange > 0 ? Math.round((onTimeHitsInRange / onTimeSampleInRange) * 100) : null;

  // ---- Capacity / load (by open-task count; hours are unavailable) -------
  const countByEmp = new Map<string, number>();
  let allocatedMinutesTotal = 0;
  for (const raw of agentLoadRows) {
    countByEmp.set(raw.employee_id, (countByEmp.get(raw.employee_id) ?? 0) + 1);
    allocatedMinutesTotal += raw.allocated_time_minutes ?? 0;
  }
  const contributors = countByEmp.size;
  const counts = Array.from(countByEmp.values());
  const meanLoad = contributors > 0 ? counts.reduce((a, b) => a + b, 0) / contributors : 0;
  // Overloaded / under-utilized relative to the team mean open-task load.
  const overloaded = counts.filter((c) => meanLoad > 0 && c > meanLoad * 1.75).length;
  const underutilized = counts.filter((c) => meanLoad > 0 && c < meanLoad * 0.4).length;
  // Capacity utilization. Allocated hours / timesheets are 100% empty in the
  // Odoo-synced dataset (and won't be filled), so hours-based utilization has no
  // source. Team feedback: derive it from real task-load instead — the share of
  // the active roster actually carrying open delivery work («الطاقة المشغولة»:
  // engaged vs idle capacity, the same load signal behind the حمل-زائد / مساحة
  // tiles). Falls back to the true hours formula automatically if allocation
  // data ever lands.
  const activeRoster = membersRes.count ?? 0;
  const utilizationPct: number | null =
    allocatedMinutesTotal > 0 && contributors > 0
      ? round((allocatedMinutesTotal / (contributors * 40 * 60)) * 100)
      : activeRoster > 0 && contributors > 0
        ? clamp(round((contributors / activeRoster) * 100))
        : null;
  const tasksPerMember = contributors > 0 ? Math.round((meanLoad) * 10) / 10 : 0;

  // ---- Discipline / activity --------------------------------------------
  const actions7d =
    (moves7Res.count ?? 0) + (comments7Res.count ?? 0) + (timesheets7Res.count ?? 0);
  // Active members: distinct employees who took an attributed action in the
  // window (comment OR imported stage-change), counted server-side via
  // dashboard_active_member_count — task_comments.actor_employee_id is the real
  // attribution source (moved_by is never populated by the Odoo importer).
  const activeMembers: number | null =
    typeof activeMembersRes.data === "number" ? activeMembersRes.data : null;
  const totalMembers = membersRes.count ?? 0;

  // SLA compliance: share of open tasks within their effective per-stage SLA,
  // across ALL SLA-configured stages (business-minutes basis — same method as
  // Team Activity / Accountability). Computed in loadSlaCompliance().
  const slaCompliancePct = slaComplianceRes.pct;

  // ---- Quality figures --------------------------------------------------
  const reworkCount = reworkRes.count ?? 0;
  const rejectedCount = rejectedRes.count ?? 0;
  const decidedCount = decidedRes.count ?? 0;
  const reworkRate = completed30d > 0 ? Math.min(1, reworkCount / completed30d) : 0;
  const rejectionRate = decidedCount > 0 ? rejectedCount / decidedCount : 0;

  const unackEscalations = escalationsRes.count ?? 0;
  const riskProjects = lateProjects; // projects carrying overdue work

  // ======================================================================
  // Scoring — each composite blends only the signals that have data.
  // ======================================================================
  const overdueRate = openCount > 0 ? overdueCount / openCount : 0;

  // 1. Delivery Commitment
  const deliveryScore = blend([
    { w: 0.5, v: onTimePct },
    { w: 0.3, v: 100 * (1 - overdueRate) },
    { w: 0.1, v: avgDelayDays === null ? null : clamp(100 - avgDelayDays * 8) },
    { w: 0.1, v: clamp(100 - (openCount > 0 ? (blockedTasks / openCount) * 200 : 0)) },
  ]);

  // 2. Execution Quality & Satisfaction. Operational signals (rework,
  // rejection) plus AI-derived client satisfaction — each only weighted when it
  // has data. Brief-adherence was REMOVED from this score (team feedback
  // 2026-06-28): the AI rarely has the real brief document, so the metric is
  // unreliable and shouldn't move the Quality index. The satisfaction weight
  // absorbs the freed 15% (blend renormalizes the present components anyway).
  const qualityScore = blend([
    { w: 0.3, v: 100 * (1 - reworkRate) },
    // Rejection rate only counts when approvals are actually being decided.
    // `approval_decided_at` is empty org-wide (Odoo sync never fills it), so
    // decidedCount=0 → rejectionRate=0 → this term WOULD feed a phantom 100 and
    // inflate Quality. Pass null when there's no decided sample so blend drops it.
    { w: 0.15, v: decidedCount > 0 ? 100 * (1 - rejectionRate) : null },
    { w: 0.1, v: avgRevisions === null ? null : clamp(100 - avgRevisions * 20) },
    { w: 0.3, v: satAgg.avgSatisfaction },
  ]);

  // 3. Team Discipline & Activity
  const activeCoverage =
    activeMembers === null || totalMembers === 0 ? null : (activeMembers / totalMembers) * 100;
  const freshnessScore = clamp(100 - (openCount > 0 ? (staleTasks / openCount) * 100 : 0));
  // Baseline ~5 actions/member/week, scaled to the window length so longer
  // ranges don't inflate the score.
  const activityScore = clamp(
    totalMembers > 0 ? (actions7d / (totalMembers * 5 * (range.days / 7))) * 100 : 0,
  );
  const disciplineScore = blend([
    { w: 0.3, v: activeCoverage },
    { w: 0.3, v: freshnessScore },
    { w: 0.2, v: activityScore },
    { w: 0.2, v: slaCompliancePct },
  ]);

  // 4. Productivity & Capacity (balance by task-count + throughput; hours N/A)
  const overloadRate = contributors > 0 ? overloaded / contributors : 0;
  const idleRate = contributors > 0 ? underutilized / contributors : 0;
  const balanceScore = contributors > 0 ? clamp(100 - (overloadRate + idleRate) * 100) : null;
  // Baseline ~12 delivered/contributor/month, scaled to the window length.
  const throughputScore = clamp(
    contributors > 0 ? (completed30d / (contributors * 12 * (range.days / 30))) * 100 : 0,
  );
  const utilizationBand =
    utilizationPct === null ? null : clamp(100 - Math.abs(utilizationPct - 85) * 1.3);
  const productivityScore = blend([
    { w: 0.3, v: utilizationBand },
    { w: 0.4, v: balanceScore },
    { w: 0.3, v: throughputScore },
  ]);

  // 5. Operational Stability (composite of the four + risk adjustment)
  const atRiskClients = satAgg.atRiskClients;
  // Risk overlay — each dimension is a BOUNDED, PROPORTIONAL penalty so the score
  // discriminates instead of flooring at 0. The old formula used raw counts
  // (−atRisk×6 etc.), so 22 at-risk clients alone (132) pinned riskScore to 0 on
  // any mid-size org — uninformative dead weight. Critical-overdue and churn are
  // now shares of their base (open tasks / analyzed clients) so they scale with
  // org size; each term is capped so no single one can saturate the score.
  const escalationPenalty = Math.min(20, unackEscalations * 2);
  const criticalPenalty =
    openCount > 0 ? Math.min(30, (criticalOverdue / openCount) * 100) : 0;
  const churnPenalty =
    satAgg.analyzedClients > 0
      ? Math.min(30, (atRiskClients / satAgg.analyzedClients) * 100)
      : 0;
  const riskScore = clamp(100 - escalationPenalty - criticalPenalty - churnPenalty);
  const stabilityScore = blend([
    { w: 0.3, v: deliveryScore },
    { w: 0.25, v: qualityScore },
    { w: 0.2, v: disciplineScore },
    { w: 0.15, v: productivityScore },
    { w: 0.1, v: riskScore },
  ]);

  // ---- Period deltas (snapshot-backed where possible) -------------------
  let deliveryDelta: number | null = null;
  let stabilityDelta: number | null = null;
  if (snaps.previous) {
    const prevOnTime = snaps.previous.on_time_pct_30d ?? 50;
    const prevOverdueRate =
      snaps.previous.open_count > 0 ? snaps.previous.overdue_count / snaps.previous.open_count : 0;
    const prevDeliveryProxy = 0.625 * prevOnTime + 0.375 * (100 * (1 - prevOverdueRate));
    const curDeliveryProxy = 0.625 * (onTimePct ?? 50) + 0.375 * (100 * (1 - overdueRate));
    deliveryDelta = round(curDeliveryProxy - prevDeliveryProxy);
    // Stability tracks the same snapshot-backed trend at its 30% weight.
    stabilityDelta = round(deliveryDelta * 0.3);
  }

  return {
    delivery: {
      score: deliveryScore,
      delta: deliveryDelta,
      onTimePct,
      overdueCount,
      openCount,
      avgDelayDays,
      lateProjects,
      blockedTasks,
    },
    quality: {
      score: qualityScore,
      delta: null,
      reworkRate: Math.round(reworkRate * 100) / 100,
      reworkCount,
      rejectionRate: Math.round(rejectionRate * 100) / 100,
      rejectedCount,
      decidedCount,
      avgRevisions,
      satisfactionScore: satAgg.avgSatisfaction,
      briefAdherence: satAgg.avgBriefAdherence,
      analyzedClients: satAgg.analyzedClients,
      satisfactionAvailable: satAgg.analyzedClients > 0,
    },
    discipline: {
      score: disciplineScore,
      delta: null,
      activeMembers,
      totalMembers,
      actions7d,
      staleTasks,
      openCount,
      slaCompliancePct,
    },
    productivity: {
      score: productivityScore,
      delta: null,
      completed30d,
      contributors,
      tasksPerMember,
      utilizationPct,
      overloaded,
      underutilized,
    },
    stability: {
      score: stabilityScore,
      delta: stabilityDelta,
      riskProjects,
      unackEscalations,
      criticalOverdue,
      atRiskClients,
    },
  };
}

export const getExecutiveScores = cache(_getExecutiveScores);
