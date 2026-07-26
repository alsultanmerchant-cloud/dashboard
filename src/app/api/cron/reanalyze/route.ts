// Nightly batch re-analysis — runs the same full weekly analysis as the board's
// "إعادة تحليل الأسبوع" button (analyzeClientSatisfaction, window=week) for every
// client with WhatsApp activity in the last 7 days, stalest current analysis
// first. Skips clients already re-analyzed within maxAgeHours so the pg_cron
// job can fire in short repeated slots overnight and converge to full coverage
// without re-burning AI tokens. Auth: CRON_SECRET (x-cron-secret or ?secret=).
// Registered via pg_cron `satisfaction-reanalyze-nightly` (migration 0266).
//
//   ?limit=N          max clients to process this call (default 4)
//   ?offset=N         manual slicing escape hatch (default 0)
//   ?window=week|all  analysis window (default week)
//   ?maxAgeHours=N    skip clients whose current analysis is newer (default 20; 0 disables)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import {
  analyzeClientSatisfaction,
  NoTranscriptError,
  NoRecentActivityError,
} from "@/lib/satisfaction-analyze";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Stop STARTING new clients once this much wall-clock has elapsed, so the run
// finishes cleanly inside maxDuration instead of dying mid-analysis.
const TIME_BUDGET_MS = 240_000;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided =
    request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  const startedAt = Date.now();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "4");
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const window = (request.nextUrl.searchParams.get("window") ?? "week") as "week" | "all";
  const maxAgeHoursRaw = request.nextUrl.searchParams.get("maxAgeHours");
  const maxAgeHours =
    maxAgeHoursRaw !== null && Number.isFinite(Number(maxAgeHoursRaw))
      ? Number(maxAgeHoursRaw)
      : 20;

  const orgId = await getDefaultOrgId();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Eligible list: distinct clients with mapped messages in the last 7 days
  // (weekly window has content). DISTINCT happens in SQL (0268) — a raw row
  // scan through PostgREST silently truncates at max-rows, which shrank the
  // eligible set to whatever clients dominated the capped window (6 of 49
  // after a bulk backfill).
  const { data: recent, error: recentError } = await supabaseAdmin.rpc("get_recent_wa_clients", {
    p_org: orgId,
    p_since: since,
  });
  if (recentError) {
    return NextResponse.json({ ok: false, error: recentError.message }, { status: 500 });
  }
  const ids = ((recent ?? []) as Array<{ client_id: string }>).map((m) => m.client_id).sort();

  // Current analysis per eligible client — drives both the freshness skip and
  // the stalest-first ordering (never-analyzed clients go first).
  const { data: prior } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("client_id, satisfaction_score, model, created_at")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .in("client_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const priorByClient = new Map(
    (
      (prior ?? []) as Array<{
        client_id: string;
        satisfaction_score: number;
        model: string;
        created_at: string;
      }>
    ).map((p) => [p.client_id, p]),
  );

  const freshCutoff = maxAgeHours > 0 ? Date.now() - maxAgeHours * 3_600_000 : null;
  const due = ids
    .filter((id) => {
      if (freshCutoff === null) return true;
      const p = priorByClient.get(id);
      return !p || new Date(p.created_at).getTime() < freshCutoff;
    })
    .sort((a, b) => {
      const ta = priorByClient.get(a)?.created_at ?? "";
      const tb = priorByClient.get(b)?.created_at ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : a < b ? -1 : 1;
    });
  const slice = due.slice(offset, offset + limit);

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, name")
    .in("id", slice.length ? slice : ["00000000-0000-0000-0000-000000000000"]);
  const nameById = new Map(
    ((clients ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );

  const results: Array<Record<string, unknown>> = [];
  let timedOut = false;
  for (const clientId of slice) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }
    const p = priorByClient.get(clientId);
    try {
      const { result } = await analyzeClientSatisfaction(orgId, clientId, null, {
        windowKind: window,
      });
      results.push({
        client: nameById.get(clientId) ?? clientId,
        ok: true,
        before: p?.satisfaction_score ?? null,
        beforeModel: p?.model ?? null,
        after: result.satisfactionScore,
        health: result.bigPicture.accountHealth,
        briefScore: result.briefAdherenceScore,
        recs: result.recommendations?.length ?? 0,
        indicators: result.indicators?.length ?? 0,
      });
    } catch (e) {
      const skip = e instanceof NoTranscriptError || e instanceof NoRecentActivityError;
      results.push({
        client: nameById.get(clientId) ?? clientId,
        ok: false,
        skipped: skip,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    eligibleTotal: ids.length,
    dueTotal: due.length,
    offset,
    limit,
    maxAgeHours,
    processed: results.length,
    timedOut,
    window,
    results,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

// pg_cron invokes via net.http_post — without this export every nightly slot
// dies with 405 (caught by the 2026-07-26 live-fire test of job 38).
export async function POST(request: NextRequest) {
  return handle(request);
}
