// TEMPORARY batch re-analysis route — forces fresh client-satisfaction analyses
// through analyzeClientSatisfaction(), bypassing the daily cron's dedup, so the
// board reflects the current satisfaction model + corrected structure.
// Auth: CRON_SECRET. DELETE after.
//
//   ?limit=N   how many clients to process this call (default 3)
//   ?offset=N  slice start into the deterministic eligible list (default 0)
//   ?window=week|all   analysis window (default week)
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

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided =
    request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "3");
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const window = (request.nextUrl.searchParams.get("window") ?? "week") as "week" | "all";

  const orgId = await getDefaultOrgId();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Deterministic eligible list: distinct clients with mapped messages in the
  // last 7 days (weekly window has content), ordered by client_id for stable
  // slicing across calls.
  const { data: msgs } = await supabaseAdmin
    .from("wa_messages")
    .select("client_id")
    .eq("organization_id", orgId)
    .not("client_id", "is", null)
    .not("group_kind", "is", null)
    .gte("sent_at", since)
    .limit(20000);
  const ids = Array.from(
    new Set(((msgs ?? []) as Array<{ client_id: string }>).map((m) => m.client_id)),
  ).sort();
  const slice = ids.slice(offset, offset + limit);

  // Prior current score per client (for before/after reporting).
  const { data: prior } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("client_id, satisfaction_score, model")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .in("client_id", slice.length ? slice : ["00000000-0000-0000-0000-000000000000"]);
  const priorByClient = new Map(
    ((prior ?? []) as Array<{ client_id: string; satisfaction_score: number; model: string }>).map(
      (p) => [p.client_id, p],
    ),
  );

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, name")
    .in("id", slice.length ? slice : ["00000000-0000-0000-0000-000000000000"]);
  const nameById = new Map(
    ((clients ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );

  const results: Array<Record<string, unknown>> = [];
  for (const clientId of slice) {
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
    offset,
    limit,
    processed: slice.length,
    window,
    results,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}
