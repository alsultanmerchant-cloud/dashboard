import { NextRequest, NextResponse } from "next/server";
import { odooFromEnv } from "@/lib/odoo/client";
import { syncAttachments } from "@/lib/odoo/syncs/attachments";

// Dedicated attachments sync endpoint.
//
// Why this exists: ir.attachment is the slowest model to walk (~1500+ rows
// across tasks + projects with a 5KB metadata row each), and attachments
// don't churn the way tasks/comments do. Putting it on its own daily cron
// keeps the hourly /api/cron/sync-odoo route well under the 5-min cap.
//
// Auth: same CRON_SECRET as the main sync. Either x-cron-secret header or
// ?secret=... query param.

export const runtime = "nodejs";
export const maxDuration = 300;
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
  const provided =
    request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");
  if (provided !== expected) return unauthorized("bad secret");

  const orgSlug = request.nextUrl.searchParams.get("org") ?? DEFAULT_ORG_SLUG;
  const startedAt = Date.now();

  try {
    const odoo = odooFromEnv();
    const result = await syncAttachments(odoo, orgSlug);
    return NextResponse.json({
      ok: true,
      orgSlug,
      durationMs: Date.now() - startedAt,
      result,
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
