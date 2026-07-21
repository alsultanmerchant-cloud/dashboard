import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  emptySilence,
  getAccountabilityLiveTotals,
  getAccountabilityPeriodTrends,
  getAccountabilityScorecard,
  getAccountabilitySilence,
  type AccountabilityPeriodTrend,
  type AccountabilitySilence,
} from "@/lib/data/accountability";
import {
  getAccountabilityCases,
  type CaseSeverity,
} from "@/lib/data/accountability-cases";

// =========================================================================
// Accountability roster — the org's accountable population (the scorecard
// employees, non-leadership) grouped by department, each row tagged with its
// live case severity if any. Feeds the /accountability team view: a department
// grid + a searchable, paginated employee table whose rows open a full modal.
// Reuses the compact cached scorecard plus the live case feed. The full
// overview's coverage and AI-signal queries belong only to the scorecard lens.
// =========================================================================

export interface RosterEmployee {
  id: string;
  name: string;
  role: string | null;
  department: string;
  // على مكتبه / معلّقة متأخرة — the same LIVE current-stage ownership and
  // stage-SLA counters shown in Team Pulse. See getAccountabilityLiveTotals.
  openTasks: number;
  overdueOwned: number;
  // إجمالي المراحل / مراحل متأخرة — period-filtered, stage-ownership fan-out
  // (one interval each, so two owned stages on one task count as two).
  totalStages: number;
  lateStages: number;
  // أيام صامتة — period-scoped, archived-inclusive silence for this employee.
  silence: AccountabilitySilence;
  onTimeRate: number | null;
  score: number | null;
  reworkReturns30d: number;
  periodTrend: AccountabilityPeriodTrend;
  severity: CaseSeverity | null; // null = no live case
  hasCase: boolean;
}

export interface DepartmentSummary {
  name: string;
  total: number;
  withCases: number;
  critical: number;
  proven: number;
}

export interface AccountabilityRoster {
  departments: DepartmentSummary[];
  employees: RosterEmployee[];
}

const UNASSIGNED = "بلا قسم";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchDeptMap(orgId: string): Promise<Map<string, string>> {
  if (!UUID_RE.test(orgId)) throw new Error("roster: bad org id");
  const sql = `
select e.id, coalesce(d.name, '${UNASSIGNED}') as dept
  from employee_profiles e
  left join departments d on d.id = e.department_id
 where e.organization_id = '${orgId.toLowerCase()}'`;
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`roster dept query failed: ${error.message}`);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; dept: string }[]) map.set(r.id, r.dept);
  return map;
}

async function _getAccountabilityRoster(
  orgId: string,
  from?: string,
  to?: string,
): Promise<AccountabilityRoster> {
  const [scorecard, trends, liveTotals, silence, cases, depts] = await Promise.all([
    getAccountabilityScorecard(orgId),
    getAccountabilityPeriodTrends(orgId, from, to),
    getAccountabilityLiveTotals(orgId),
    getAccountabilitySilence(orgId, from, to),
    getAccountabilityCases(orgId),
    fetchDeptMap(orgId),
  ]);

  const fallbackSilence = emptySilence(from, to);

  const sevByEmp = new Map<string, CaseSeverity>();
  for (const c of cases.cases) if (c.employeeId) sevByEmp.set(c.employeeId, c.severity);

  const employees: RosterEmployee[] = scorecard.map((r) => ({
    id: r.employeeId,
    name: r.fullName,
    role: r.positionLabel ?? r.jobTitle ?? null,
    department: depts.get(r.employeeId) ?? UNASSIGNED,
    // Exact Team Pulse desk counters. Fall back to the already-normalized
    // scorecard values only if the live cache returned no row for this person.
    openTasks: liveTotals[r.employeeId]?.openLive ?? r.openTasks,
    overdueOwned: liveTotals[r.employeeId]?.overdueLive ?? r.overdueOwned,
    totalStages: (trends[r.employeeId] ?? r.periodTrend).currentTotalStages,
    lateStages: (trends[r.employeeId] ?? r.periodTrend).currentLateStages,
    silence: silence[r.employeeId] ?? fallbackSilence,
    onTimeRate: r.onTimeRate,
    score: r.score,
    reworkReturns30d: r.reworkReturns30d,
    periodTrend: trends[r.employeeId] ?? r.periodTrend,
    severity: sevByEmp.get(r.employeeId) ?? null,
    hasCase: sevByEmp.has(r.employeeId),
  }));

  const byDept = new Map<string, DepartmentSummary>();
  for (const e of employees) {
    let d = byDept.get(e.department);
    if (!d) {
      d = { name: e.department, total: 0, withCases: 0, critical: 0, proven: 0 };
      byDept.set(e.department, d);
    }
    d.total++;
    if (e.hasCase) d.withCases++;
    if (e.severity === "critical") d.critical++;
    if (e.severity === "proven") d.proven++;
  }

  const departments = [...byDept.values()].sort(
    (a, b) =>
      b.critical - a.critical ||
      b.proven - a.proven ||
      b.withCases - a.withCases ||
      b.total - a.total,
  );

  // Employees: worst first (critical → proven → signal → clean), then most
  // overdue, so the table's first page surfaces who needs attention.
  const sevRank = (s: CaseSeverity | null) =>
    s === "critical" ? 3 : s === "proven" ? 2 : s === "signal" ? 1 : 0;
  employees.sort(
    (a, b) =>
      sevRank(b.severity) - sevRank(a.severity) ||
      b.overdueOwned - a.overdueOwned ||
      b.openTasks - a.openTasks,
  );

  return { departments, employees };
}

export const getAccountabilityRoster = cache(_getAccountabilityRoster);
