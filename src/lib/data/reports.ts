import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// T9 — Reporting + KPIs data loaders
// =========================================================================
// All loaders are server-side, scoped by organization_id, and return
// shapes the /reports page + /dashboard tiles + the weekly-digest edge
// function consume directly.
// =========================================================================

// ---- shared helpers -----------------------------------------------------

function startOfIsoWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  // Postgres date_trunc('week', ...) anchors on Monday (ISO).
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const monOffset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + monOffset);
  return d;
}

function isoWeekParts(date: Date): { year: number; week: number } {
  // Standard ISO week computation.
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

// Exported so tests can pin it.
export const reportsHelpers = { startOfIsoWeekUtc, isoWeekParts };

// ---- 1. v_rework_per_task ------------------------------------------------

export type ReworkRow = {
  organization_id: string;
  task_id: string;
  project_id: string | null;
  rework_comment_count: number;
  last_client_changes_entered_at: string | null;
};

/** Per-task rework counts. Empty rows (count=0) included for completeness. */
export async function getRework(orgId: string): Promise<ReworkRow[]> {
  const { data, error } = await supabaseAdmin
    .from("v_rework_per_task")
    .select("*")
    .eq("organization_id", orgId);
  if (error) {
    console.error("[reports.getRework]", error.message);
    return [];
  }
  return (data ?? []) as ReworkRow[];
}

/** Count of tasks with at least one rework comment in the last 7 days. */
export async function countReworkThisWeek(orgId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("v_rework_per_task")
    .select("task_id")
    .eq("organization_id", orgId)
    .gt("rework_comment_count", 0)
    .gte("last_client_changes_entered_at", cutoff);
  if (error) {
    console.error("[reports.countReworkThisWeek]", error.message);
    return 0;
  }
  return (data ?? []).length;
}

/** Heat-map: total rework comments grouped by service (id + name). */
export async function getReworkHeatmapByService(
  orgId: string,
): Promise<Array<{ service_id: string | null; service_name: string; rework_count: number }>> {
  const rows = await getRework(orgId);
  const taskIds = rows.filter((r) => r.rework_comment_count > 0).map((r) => r.task_id);
  if (taskIds.length === 0) return [];

  const { data: tasks } = await supabaseAdmin
    .from("tasks")
    .select("id, service_id")
    .in("id", taskIds);
  const taskToService = new Map<string, string | null>();
  for (const t of tasks ?? []) taskToService.set(t.id as string, t.service_id as string | null);

  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, name")
    .eq("organization_id", orgId);
  const serviceName = new Map<string, string>();
  for (const s of services ?? []) serviceName.set(s.id as string, s.name as string);

  const buckets = new Map<string, { service_id: string | null; service_name: string; rework_count: number }>();
  for (const r of rows) {
    const sid = taskToService.get(r.task_id) ?? null;
    const key = sid ?? "_unassigned";
    const prev = buckets.get(key) ?? {
      service_id: sid,
      service_name: sid ? (serviceName.get(sid) ?? "—") : "بدون خدمة",
      rework_count: 0,
    };
    prev.rework_count += r.rework_comment_count;
    buckets.set(key, prev);
  }
  return Array.from(buckets.values()).sort((a, b) => b.rework_count - a.rework_count);
}

// ---- 2. v_on_time_delivery -----------------------------------------------

export type OnTimeRow = {
  organization_id: string;
  task_id: string;
  project_id: string | null;
  service_id: string | null;
  deadline_date: string | null;
  done_at: string | null;
  on_time_bool: boolean | null;
};

export async function getOnTimeDelivery(orgId: string): Promise<OnTimeRow[]> {
  const { data, error } = await supabaseAdmin
    .from("v_on_time_delivery")
    .select("*")
    .eq("organization_id", orgId);
  if (error) {
    console.error("[reports.getOnTimeDelivery]", error.message);
    return [];
  }
  return (data ?? []) as OnTimeRow[];
}

/**
 * On-time % over the last `windowDays` days (using done_at). Counts only
 * rows where on_time_bool is non-null. Returns null when sample is empty.
 */
export async function getOnTimePct(
  orgId: string,
  windowDays = 30,
): Promise<{ pct: number | null; sample: number; onTime: number }> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("v_on_time_delivery")
    .select("on_time_bool, done_at")
    .eq("organization_id", orgId)
    .gte("done_at", cutoff)
    .not("on_time_bool", "is", null);
  if (error) {
    console.error("[reports.getOnTimePct]", error.message);
    return { pct: null, sample: 0, onTime: 0 };
  }
  const rows = data ?? [];
  if (rows.length === 0) return { pct: null, sample: 0, onTime: 0 };
  const onTime = rows.filter((r) => r.on_time_bool === true).length;
  return { pct: Math.round((onTime / rows.length) * 100), sample: rows.length, onTime };
}

// ---- 3. v_agent_productivity --------------------------------------------

export type AgentProductivityRow = {
  organization_id: string;
  user_id: string;
  week_start_date: string;
  closed_count: number;
  median_minutes_per_stage_jsonb: Record<string, number>;
};

export async function getAgentProductivity(
  orgId: string,
  weeks = 8,
): Promise<AgentProductivityRow[]> {
  const cutoff = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("v_agent_productivity")
    .select("*")
    .eq("organization_id", orgId)
    .gte("week_start_date", cutoff);
  if (error) {
    console.error("[reports.getAgentProductivity]", error.message);
    return [];
  }
  return (data ?? []) as AgentProductivityRow[];
}

/** Closed tasks across the most recent ISO week (UTC-anchored). */
export async function countClosedThisWeek(orgId: string): Promise<number> {
  const start = startOfIsoWeekUtc(new Date());
  const startIso = start.toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("v_agent_productivity")
    .select("closed_count")
    .eq("organization_id", orgId)
    .eq("week_start_date", startIso);
  if (error) {
    console.error("[reports.countClosedThisWeek]", error.message);
    return 0;
  }
  return (data ?? []).reduce((s, r) => s + (r.closed_count ?? 0), 0);
}

/**
 * Agent leaderboard for the last `weeks` weeks. Includes a simple
 * "utilization %" approximation = closed_count / max(closed_count) * 100.
 * (True utilization needs hours-tracked, which we don't capture; this is
 * a relative ranker, not an absolute capacity number — labelled as such
 * in the UI.)
 */
export async function getAgentLeaderboard(
  orgId: string,
  weeks = 4,
): Promise<Array<{ user_id: string; full_name: string; closed_count: number; utilization_pct: number }>> {
  const rows = await getAgentProductivity(orgId, weeks);
  const byUser = new Map<string, number>();
  for (const r of rows) {
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.closed_count);
  }
  if (byUser.size === 0) return [];
  const userIds = Array.from(byUser.keys());
  const { data: profiles } = await supabaseAdmin
    .from("employee_profiles")
    .select("user_id, full_name")
    .in("user_id", userIds);
  const nameByUser = new Map<string, string>();
  for (const p of profiles ?? []) {
    if (p.user_id) nameByUser.set(p.user_id as string, (p.full_name as string) ?? "—");
  }
  const max = Math.max(1, ...byUser.values());
  return Array.from(byUser.entries())
    .map(([user_id, closed_count]) => ({
      user_id,
      full_name: nameByUser.get(user_id) ?? "—",
      closed_count,
      utilization_pct: Math.round((closed_count / max) * 100),
    }))
    .sort((a, b) => b.closed_count - a.closed_count);
}

// ---- 4. v_review_backlog -------------------------------------------------

export type ReviewBacklogRow = {
  organization_id: string;
  task_id: string;
  project_id: string | null;
  service_id: string | null;
  stage: string;
  stage_entered_at: string;
  business_minutes_in_stage: number;
};

export async function getReviewBacklog(orgId: string): Promise<ReviewBacklogRow[]> {
  const { data, error } = await supabaseAdmin
    .from("v_review_backlog")
    .select("*")
    .eq("organization_id", orgId)
    .order("business_minutes_in_stage", { ascending: false });
  if (error) {
    console.error("[reports.getReviewBacklog]", error.message);
    return [];
  }
  return (data ?? []) as ReviewBacklogRow[];
}

export async function countReviewBacklog(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("v_review_backlog")
    .select("task_id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) {
    console.error("[reports.countReviewBacklog]", error.message);
    return 0;
  }
  return count ?? 0;
}

// ---- Per-department SLA compliance --------------------------------------
// Re-uses sla_rules + tasks current stage + business_minutes_between to
// compute "share of OPEN tasks within SLA" per department.
export async function getDepartmentSlaCompliance(orgId: string): Promise<
  Array<{ department_id: string | null; department_name: string; total: number; within_sla: number; pct: number | null }>
> {
  const { data: tasks } = await supabaseAdmin
    .from("tasks")
    .select("id, stage, stage_entered_at, sla_override_minutes, project_id, projects:project_id(department_id, departments:department_id(id, name))")
    .eq("organization_id", orgId)
    .neq("stage", "done");
  const { data: sla } = await supabaseAdmin
    .from("sla_rules")
    .select("stage_key, max_minutes")
    .eq("organization_id", orgId);
  const slaByStage = new Map<string, number>();
  for (const r of sla ?? []) slaByStage.set(r.stage_key as string, r.max_minutes as number);

  const buckets = new Map<string, { department_id: string | null; department_name: string; total: number; within_sla: number }>();
  const now = Date.now();
  for (const t of (tasks ?? []) as Array<{
    id: string; stage: string; stage_entered_at: string; sla_override_minutes: number | null;
    projects: { departments: { id: string | null; name: string | null } | null } | null;
  }>) {
    const dept = t.projects?.departments ?? null;
    const key = dept?.id ?? "_none";
    const name = dept?.name ?? "بدون قسم";
    const max = t.sla_override_minutes ?? slaByStage.get(t.stage);
    if (!max) continue; // no SLA rule for this stage → skip
    const elapsedMin = Math.floor((now - new Date(t.stage_entered_at).getTime()) / 60_000);
    const prev = buckets.get(key) ?? { department_id: dept?.id ?? null, department_name: name, total: 0, within_sla: 0 };
    prev.total += 1;
    if (elapsedMin <= max) prev.within_sla += 1;
    buckets.set(key, prev);
  }
  return Array.from(buckets.values())
    .map((b) => ({ ...b, pct: b.total === 0 ? null : Math.round((b.within_sla / b.total) * 100) }))
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
}

// ---- Renewal forecast next 90 days --------------------------------------
export async function getRenewalForecast90d(orgId: string): Promise<
  Array<{ project_id: string; project_name: string; client_name: string; next_renewal_date: string; days_until: number }>
> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, next_renewal_date, clients:client_id(name)")
    .eq("organization_id", orgId)
    .gte("next_renewal_date", todayIso)
    .lte("next_renewal_date", horizon)
    .order("next_renewal_date", { ascending: true });
  if (error) {
    console.error("[reports.getRenewalForecast90d]", error.message);
    return [];
  }
  return (data ?? []).map((p) => {
    const next = p.next_renewal_date as string;
    const days = Math.round(
      (new Date(`${next}T00:00:00.000Z`).getTime() -
        new Date(`${todayIso}T00:00:00.000Z`).getTime()) /
        86_400_000,
    );
    const client = Array.isArray(p.clients) ? p.clients[0] : p.clients;
    return {
      project_id: p.id as string,
      project_name: (p.name as string) ?? "—",
      client_name: (client?.name as string) ?? "—",
      next_renewal_date: next,
      days_until: days,
    };
  });
}

// ---- CEO weekly digest composer -----------------------------------------

export type WeeklyDigestPayload = {
  organization_id: string;
  iso_year: number;
  iso_week: number;
  generated_at: string;
  week_start_date: string; // ISO date Monday-anchored UTC
  rework: { total_tasks: number; total_comments: number; top_services: Array<{ service_name: string; rework_count: number }> };
  on_time: { pct: number | null; sample: number; window_days: number };
  productivity: { closed_this_week: number; top_agents: Array<{ user_id: string; full_name: string; closed_count: number }> };
  review_backlog: { count: number; oldest_minutes: number | null };
  renewals_next_90d: { count: number; nearest: { project_name: string; client_name: string; next_renewal_date: string } | null };
  sla_by_department: Array<{ department_name: string; pct: number | null; total: number }>;
};

/**
 * Composes the JSON the CEO weekly digest renders. Pure data — no
 * email/HTML rendering here. The /reports "Weekly digest" section and
 * the weekly-digest edge function both consume this.
 */
export async function getCEOWeeklyDigest(orgId: string): Promise<WeeklyDigestPayload> {
  const now = new Date();
  const { year, week } = isoWeekParts(now);
  const weekStart = startOfIsoWeekUtc(now);

  const [rework, heatmap, onTime, leaderboard, closed, backlog, renewals, sla] = await Promise.all([
    getRework(orgId),
    getReworkHeatmapByService(orgId),
    getOnTimePct(orgId, 30),
    getAgentLeaderboard(orgId, 4),
    countClosedThisWeek(orgId),
    getReviewBacklog(orgId),
    getRenewalForecast90d(orgId),
    getDepartmentSlaCompliance(orgId),
  ]);

  const totalReworkComments = rework.reduce((s, r) => s + r.rework_comment_count, 0);
  const tasksWithRework = rework.filter((r) => r.rework_comment_count > 0).length;
  const oldest = backlog[0]?.business_minutes_in_stage ?? null;

  return {
    organization_id: orgId,
    iso_year: year,
    iso_week: week,
    generated_at: now.toISOString(),
    week_start_date: weekStart.toISOString().slice(0, 10),
    rework: {
      total_tasks: tasksWithRework,
      total_comments: totalReworkComments,
      top_services: heatmap.slice(0, 5).map((s) => ({ service_name: s.service_name, rework_count: s.rework_count })),
    },
    on_time: { pct: onTime.pct, sample: onTime.sample, window_days: 30 },
    productivity: {
      closed_this_week: closed,
      top_agents: leaderboard.slice(0, 5).map((a) => ({ user_id: a.user_id, full_name: a.full_name, closed_count: a.closed_count })),
    },
    review_backlog: { count: backlog.length, oldest_minutes: oldest },
    renewals_next_90d: {
      count: renewals.length,
      nearest: renewals.length === 0 ? null : {
        project_name: renewals[0].project_name,
        client_name: renewals[0].client_name,
        next_renewal_date: renewals[0].next_renewal_date,
      },
    },
    sla_by_department: sla.map((d) => ({ department_name: d.department_name, pct: d.pct, total: d.total })),
  };
}

/** Latest stored digest for an org, or null if none yet. */
export async function getLatestStoredDigest(orgId: string): Promise<{
  payload: WeeklyDigestPayload;
  generated_at: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("weekly_digest_runs")
    .select("payload, generated_at")
    .eq("organization_id", orgId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[reports.getLatestStoredDigest]", error.message);
    return null;
  }
  if (!data) return null;
  return {
    payload: data.payload as unknown as WeeklyDigestPayload,
    generated_at: data.generated_at as string,
  };
}
