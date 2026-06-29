import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveStageOwnersForOrg } from "@/lib/tasks/resolve-stage-owners";

// Re-derive tasks.stage_owner_positions from the team's /task-templates so
// accountability stays template-accurate as new tasks sync in from Odoo.
// Triggered by Supabase pg_cron via pg_net.http_post (see migration alongside).
// Auth: shared secret in the X-Cron-Secret header (CRON_SECRET env var).
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: orgs, error } = await supabaseAdmin.from("organizations").select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Record<string, unknown> = {};
  for (const org of orgs ?? []) {
    try {
      results[org.id] = await resolveStageOwnersForOrg(org.id);
    } catch (e) {
      results[org.id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, results });
}
