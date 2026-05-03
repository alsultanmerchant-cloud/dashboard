// Phase T7 — Renewal scheduler.
//
// Cron daily at 06:00 Asia/Riyadh (= 03:00 UTC). For every project where
// next_renewal_date is within 14 days of "today" AND there is no active
// renewal_cycles row whose period covers that upcoming date, fire a
// notification + ai_event so the AM sees it on /notifications and the
// dashboard renewals tile is reinforced.
//
// We deliberately do NOT auto-create the renewal_cycles row here — owner
// confirmed (DECISIONS_LOG row 1) that starting a cycle is an explicit
// human act. The scheduler only nudges.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  next_renewal_date: string;
  account_manager_employee_id: string | null;
};

type CycleRow = { project_id: string; started_at: string; ended_at: string | null; status: string };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure helper, exported for tests. Returns true when this project should
 * receive a RENEWAL_DUE_SOON nudge today.
 */
export function shouldNudge(args: {
  today: string;
  nextRenewalDate: string;
  cycles: { started_at: string; ended_at: string | null; status: string }[];
}): boolean {
  const days =
    (new Date(`${args.nextRenewalDate}T00:00:00.000Z`).getTime() -
      new Date(`${args.today}T00:00:00.000Z`).getTime()) /
    86_400_000;
  if (days < 0 || days > 14) return false;

  // Suppress when an active cycle already covers the upcoming date.
  for (const c of args.cycles) {
    if (c.status !== "active") continue;
    if (c.started_at > args.nextRenewalDate) continue;
    if (c.ended_at && c.ended_at < args.nextRenewalDate) continue;
    return false;
  }
  return true;
}

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = todayIso();
  const horizon = plusDays(today, 14);

  const { data: projects, error: pErr } = await sb
    .from("projects")
    .select("id, organization_id, name, next_renewal_date, account_manager_employee_id")
    .gte("next_renewal_date", today)
    .lte("next_renewal_date", horizon);

  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  }
  if (!projects?.length) {
    return new Response(JSON.stringify({ processed: 0, nudged: 0 }), { status: 200 });
  }

  const projectIds = (projects as ProjectRow[]).map((p) => p.id);
  const { data: cycles } = await sb
    .from("renewal_cycles")
    .select("project_id, started_at, ended_at, status")
    .in("project_id", projectIds);
  const byProject = new Map<string, CycleRow[]>();
  for (const c of (cycles ?? []) as CycleRow[]) {
    const arr = byProject.get(c.project_id) ?? [];
    arr.push(c);
    byProject.set(c.project_id, arr);
  }

  let nudged = 0;
  for (const p of projects as ProjectRow[]) {
    const cyc = byProject.get(p.id) ?? [];
    if (!shouldNudge({ today, nextRenewalDate: p.next_renewal_date, cycles: cyc })) continue;

    // Idempotency: skip if we already nudged for this project today.
    const since = `${today}T00:00:00.000Z`;
    const { data: existing } = await sb
      .from("notifications")
      .select("id")
      .eq("organization_id", p.organization_id)
      .eq("type", "RENEWAL_DUE_SOON")
      .eq("entity_id", p.id)
      .gte("created_at", since)
      .limit(1);
    if (existing?.length) continue;

    if (p.account_manager_employee_id) {
      await sb.from("notifications").insert({
        organization_id: p.organization_id,
        recipient_employee_id: p.account_manager_employee_id,
        type: "RENEWAL_DUE_SOON",
        title: `تجديد قريب: ${p.name}`,
        body: `موعد التجديد ${p.next_renewal_date}.`,
        entity_type: "project",
        entity_id: p.id,
      });
    }
    await sb.from("ai_events").insert({
      organization_id: p.organization_id,
      event_type: "RENEWAL_DUE_SOON",
      entity_type: "project",
      entity_id: p.id,
      payload: { next_renewal_date: p.next_renewal_date, project_name: p.name },
      importance: "high",
    });
    nudged += 1;
  }

  return new Response(JSON.stringify({ processed: projects.length, nudged }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
