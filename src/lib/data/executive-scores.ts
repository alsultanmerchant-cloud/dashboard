import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrgSatisfactionAggregate } from "@/lib/data/satisfaction";

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
  briefAdherence: number | null; // avg AI brief-adherence, null = none analyzed
  analyzedClients: number;
  satisfactionAvailable: boolean; // true once any client has been analyzed
}

export interface DisciplineScore {
  score: number;
  delta: number | null;
  activeMembers: number | null; // null = no per-user attribution in source
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
  utilizationPct: number | null; // null = no allocated-hours data
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

// =========================================================================
// Main fetcher
// =========================================================================

async function _getExecutiveScores(orgId: string): Promise<ExecutiveScores> {
  const since30 = daysAgoIso(30);
  const since7 = daysAgoIso(7);
  const since5 = daysAgoIso(5);

  const [
    snaps,
    openTasksRes,
    agentLoadRes,
    reworkRes,
    rejectedRes,
    decidedRes,
    moves7Res,
    comments7Res,
    timesheets7Res,
    contributorsRes,
    membersRes,
    backlogRes,
    slaRes,
    escalationsRes,
    satAgg,
  ] = await Promise.all([
    loadSnapshots(orgId),
    // Open (non-archived, not done) tasks — drives delivery + freshness.
    supabaseAdmin
      .from("tasks")
      .select("id, is_overdue, delay_days, hold_since, stage_entered_at, project_id, revision_count")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .neq("stage", "done"),
    // Agent load on open tasks — drives capacity/balance.
    supabaseAdmin
      .from("task_assignees")
      .select("employee_id, task:tasks!inner(id, stage, allocated_time_minutes, archived_at)")
      .eq("organization_id", orgId)
      .eq("role_type", "agent"),
    // Rework: client_changes transitions in last 30d.
    supabaseAdmin
      .from("task_stage_history")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("to_stage", "client_changes")
      .gte("entered_at", since30),
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
    // Activity volume last 7d (stage moves + comments + timesheets).
    supabaseAdmin
      .from("task_stage_history")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("entered_at", since7),
    supabaseAdmin
      .from("task_comments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", since7),
    supabaseAdmin
      .from("task_timesheets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", since7),
    // Distinct active contributors in last 5 days (who moved a task).
    supabaseAdmin
      .from("task_stage_history")
      .select("moved_by")
      .eq("organization_id", orgId)
      .gte("entered_at", since5)
      .not("moved_by", "is", null),
    // Active team headcount.
    supabaseAdmin
      .from("employee_profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("employment_status", "active"),
    // SLA: review-stage backlog times.
    supabaseAdmin
      .from("v_review_backlog")
      .select("stage, business_minutes_in_stage")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("sla_rules")
      .select("stage_key, max_minutes")
      .eq("organization_id", orgId),
    // Unacknowledged escalations.
    supabaseAdmin
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("acknowledged_at", null),
    // AI client-satisfaction aggregate (from imported WhatsApp chats).
    getOrgSatisfactionAggregate(orgId),
  ]);

  // ---- Open-task derived figures ----------------------------------------
  // Reality of the current (Odoo-synced) dataset: delay_days and due_date are
  // NOT populated on overdue tasks, revision_count is empty, allocated hours
  // are zero, and stage_history.moved_by carries no attribution. We therefore
  // derive what genuinely exists (counts, stage dwell, snapshot history) and
  // mark the rest as `null` so it renders N/A and drops out of the score.
  type OpenTask = {
    is_overdue: boolean;
    delay_days: number | null;
    hold_since: string | null;
    stage_entered_at: string;
    project_id: string;
    revision_count: number | null;
  };
  const openTasks = (openTasksRes.data ?? []) as unknown as OpenTask[];
  const openCount = openTasks.length;
  const overdueCount = openTasks.filter((t) => t.is_overdue).length;
  const blockedTasks = openTasks.filter((t) => t.hold_since !== null).length;

  const lateProjectIds = new Set(openTasks.filter((t) => t.is_overdue).map((t) => t.project_id));
  const lateProjects = lateProjectIds.size;

  // Delay duration: only if delay_days is actually populated anywhere.
  const delays = openTasks.map((t) => t.delay_days ?? 0).filter((d) => d > 0);
  const avgDelayDays: number | null = delays.length
    ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
    : null;

  // Critical: overdue AND stuck in its current stage > 14 days (stage_entered_at
  // IS populated, so this is a real "stalled + late" signal).
  const criticalOverdue = openTasks.filter(
    (t) => t.is_overdue && t.stage_entered_at < daysAgoIso(14),
  ).length;

  // Stalled WIP: no stage movement in > 7 days (proxy for "no updates").
  const staleTasks = openTasks.filter((t) => t.stage_entered_at < daysAgoIso(7)).length;

  // Revisions: revision_count is unpopulated by the Odoo sync → N/A.
  const revisionFilled = openTasks.filter((t) => (t.revision_count ?? 0) > 0).length;
  const avgRevisions: number | null =
    revisionFilled > 0
      ? Math.round(
          (openTasks.reduce((a, t) => a + (t.revision_count ?? 0), 0) / openTasks.length) * 10,
        ) / 10
      : null;

  // ---- Snapshot-backed delivery figures ---------------------------------
  const onTimePct = snaps.current?.on_time_pct_30d ?? null;
  const completed30d = snaps.current?.done_30d_count ?? 0;

  // ---- Capacity / load (by open-task count; hours are unavailable) -------
  type LoadRow = {
    employee_id: string;
    task:
      | { id: string; stage: string; allocated_time_minutes: number | null; archived_at: string | null }
      | { id: string; stage: string; allocated_time_minutes: number | null; archived_at: string | null }[]
      | null;
  };
  const countByEmp = new Map<string, number>();
  let allocatedMinutesTotal = 0;
  for (const raw of (agentLoadRes.data ?? []) as unknown as LoadRow[]) {
    const t = Array.isArray(raw.task) ? raw.task[0] : raw.task;
    if (!t || t.archived_at || t.stage === "done") continue;
    countByEmp.set(raw.employee_id, (countByEmp.get(raw.employee_id) ?? 0) + 1);
    allocatedMinutesTotal += t.allocated_time_minutes ?? 0;
  }
  const contributors = countByEmp.size;
  const counts = Array.from(countByEmp.values());
  const meanLoad = contributors > 0 ? counts.reduce((a, b) => a + b, 0) / contributors : 0;
  // Overloaded / under-utilized relative to the team mean open-task load.
  const overloaded = counts.filter((c) => meanLoad > 0 && c > meanLoad * 1.75).length;
  const underutilized = counts.filter((c) => meanLoad > 0 && c < meanLoad * 0.4).length;
  // Hours-based utilization only when allocation data exists.
  const utilizationPct: number | null =
    allocatedMinutesTotal > 0 && contributors > 0
      ? round((allocatedMinutesTotal / (contributors * 40 * 60)) * 100)
      : null;
  const tasksPerMember = contributors > 0 ? Math.round((meanLoad) * 10) / 10 : 0;

  // ---- Discipline / activity --------------------------------------------
  const actions7d =
    (moves7Res.count ?? 0) + (comments7Res.count ?? 0) + (timesheets7Res.count ?? 0);
  // Active members: union of anyone attributed to a recent action. With the
  // current dataset all attribution columns are null → activeMembers is null
  // (N/A) rather than a misleading 0.
  const attributed = new Set(
    ((contributorsRes.data ?? []) as Array<{ moved_by: string | null }>)
      .map((r) => r.moved_by)
      .filter((v): v is string => !!v),
  );
  const activeMembers: number | null = attributed.size > 0 ? attributed.size : null;
  const totalMembers = membersRes.count ?? 0;

  // SLA compliance: share of review-stage items still within their limit.
  const slaMax = new Map<string, number>();
  for (const r of (slaRes.data ?? []) as Array<{ stage_key: string; max_minutes: number }>) {
    slaMax.set(r.stage_key, r.max_minutes);
  }
  let slaTotal = 0;
  let slaOk = 0;
  for (const r of (backlogRes.data ?? []) as Array<{ stage: string; business_minutes_in_stage: number }>) {
    const limit = slaMax.get(r.stage);
    if (limit === undefined) continue;
    slaTotal += 1;
    if (r.business_minutes_in_stage <= limit) slaOk += 1;
  }
  const slaCompliancePct = slaTotal > 0 ? round((slaOk / slaTotal) * 100) : null;

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
  // rejection) plus AI-derived client satisfaction + brief adherence from
  // imported WhatsApp chats — each only weighted when it has data.
  const qualityScore = blend([
    { w: 0.3, v: 100 * (1 - reworkRate) },
    { w: 0.15, v: 100 * (1 - rejectionRate) },
    { w: 0.1, v: avgRevisions === null ? null : clamp(100 - avgRevisions * 20) },
    { w: 0.3, v: satAgg.avgSatisfaction },
    { w: 0.15, v: satAgg.avgBriefAdherence },
  ]);

  // 3. Team Discipline & Activity
  const activeCoverage =
    activeMembers === null || totalMembers === 0 ? null : (activeMembers / totalMembers) * 100;
  const freshnessScore = clamp(100 - (openCount > 0 ? (staleTasks / openCount) * 100 : 0));
  const activityScore = clamp(totalMembers > 0 ? (actions7d / (totalMembers * 5)) * 100 : 0);
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
  const throughputScore = clamp(
    contributors > 0 ? (completed30d / (contributors * 12)) * 100 : 0,
  ); // baseline ~12 delivered/contributor/month
  const utilizationBand =
    utilizationPct === null ? null : clamp(100 - Math.abs(utilizationPct - 85) * 1.3);
  const productivityScore = blend([
    { w: 0.3, v: utilizationBand },
    { w: 0.4, v: balanceScore },
    { w: 0.3, v: throughputScore },
  ]);

  // 5. Operational Stability (composite of the four + risk adjustment)
  const atRiskClients = satAgg.atRiskClients;
  const riskScore = clamp(
    100 - unackEscalations * 5 - criticalOverdue * 0.3 - atRiskClients * 6,
  );
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
