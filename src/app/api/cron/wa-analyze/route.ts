import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import {
  analyzeClientSatisfaction,
  NoTranscriptError,
  NoRecentActivityError,
} from "@/lib/satisfaction-analyze";

// Daily re-analysis of client satisfaction for clients whose WhatsApp groups
// received new messages. Auth: CRON_SECRET (x-cron-secret header or ?secret=).
// Registered via pg_cron (see supabase/migrations/0143_wa_analyze_cron.sql).

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Look-back window for "new activity" and a per-run cap to bound Gemini cost.
const LOOKBACK_HOURS = 36;
const MAX_PER_RUN = 12;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const provided =
    request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  const orgId = await getDefaultOrgId();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

  // Recently active, mapped clients (newest message time per client).
  const { data: recent, error: recErr } = await supabaseAdmin
    .from("wa_messages")
    .select("client_id, sent_at")
    .eq("organization_id", orgId)
    .not("client_id", "is", null)
    .not("group_kind", "is", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(5000);
  if (recErr) {
    return NextResponse.json({ ok: false, error: recErr.message }, { status: 500 });
  }

  const newestByClient = new Map<string, string>();
  for (const r of (recent ?? []) as Array<{ client_id: string; sent_at: string | null }>) {
    if (!r.sent_at) continue;
    const cur = newestByClient.get(r.client_id);
    if (!cur || r.sent_at > cur) newestByClient.set(r.client_id, r.sent_at);
  }
  if (newestByClient.size === 0) {
    return NextResponse.json({ ok: true, analyzed: 0, note: "no recent activity" });
  }

  // Skip clients already analyzed after their newest message.
  const clientIds = Array.from(newestByClient.keys());
  const { data: analyses } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("client_id, created_at")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .in("client_id", clientIds);
  const lastAnalysis = new Map<string, string>();
  for (const a of (analyses ?? []) as Array<{ client_id: string; created_at: string }>) {
    lastAnalysis.set(a.client_id, a.created_at);
  }

  const due = clientIds.filter((id) => {
    const last = lastAnalysis.get(id);
    return !last || last < (newestByClient.get(id) as string);
  });

  const results: Array<{ clientId: string; ok: boolean; score?: number; error?: string }> = [];
  for (const clientId of due.slice(0, MAX_PER_RUN)) {
    try {
      const { result } = await analyzeClientSatisfaction(orgId, clientId, null);
      results.push({ clientId, ok: true, score: result.satisfactionScore });
    } catch (e) {
      // No transcript at all, or no messages in the current 7-day window → skip.
      if (e instanceof NoTranscriptError || e instanceof NoRecentActivityError) continue;
      results.push({ clientId, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: due.length,
    analyzed: results.filter((r) => r.ok).length,
    capped: due.length > MAX_PER_RUN,
    results,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
