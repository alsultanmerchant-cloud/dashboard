import { NextRequest, NextResponse } from "next/server";
import { syncContractsFromGoogleSheet } from "@/lib/import/google-sheets-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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
  if (!orgOverride) {
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", "rawasm-demo")
      .single();
    if (error || !org) return NextResponse.json({ error: "org not found" }, { status: 500 });
    orgId = org.id;
  } else {
    orgId = orgOverride;
  }

  try {
    const result = await syncContractsFromGoogleSheet({
      orgId,
      actorUserId: null,
      auditAction: "contracts.sync_google_sheet_cron",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
