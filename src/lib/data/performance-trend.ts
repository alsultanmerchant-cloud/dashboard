import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Performance trend reader — feeds the "قارن بالسابق" employee modal (and,
// later, the CEO trends page). Reads the precomputed performance_snapshots
// table (0216): one frozen row per (scope, period) so the modal renders
// instantly and the chart can animate on filter change without recomputing
// historical windows live.
//
// For an employee we return their own weekly + monthly series PLUS their
// department's series as a peer benchmark line ("team median"), so the CEO
// sees both "improving or sliding?" and "vs the rest of the team?".
// =========================================================================

export type TrendGrain = "week" | "month";

export interface TrendPoint {
  periodStart: string; // ISO date (inclusive)
  periodEnd: string; // ISO date (exclusive)
  onTimePct: number | null;
  completed: number;
  avgDwell: number | null; // business minutes
  rework: number;
  slaSample: number; // SLA-decidable intervals — gates trust in onTimePct
  sampleSize: number;
}

export interface EmployeeTrend {
  employeeId: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  weekly: TrendPoint[];
  monthly: TrendPoint[];
  // Department peer benchmark (agents-only rollup), same grains.
  benchWeekly: TrendPoint[];
  benchMonthly: TrendPoint[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SnapRow {
  scope_type: string;
  scope_id: string;
  grain: string;
  period_start: string;
  period_end: string;
  on_time_pct: number | null;
  avg_dwell: number | null;
  completed_count: number;
  rework_count: number;
  sla_n: number;
  sample_size: number;
}

async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`performance-trend query failed: ${error.message}`);
  return (data ?? []) as T[];
}

const toPoint = (r: SnapRow): TrendPoint => ({
  periodStart: r.period_start,
  periodEnd: r.period_end,
  onTimePct: r.on_time_pct,
  completed: r.completed_count ?? 0,
  avgDwell: r.avg_dwell != null ? Math.round(r.avg_dwell) : null,
  rework: r.rework_count ?? 0,
  slaSample: r.sla_n ?? 0,
  sampleSize: r.sample_size ?? 0,
});

async function _getEmployeeTrend(
  orgId: string,
  employeeId: string,
): Promise<EmployeeTrend | null> {
  if (!UUID_RE.test(orgId) || !UUID_RE.test(employeeId)) return null;

  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select(
      "id, full_name, job_title, department_id, department:departments!employee_profiles_department_id_fkey(name)",
    )
    .eq("organization_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return null;

  const deptId = (emp as { department_id: string | null }).department_id;
  const deptRel = (emp as { department: { name: string }[] | { name: string } | null }).department;
  const departmentName = Array.isArray(deptRel) ? (deptRel[0]?.name ?? null) : (deptRel?.name ?? null);

  // Employee series (both grains) + department benchmark (both grains) in one read.
  const rows = await runSql<SnapRow>(`
    select scope_type, scope_id::text, grain, period_start::text, period_end::text,
           on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sample_size
      from performance_snapshots
     where organization_id = '${orgId}'
       and (
         (scope_type = 'employee' and scope_id = '${employeeId}')
         ${deptId ? `or (scope_type = 'department' and scope_id = '${deptId}')` : ""}
       )
     order by period_start
  `);

  const pick = (scope: string, grain: TrendGrain) =>
    rows.filter((r) => r.scope_type === scope && r.grain === grain).map(toPoint);

  return {
    employeeId,
    fullName: (emp as { full_name: string | null }).full_name ?? "—",
    jobTitle: (emp as { job_title: string | null }).job_title ?? null,
    departmentId: deptId,
    departmentName,
    weekly: pick("employee", "week"),
    monthly: pick("employee", "month"),
    benchWeekly: pick("department", "week"),
    benchMonthly: pick("department", "month"),
  };
}

export const getEmployeeTrend = cache(_getEmployeeTrend);
