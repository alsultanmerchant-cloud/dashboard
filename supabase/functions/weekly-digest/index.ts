// Phase T9 — Weekly Digest edge function.
//
// Cron: 0 4 * * 0  (Sunday 04:00 UTC = 07:00 Asia/Riyadh).
// Owner decision (2026-05-04): Notification delivery is Option A —
// IN-APP ONLY. This function does NOT call any external messaging
// transport. It (1) composes the digest JSON, (2) upserts a
// weekly_digest_runs row keyed on (org, iso_year, iso_week) for
// idempotency + payload caching, (3) creates a `notifications` row
// of type WEEKLY_DIGEST_READY for every owner/CEO/admin recipient,
// and (4) writes a single ai_event(WEEKLY_DIGEST_READY) per org.
//
// Mirror style of supabase/functions/governance-watcher/index.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---- ISO week helpers (kept inline; deno edge fns don't share TS) ------

function startOfIsoWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const dow = d.getUTCDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + monOffset);
  return d;
}

function isoWeekParts(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return { year: d.getUTCFullYear(), week };
}

// ---- digest composition (mirrors src/lib/data/reports.ts) ---------------
// Self-contained: edge fn cannot import from src/. We re-implement the
// SQL/select calls and JSON composition. If the TS loader changes
// shape, update both. The tests/reporting-views.test.mjs covers the
// JSON contract on both sides.

type ReworkRow = {
  organization_id: string;
  task_id: string;
  rework_comment_count: number;
  last_client_changes_entered_at: string | null;
};
type OnTimeRow = { on_time_bool: boolean | null; done_at: string | null };
type ProductivityRow = { user_id: string; week_start_date: string; closed_count: number };
type BacklogRow = { task_id: string; business_minutes_in_stage: number };

async function composeDigest(orgId: string) {
  const now = new Date();
  const { year, week } = isoWeekParts(now);
  const weekStart = startOfIsoWeekUtc(now);
  const cutoff30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const horizon90 = new Date(now.getTime() + 90 * 86_400_000)
    .toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);

  // rework
  const { data: reworkRaw } = await supabase
    .from("v_rework_per_task")
    .select("task_id, rework_comment_count, last_client_changes_entered_at")
    .eq("organization_id", orgId);
  const rework = (reworkRaw ?? []) as ReworkRow[];
  const totalReworkComments = rework.reduce(
    (s, r) => s + (r.rework_comment_count ?? 0),
    0,
  );
  const tasksWithRework = rework.filter(
    (r) => (r.rework_comment_count ?? 0) > 0,
  ).length;

  // rework heat-map by service
  const reworkTaskIds = rework
    .filter((r) => r.rework_comment_count > 0)
    .map((r) => r.task_id);
  const tasksMeta = reworkTaskIds.length === 0
    ? []
    : ((await supabase.from("tasks").select("id, service_id").in("id", reworkTaskIds)).data ?? []);
  const taskToService = new Map<string, string | null>();
  for (const t of tasksMeta) taskToService.set(t.id as string, t.service_id as string | null);
  const { data: services } = await supabase
    .from("services").select("id, name").eq("organization_id", orgId);
  const sName = new Map<string, string>();
  for (const s of services ?? []) sName.set(s.id as string, s.name as string);
  const heatBuckets = new Map<string, { service_name: string; rework_count: number }>();
  for (const r of rework) {
    const sid = taskToService.get(r.task_id) ?? null;
    const key = sid ?? "_none";
    const prev = heatBuckets.get(key) ?? {
      service_name: sid ? (sName.get(sid) ?? "—") : "بدون خدمة",
      rework_count: 0,
    };
    prev.rework_count += r.rework_comment_count;
    heatBuckets.set(key, prev);
  }
  const topServices = Array.from(heatBuckets.values())
    .sort((a, b) => b.rework_count - a.rework_count).slice(0, 5);

  // on-time
  const { data: ot } = await supabase
    .from("v_on_time_delivery")
    .select("on_time_bool, done_at")
    .eq("organization_id", orgId)
    .gte("done_at", cutoff30)
    .not("on_time_bool", "is", null);
  const otRows = (ot ?? []) as OnTimeRow[];
  const otSample = otRows.length;
  const onTimePct = otSample === 0
    ? null
    : Math.round((otRows.filter((r) => r.on_time_bool === true).length / otSample) * 100);

  // productivity (this week)
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const { data: prod4w } = await supabase
    .from("v_agent_productivity")
    .select("user_id, week_start_date, closed_count")
    .eq("organization_id", orgId)
    .gte("week_start_date", new Date(now.getTime() - 4 * 7 * 86_400_000).toISOString().slice(0, 10));
  const prodRows = (prod4w ?? []) as ProductivityRow[];
  const closedThisWeek = prodRows
    .filter((r) => r.week_start_date === weekStartIso)
    .reduce((s, r) => s + (r.closed_count ?? 0), 0);
  const byUser = new Map<string, number>();
  for (const r of prodRows) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.closed_count);
  const userIds = Array.from(byUser.keys());
  const profiles = userIds.length === 0
    ? []
    : ((await supabase.from("employee_profiles").select("user_id, full_name").in("user_id", userIds)).data ?? []);
  const nameByUser = new Map<string, string>();
  for (const p of profiles) {
    if (p.user_id) nameByUser.set(p.user_id as string, (p.full_name as string) ?? "—");
  }
  const topAgents = Array.from(byUser.entries())
    .map(([user_id, closed_count]) => ({
      user_id,
      full_name: nameByUser.get(user_id) ?? "—",
      closed_count,
    }))
    .sort((a, b) => b.closed_count - a.closed_count)
    .slice(0, 5);

  // review backlog
  const { data: backlog } = await supabase
    .from("v_review_backlog")
    .select("task_id, business_minutes_in_stage")
    .eq("organization_id", orgId)
    .order("business_minutes_in_stage", { ascending: false });
  const backlogRows = (backlog ?? []) as BacklogRow[];

  // renewals next 90d
  const { data: renewals } = await supabase
    .from("projects")
    .select("id, name, next_renewal_date, clients:client_id(name)")
    .eq("organization_id", orgId)
    .gte("next_renewal_date", todayIso)
    .lte("next_renewal_date", horizon90)
    .order("next_renewal_date", { ascending: true });

  // sla by department (open tasks share within sla)
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("id, stage, stage_entered_at, sla_override_minutes, projects:project_id(department_id, departments:department_id(id, name))")
    .eq("organization_id", orgId)
    .neq("stage", "done");
  const { data: slaRules } = await supabase
    .from("sla_rules").select("stage_key, max_minutes").eq("organization_id", orgId);
  const slaByStage = new Map<string, number>();
  for (const r of slaRules ?? []) slaByStage.set(r.stage_key as string, r.max_minutes as number);
  const deptBuckets = new Map<string, { department_name: string; total: number; within_sla: number }>();
  const nowMs = now.getTime();
  for (const t of (openTasks ?? []) as Array<{
    id: string; stage: string; stage_entered_at: string; sla_override_minutes: number | null;
    projects: { departments: { id: string | null; name: string | null } | null } | null;
  }>) {
    const dept = t.projects?.departments ?? null;
    const key = dept?.id ?? "_none";
    const max = t.sla_override_minutes ?? slaByStage.get(t.stage);
    if (!max) continue;
    const elapsedMin = Math.floor((nowMs - new Date(t.stage_entered_at).getTime()) / 60_000);
    const prev = deptBuckets.get(key) ?? {
      department_name: dept?.name ?? "بدون قسم",
      total: 0, within_sla: 0,
    };
    prev.total += 1;
    if (elapsedMin <= max) prev.within_sla += 1;
    deptBuckets.set(key, prev);
  }
  const slaSummary = Array.from(deptBuckets.values()).map((d) => ({
    department_name: d.department_name,
    total: d.total,
    pct: d.total === 0 ? null : Math.round((d.within_sla / d.total) * 100),
  }));

  const nearest = (renewals ?? [])[0] as
    | { name: string; next_renewal_date: string; clients: { name: string } | { name: string }[] | null }
    | undefined;
  const nearestClient = nearest
    ? (Array.isArray(nearest.clients) ? nearest.clients[0] : nearest.clients)
    : null;

  return {
    payload: {
      organization_id: orgId,
      iso_year: year,
      iso_week: week,
      generated_at: now.toISOString(),
      week_start_date: weekStartIso,
      rework: {
        total_tasks: tasksWithRework,
        total_comments: totalReworkComments,
        top_services: topServices,
      },
      on_time: { pct: onTimePct, sample: otSample, window_days: 30 },
      productivity: { closed_this_week: closedThisWeek, top_agents: topAgents },
      review_backlog: {
        count: backlogRows.length,
        oldest_minutes: backlogRows[0]?.business_minutes_in_stage ?? null,
      },
      renewals_next_90d: {
        count: (renewals ?? []).length,
        nearest: nearest
          ? {
            project_name: nearest.name ?? "—",
            client_name: nearestClient?.name ?? "—",
            next_renewal_date: nearest.next_renewal_date,
          }
          : null,
      },
      sla_by_department: slaSummary,
    },
    isoYear: year,
    isoWeek: week,
  };
}

// ---- recipients ---------------------------------------------------------
// Owner / admin / manager (head) get the digest. We resolve via
// user_roles + roles.key.
async function listDigestRecipients(orgId: string): Promise<string[]> {
  const { data: roles } = await supabase
    .from("roles")
    .select("id, key")
    .in("key", ["owner", "admin", "manager"]);
  const roleIds = (roles ?? []).map((r) => r.id as string);
  if (roleIds.length === 0) return [];
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("organization_id", orgId)
    .in("role_id", roleIds);
  return Array.from(new Set((userRoles ?? []).map((r) => r.user_id as string).filter(Boolean)));
}

async function processOrg(orgId: string) {
  const { payload, isoYear, isoWeek } = await composeDigest(orgId);

  // Idempotency: skip if already generated for this (org, iso_week).
  const { data: existing } = await supabase
    .from("weekly_digest_runs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("iso_year", isoYear)
    .eq("iso_week", isoWeek)
    .maybeSingle();
  if (existing) {
    return { orgId, skipped: true, reason: "already_generated" };
  }

  const recipients = await listDigestRecipients(orgId);

  // Insert run row first so the unique key is taken before notifications.
  const { error: runErr } = await supabase.from("weekly_digest_runs").insert({
    organization_id: orgId,
    iso_year: isoYear,
    iso_week: isoWeek,
    recipient_count: recipients.length,
    payload,
  });
  if (runErr) {
    console.error("[weekly-digest] run insert failed", orgId, runErr.message);
    return { orgId, error: runErr.message };
  }

  // In-app notifications (Option A).
  const title = `تقرير الأسبوع ${isoWeek} جاهز`;
  const body = "افتح صفحة التقارير لقراءة الموجز التنفيذي للأسبوع.";
  let notifCount = 0;
  for (const userId of recipients) {
    const { error: nErr } = await supabase.from("notifications").insert({
      organization_id: orgId,
      recipient_user_id: userId,
      type: "WEEKLY_DIGEST_READY",
      title,
      body,
      entity_type: "weekly_digest_runs",
      entity_id: null,
    });
    if (nErr) {
      console.error("[weekly-digest] notif insert failed", orgId, userId, nErr.message);
    } else {
      notifCount += 1;
    }
  }

  // Single ai_event per org.
  await supabase.from("ai_events").insert({
    organization_id: orgId,
    event_type: "WEEKLY_DIGEST_READY",
    entity_type: "weekly_digest_runs",
    entity_id: null,
    payload: { iso_year: isoYear, iso_week: isoWeek, recipients: recipients.length },
    importance: "normal",
  });

  return {
    orgId,
    iso_year: isoYear,
    iso_week: isoWeek,
    recipient_count: recipients.length,
    notif_count: notifCount,
  };
}

async function run() {
  const { data: orgs, error } = await supabase
    .from("organizations").select("id");
  if (error) throw error;

  const results = [];
  for (const org of orgs ?? []) {
    try {
      results.push(await processOrg(org.id as string));
    } catch (e) {
      console.error("[weekly-digest] org failed", org.id, (e as Error).message);
      results.push({ orgId: org.id, error: (e as Error).message });
    }
  }
  return { orgs: results };
}

Deno.serve(async () => {
  try {
    const result = await run();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
