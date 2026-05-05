import { NextRequest, NextResponse } from "next/server";
import { odooFromEnv } from "@/lib/odoo/client";
import { runImport } from "@/lib/odoo/importer";

// Hourly sync entry-point. Triggered by Supabase pg_cron via pg_net.http_post.
// Auth: shared secret in the X-Cron-Secret header (CRON_SECRET env var).
// Long-running: timeout bumped via runtime config below.

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — sync of ~2k tasks fits.
export const dynamic = "force-dynamic";

const DEFAULT_ORG_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? "rawasm-demo";

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 401 });
}

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const provided = request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");
  if (provided !== expected) return unauthorized("bad secret");

  const orgSlug = request.nextUrl.searchParams.get("org") ?? DEFAULT_ORG_SLUG;

  const startedAt = Date.now();
  try {
    const odoo = odooFromEnv();
    const summary = await runImport(odoo, orgSlug);
    return NextResponse.json({
      ok: true,
      orgSlug,
      durationMs: Date.now() - startedAt,
      summary,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        orgSlug,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
