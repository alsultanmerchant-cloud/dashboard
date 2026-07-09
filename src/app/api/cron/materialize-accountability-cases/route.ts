import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { materializeAccountabilityCases } from "@/lib/data/accountability-cases-store";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Daily materialization of the accountability case feed into the persistence
// table (first-seen, repeat counter, auto-resolve of no-longer-detected cases).
// The page also self-syncs once per Riyadh day, so this cron is a reliability
// backstop that keeps history accurate even on days nobody opens the page.
//   ?org=<uuid>  target a specific org (default: slug 'rawasm-demo')
// Auth mirrors the other crons (CRON_SECRET).
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "not configured" }, { status: 500 });
  const provided =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
    orgId = (org as { id: string }).id;
  }

  try {
    const meta = await materializeAccountabilityCases(orgId);
    return NextResponse.json({ ok: true, cases: Object.keys(meta).length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}
