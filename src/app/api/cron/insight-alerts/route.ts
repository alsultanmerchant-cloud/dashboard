import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateInsightAlerts } from "@/lib/notifications/insight-alerts";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// =========================================================================
// Daily analysis → notifications. Turns computed signals (client-satisfaction
// risk, contracts/collection, AI critical priorities) into owner/admin
// notifications. Deduped on unread (type, entity_id). Mirrors ceo-brief auth.
//   ?dry=1        compute the summary, insert nothing
//   ?org=<uuid>   target a specific org (default: slug 'rawasm-demo')
// =========================================================================

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "not configured" }, { status: 500 });
  const provided =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const orgOverride = request.nextUrl.searchParams.get("org");

  let orgId: string;
  if (orgOverride) {
    orgId = orgOverride;
  } else {
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", "rawasm-demo")
      .single();
    if (error || !org) return NextResponse.json({ error: "org not found" }, { status: 500 });
    orgId = org.id;
  }

  const summary = await generateInsightAlerts(orgId, { dryRun: dry });

  await supabaseAdmin.from("ai_events").insert({
    organization_id: orgId,
    event_type: "NOTIFICATION_CREATED",
    entity_type: "insight_alerts",
    entity_id: orgId,
    payload: { kind: "insight_alerts_cron", ...summary },
    importance: summary.created > 0 ? "normal" : "low",
  });

  return NextResponse.json({ ok: true, ...summary });
}
