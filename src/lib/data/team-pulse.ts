import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getAccountabilityScorecard,
  type AccountabilityScorecardRow,
} from "@/lib/data/accountability";

// =========================================================================
// Team Pulse (نبض الفريق) — CEO team-performance fusion layer.
//
// Replaces the dead `employee_activity_daily` instrumentation feed (which
// only ever covered ~3 in-system users) with two axes grounded in the
// Rwasem/Odoo + sheet data the org actually produces:
//
//   * Operational delivery — the accountability engine
//     (task_stage_history → on-time/SLA, overdue load, dwell, rework,
//     a 0-100 score). Covers ~99.6% of live tasks and every delivery
//     agent. Source: getAccountabilityScorecard() — the cached rows only,
//     not the heavy live overview.
//
//   * Commercial attainment — the contracts target system
//     (am_targets: expected vs achieved income per account_manager_id).
//     Only the ~14 contract-owners (account managers + heads) carry an
//     income target; delivery agents have NONE, so their bar is the
//     operational SLA standard, not a fabricated volume number.
//
// Rollup is by employee_profiles.department_id (clean: 99%+ assigned)
// with departments.head_employee_id as the head — NOT the task-level
// team_manager_employee_id (only ~22% coverage). Leadership is already
// excluded inside the accountability scorecard, so member rows here are
// individual contributors only.
//
// Honesty: every metric is nullable. Null delivery score = unmeasured
// (no SLA-decidable stage intervals), null commercial = team owns no
// contract target. Never coerce null → 0.
// =========================================================================

export type PulseStatus = "good" | "watch" | "risk" | "na";

export interface TeamMemberRow extends AccountabilityScorecardRow {
  departmentId: string | null;
  // Commercial axis — populated only when this member owns a contract target.
  commExpected: number | null;
  commAchieved: number | null;
  commAttainmentPct: number | null;
}

export interface TeamPulseRow {
  departmentId: string;
  departmentName: string;
  headEmployeeId: string | null;
  headName: string | null;
  /** Active non-leadership members of the department. */
  headcount: number;
  /** Members with a measurable delivery score. */
  measuredCount: number;
  // ---- Operational delivery (aggregated over members) ----
  deliveryScore: number | null; // sample-weighted mean of member scores
  onTimeRate: number | null; // pooled SLA-ok / SLA-decidable across members
  openTasks: number;
  overdueOwned: number; // sum of per-member overdue (fan-out indicator, not distinct)
  avgDwellBusinessMinutes: number | null; // sample-weighted mean
  reworkReturns30d: number;
  /** Members whose own delivery score is in the risk band (< RISK_SCORE). */
  atRiskMembers: number;
  // ---- Commercial attainment (targets from contracts) ----
  commExpected: number | null; // Σ expected_total of dept's contract-owners
  commAchieved: number | null;
  commAttainmentPct: number | null;
  status: PulseStatus;
}

export interface TeamPulseTotals {
  departments: number;
  measuredDepartments: number;
  headcount: number;
  openTasks: number;
  overdueOwned: number;
  /** Org-wide pooled on-time rate. */
  onTimeRate: number | null;
  /** Org-wide commercial attainment (Σ achieved / Σ expected). */
  commExpected: number | null;
  commAchieved: number | null;
  commAttainmentPct: number | null;
}

export interface TeamPulseOverview {
  generatedAt: string;
  /** Month the commercial targets are read for (latest am_targets month). */
  targetMonth: string | null;
  rows: TeamPulseRow[];
  totals: TeamPulseTotals;
}

// Delivery-score band thresholds.
const RISK_SCORE = 60;
const WATCH_SCORE = 75;
// Commercial attainment band thresholds (%).
const COMM_RISK_PCT = 70;
const COMM_WATCH_PCT = 90;

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Worst axis wins: a team that delivers well but misses target (or vice
// versa) should not read green. `na` only when BOTH axes are unmeasurable.
function statusFor(
  deliveryScore: number | null,
  overdueOwned: number,
  openTasks: number,
  commAttainmentPct: number | null,
): PulseStatus {
  const bands: PulseStatus[] = [];
  if (deliveryScore != null) {
    if (deliveryScore < RISK_SCORE) bands.push("risk");
    else if (deliveryScore < WATCH_SCORE) bands.push("watch");
    else bands.push("good");
  }
  // A heavily overdue board is a risk regardless of SLA score.
  if (openTasks > 0 && overdueOwned / openTasks >= 0.4) bands.push("risk");
  if (commAttainmentPct != null) {
    if (commAttainmentPct < COMM_RISK_PCT) bands.push("risk");
    else if (commAttainmentPct < COMM_WATCH_PCT) bands.push("watch");
    else bands.push("good");
  }
  if (bands.length === 0) return "na";
  if (bands.includes("risk")) return "risk";
  if (bands.includes("watch")) return "watch";
  return "good";
}

interface EmpRow {
  id: string;
  department_id: string | null;
  full_name: string | null;
}
interface DeptRow {
  id: string;
  name: string;
  head_employee_id: string | null;
}
interface AmTargetRow {
  account_manager_id: string;
  expected_total: number | null;
  achieved_total: number | null;
}

async function _getTeamPulseOverview(orgId: string): Promise<TeamPulseOverview> {
  // Operational axis (leadership already excluded inside the scorecard).
  const scorecard = await getAccountabilityScorecard(orgId);
  const scoreByEmp = new Map<string, AccountabilityScorecardRow>(
    scorecard.map((r) => [r.employeeId, r]),
  );

  // Org structure + latest commercial-target month, in parallel.
  const [{ data: emps }, { data: depts }, { data: latestMonth }] =
    await Promise.all([
      supabaseAdmin
        .from("employee_profiles")
        .select("id, department_id, full_name")
        .eq("organization_id", orgId)
        .eq("employment_status", "active"),
      supabaseAdmin
        .from("departments")
        .select("id, name, head_employee_id")
        .eq("organization_id", orgId),
      supabaseAdmin
        .from("am_targets")
        .select("month")
        .eq("organization_id", orgId)
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const targetMonth = (latestMonth as { month: string } | null)?.month ?? null;
  let amTargets: AmTargetRow[] = [];
  if (targetMonth) {
    const { data } = await supabaseAdmin
      .from("am_targets")
      .select("account_manager_id, expected_total, achieved_total")
      .eq("organization_id", orgId)
      .eq("month", targetMonth);
    amTargets = (data as AmTargetRow[] | null) ?? [];
  }
  const targetByEmp = new Map<string, AmTargetRow>(
    amTargets.map((t) => [t.account_manager_id, t]),
  );

  const deptById = new Map<string, DeptRow>(
    ((depts as DeptRow[] | null) ?? []).map((d) => [d.id, d]),
  );
  const empById = new Map<string, EmpRow>(
    ((emps as EmpRow[] | null) ?? []).map((e) => [e.id, e]),
  );

  // Bucket active employees by department.
  const membersByDept = new Map<string, EmpRow[]>();
  for (const e of (emps as EmpRow[] | null) ?? []) {
    if (!e.department_id) continue;
    const list = membersByDept.get(e.department_id) ?? [];
    list.push(e);
    membersByDept.set(e.department_id, list);
  }

  const rows: TeamPulseRow[] = [];
  for (const [deptId, members] of membersByDept) {
    const dept = deptById.get(deptId);
    if (!dept) continue;

    // ---- Operational aggregation over scored members ----
    let scoreWSum = 0;
    let scoreW = 0;
    let dwellWSum = 0;
    let dwellW = 0;
    let slaOk = 0;
    let slaN = 0;
    let openTasks = 0;
    let overdueOwned = 0;
    let rework = 0;
    let measuredCount = 0;
    let atRiskMembers = 0;

    // ---- Commercial aggregation over contract-owning members ----
    let commExpected: number | null = null;
    let commAchieved: number | null = null;

    for (const m of members) {
      const t = targetByEmp.get(m.id);
      if (t) {
        commExpected = (commExpected ?? 0) + (t.expected_total ?? 0);
        commAchieved = (commAchieved ?? 0) + (t.achieved_total ?? 0);
      }
      const sc = scoreByEmp.get(m.id);
      if (!sc) continue;
      openTasks += sc.openTasks;
      overdueOwned += sc.overdueOwned;
      rework += sc.reworkReturns30d;
      slaN += sc.slaSampleSize;
      // slaSampleSize × onTimeRate recovers the ok count without re-querying.
      if (sc.slaSampleSize > 0 && sc.onTimeRate != null) {
        slaOk += Math.round((sc.onTimeRate / 100) * sc.slaSampleSize);
      }
      if (sc.score != null) {
        const w = sc.slaSampleSize + 1; // favor measured members, never 0
        scoreWSum += sc.score * w;
        scoreW += w;
        measuredCount += 1;
        if (sc.score < RISK_SCORE) atRiskMembers += 1;
      }
      if (sc.avgDwellBusinessMinutes != null && sc.sampleSize > 0) {
        dwellWSum += sc.avgDwellBusinessMinutes * sc.sampleSize;
        dwellW += sc.sampleSize;
      }
    }

    const deliveryScore = scoreW > 0 ? Math.round(scoreWSum / scoreW) : null;
    const onTimeRate = pct(slaOk, slaN);
    const commAttainmentPct =
      commExpected != null && commExpected > 0
        ? Math.round(((commAchieved ?? 0) / commExpected) * 100)
        : null;

    rows.push({
      departmentId: deptId,
      departmentName: dept.name,
      headEmployeeId: dept.head_employee_id,
      headName: dept.head_employee_id
        ? (empById.get(dept.head_employee_id)?.full_name ?? null)
        : null,
      headcount: members.length,
      measuredCount,
      deliveryScore,
      onTimeRate,
      openTasks,
      overdueOwned,
      avgDwellBusinessMinutes: dwellW > 0 ? round1(dwellWSum / dwellW) : null,
      reworkReturns30d: rework,
      atRiskMembers,
      commExpected,
      commAchieved,
      commAttainmentPct,
      status: statusFor(deliveryScore, overdueOwned, openTasks, commAttainmentPct),
    });
  }

  // Worst-first: risk → watch → good → na; within a band, lowest score first.
  const statusRank: Record<PulseStatus, number> = { risk: 0, watch: 1, good: 2, na: 3 };
  rows.sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status])
      return statusRank[a.status] - statusRank[b.status];
    return (a.deliveryScore ?? 999) - (b.deliveryScore ?? 999);
  });

  // ---- Org totals ----
  let tOpen = 0;
  let tOverdue = 0;
  let tSlaOk = 0;
  let tSlaN = 0;
  let tCommExp: number | null = null;
  let tCommAch: number | null = null;
  let measuredDepartments = 0;
  let headcount = 0;
  for (const r of rows) {
    tOpen += r.openTasks;
    tOverdue += r.overdueOwned;
    headcount += r.headcount;
    if (r.deliveryScore != null) measuredDepartments += 1;
    if (r.commExpected != null) {
      tCommExp = (tCommExp ?? 0) + r.commExpected;
      tCommAch = (tCommAch ?? 0) + (r.commAchieved ?? 0);
    }
  }
  // Pool org on-time from the raw accountability rows (exact, not from dept proxy).
  for (const sc of scorecard) {
    if (sc.slaSampleSize > 0 && sc.onTimeRate != null) {
      tSlaN += sc.slaSampleSize;
      tSlaOk += Math.round((sc.onTimeRate / 100) * sc.slaSampleSize);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    targetMonth,
    rows,
    totals: {
      departments: rows.length,
      measuredDepartments,
      headcount,
      openTasks: tOpen,
      overdueOwned: tOverdue,
      onTimeRate: pct(tSlaOk, tSlaN),
      commExpected: tCommExp,
      commAchieved: tCommAch,
      commAttainmentPct:
        tCommExp != null && tCommExp > 0
          ? Math.round(((tCommAch ?? 0) / tCommExp) * 100)
          : null,
    },
  };
}

export const getTeamPulseOverview = cache(_getTeamPulseOverview);

// ---- Per-department drill-down -------------------------------------------

async function _getTeamMembers(
  orgId: string,
  departmentId: string,
): Promise<TeamMemberRow[]> {
  const scorecard = await getAccountabilityScorecard(orgId);
  const scoreByEmp = new Map<string, AccountabilityScorecardRow>(
    scorecard.map((r) => [r.employeeId, r]),
  );

  const { data: emps } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, department_id, full_name")
    .eq("organization_id", orgId)
    .eq("department_id", departmentId)
    .eq("employment_status", "active");

  const month = (
    await supabaseAdmin
      .from("am_targets")
      .select("month")
      .eq("organization_id", orgId)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data as { month: string } | null;

  const targetByEmp = new Map<string, AmTargetRow>();
  if (month?.month) {
    const { data } = await supabaseAdmin
      .from("am_targets")
      .select("account_manager_id, expected_total, achieved_total")
      .eq("organization_id", orgId)
      .eq("month", month.month);
    for (const t of (data as AmTargetRow[] | null) ?? [])
      targetByEmp.set(t.account_manager_id, t);
  }

  const rows: TeamMemberRow[] = [];
  for (const e of (emps as EmpRow[] | null) ?? []) {
    // Only members who appear in the (leadership-filtered) scorecard, so the
    // drill-down stays individual-contributor only and consistent with the
    // rollup's measuredCount.
    const sc = scoreByEmp.get(e.id);
    if (!sc) continue;
    const t = targetByEmp.get(e.id);
    const commAttainmentPct =
      t && (t.expected_total ?? 0) > 0
        ? Math.round(((t.achieved_total ?? 0) / (t.expected_total ?? 1)) * 100)
        : null;
    rows.push({
      ...sc,
      departmentId: e.department_id,
      commExpected: t?.expected_total ?? null,
      commAchieved: t?.achieved_total ?? null,
      commAttainmentPct,
    });
  }
  rows.sort((a, b) => (a.score ?? 999) - (b.score ?? 999)); // worst first
  return rows;
}

export const getTeamMembers = cache(_getTeamMembers);
