import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAccountabilityOverview } from "@/lib/data/accountability";
import {
  getAccountabilityCases,
  type CaseSeverity,
} from "@/lib/data/accountability-cases";

// =========================================================================
// Accountability roster — the org's accountable population (the scorecard
// employees, non-leadership) grouped by department, each row tagged with its
// live case severity if any. Feeds the /accountability team view: a department
// grid + a searchable, paginated employee table whose rows open a full modal.
// Reuses getAccountabilityOverview + getAccountabilityCases (both React-cached,
// so this adds only one lightweight department lookup).
// =========================================================================

export interface RosterEmployee {
  id: string;
  name: string;
  role: string | null;
  department: string;
  openTasks: number;
  overdueOwned: number;
  onTimeRate: number | null;
  score: number | null;
  reworkReturns30d: number;
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

async function _getAccountabilityRoster(orgId: string): Promise<AccountabilityRoster> {
  const [overview, cases, depts] = await Promise.all([
    getAccountabilityOverview(orgId),
    getAccountabilityCases(orgId),
    fetchDeptMap(orgId),
  ]);

  const sevByEmp = new Map<string, CaseSeverity>();
  for (const c of cases.cases) if (c.employeeId) sevByEmp.set(c.employeeId, c.severity);

  const employees: RosterEmployee[] = overview.rows.map((r) => ({
    id: r.employeeId,
    name: r.fullName,
    role: r.positionLabel ?? r.jobTitle ?? null,
    department: depts.get(r.employeeId) ?? UNASSIGNED,
    openTasks: r.openTasks,
    overdueOwned: r.overdueOwned,
    onTimeRate: r.onTimeRate,
    score: r.score,
    reworkReturns30d: r.reworkReturns30d,
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
