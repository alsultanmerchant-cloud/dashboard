import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Activity / audit reader (CEO "نبض الفريق" board). Reads the nightly
// employee_activity_daily rollup (0148) for the latest computed date.
// Honest N/A: activity_pct may be null ("not instrumented / no owned duties").
// =========================================================================

export type ActivityStatus = "active" | "at_risk" | "idle" | "not_instrumented";

export interface ActivityRow {
  employeeId: string;
  fullName: string;
  jobTitle: string | null;
  ownedEpisodes: number;
  answeredEpisodes: number;
  staleOpen: number;
  responsiveness: number | null;
  throughput: number | null;
  freshness: number | null;
  activityPct: number | null;
  confidence: "high" | "low";
  status: ActivityStatus;
}

export interface TeamActivityOverview {
  activityDate: string | null;
  cutoverDate: string | null;
  windowWorkingDays: number;
  median: number | null;
  counts: { active: number; atRisk: number; idle: number; notInstrumented: number };
  rows: ActivityRow[];
  /** Active employees with no owned episodes in the window (assignment gap, not idle). */
  noDutyCount: number;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

async function _getTeamActivityOverview(orgId: string): Promise<TeamActivityOverview> {
  const [{ data: cfg }, { data: latest }, { count: activeEmployees }] = await Promise.all([
    supabaseAdmin
      .from("activity_config")
      .select("instrumentation_cutover_date, window_working_days")
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabaseAdmin
      .from("employee_activity_daily")
      .select("activity_date")
      .eq("organization_id", orgId)
      .order("activity_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("employee_profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("employment_status", "active"),
  ]);

  const activityDate = latest?.activity_date ?? null;
  const base: TeamActivityOverview = {
    activityDate,
    cutoverDate: cfg?.instrumentation_cutover_date ?? null,
    windowWorkingDays: cfg?.window_working_days ?? 7,
    median: null,
    counts: { active: 0, atRisk: 0, idle: 0, notInstrumented: 0 },
    rows: [],
    noDutyCount: 0,
  };
  if (!activityDate) return base;

  const { data, error } = await supabaseAdmin
    .from("employee_activity_daily")
    .select(
      "employee_id, owned_episodes, answered_episodes, stale_open, responsiveness, throughput, freshness, activity_pct, confidence, status, employee:employee_profiles!employee_activity_daily_employee_id_fkey(full_name, job_title)",
    )
    .eq("organization_id", orgId)
    .eq("activity_date", activityDate);
  if (error) throw error;

  const rows: ActivityRow[] = (data ?? []).map((r) => {
    const emp = Array.isArray(r.employee) ? r.employee[0] : r.employee;
    return {
      employeeId: r.employee_id,
      fullName: emp?.full_name ?? "—",
      jobTitle: emp?.job_title ?? null,
      ownedEpisodes: r.owned_episodes ?? 0,
      answeredEpisodes: r.answered_episodes ?? 0,
      staleOpen: r.stale_open ?? 0,
      responsiveness: r.responsiveness,
      throughput: r.throughput,
      freshness: r.freshness,
      activityPct: r.activity_pct,
      confidence: (r.confidence as "high" | "low") ?? "high",
      status: (r.status as ActivityStatus) ?? "not_instrumented",
    };
  });

  rows.sort((a, b) => {
    // Idle-with-duty floats to the top, then ascending activity (worst first).
    if (a.status === "idle" && b.status !== "idle") return -1;
    if (b.status === "idle" && a.status !== "idle") return 1;
    return (a.activityPct ?? 999) - (b.activityPct ?? 999);
  });

  const counts = { active: 0, atRisk: 0, idle: 0, notInstrumented: 0 };
  for (const r of rows) {
    if (r.status === "active") counts.active += 1;
    else if (r.status === "at_risk") counts.atRisk += 1;
    else if (r.status === "idle") counts.idle += 1;
    else counts.notInstrumented += 1;
  }

  return {
    ...base,
    median: median(rows.map((r) => r.activityPct).filter((v): v is number => v != null)),
    counts,
    rows,
    noDutyCount: Math.max(0, (activeEmployees ?? 0) - rows.length),
  };
}

export const getTeamActivityOverview = cache(_getTeamActivityOverview);

// ---- Per-employee episode timeline (drill-down) --------------------------

export interface EpisodeRow {
  id: string;
  stage: string;
  ownerRole: string | null;
  openedAt: string;
  answeredAt: string | null;
  answeredKind: string | null;
  responseMinutes: number | null;
  slaMinutes: number | null;
  withinSla: boolean | null;
  closedAt: string | null;
}

async function _getEmployeeEpisodes(orgId: string, employeeId: string): Promise<EpisodeRow[]> {
  const { data, error } = await supabaseAdmin
    .from("ownership_episodes")
    .select("id, stage, owner_role, opened_at, answered_at, answered_kind, response_minutes, sla_minutes, within_sla, closed_at")
    .eq("organization_id", orgId)
    .eq("owner_employee_id", employeeId)
    .eq("external_origin", false)
    .order("opened_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id,
    stage: e.stage,
    ownerRole: e.owner_role,
    openedAt: e.opened_at,
    answeredAt: e.answered_at,
    answeredKind: e.answered_kind,
    responseMinutes: e.response_minutes,
    slaMinutes: e.sla_minutes,
    withinSla: e.within_sla,
    closedAt: e.closed_at,
  }));
}

export const getEmployeeEpisodes = cache(_getEmployeeEpisodes);
