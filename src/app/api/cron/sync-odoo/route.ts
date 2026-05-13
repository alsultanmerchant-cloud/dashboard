import { NextRequest, NextResponse } from "next/server";
import { odooFromEnv } from "@/lib/odoo/client";
import { runImport } from "@/lib/odoo/importer";
import { syncStageHistory } from "@/lib/odoo/syncs/stage-history";
import { syncProjectFollowers } from "@/lib/odoo/syncs/project-followers";
import { syncProjectMembers } from "@/lib/odoo/syncs/project-members";
import { syncAttachments } from "@/lib/odoo/syncs/attachments";

// Hourly sync entry-point. Triggered by Supabase pg_cron via pg_net.http_post.
// Auth: shared secret in the X-Cron-Secret header (CRON_SECRET env var).
//
// Pipeline (per request): core import → stage-history → followers → members →
// attachments. Each supplementary step is independently try/caught so a single
// failure does not abort the others — the response reports per-step status.

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_ORG_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? "rawasm-demo";

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 401 });
}

type StepStatus =
  | { ok: true; durationMs: number; result: unknown }
  | { ok: false; durationMs: number; error: string };

async function runStep<T>(fn: () => Promise<T>): Promise<StepStatus> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { ok: true, durationMs: Date.now() - t0, result };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
  const skip = new Set(
    (request.nextUrl.searchParams.get("skip") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const startedAt = Date.now();
  const odoo = odooFromEnv();

  // Core import is required — if it fails, abort the whole run.
  const coreStep = await runStep(() => runImport(odoo, orgSlug));
  if (!coreStep.ok) {
    return NextResponse.json(
      {
        ok: false,
        orgSlug,
        durationMs: Date.now() - startedAt,
        step: "core",
        error: coreStep.error,
      },
      { status: 500 },
    );
  }

  // Supplementary steps — each isolated so partial failure is acceptable.
  const stageHistoryStep = skip.has("stage-history")
    ? null
    : await runStep(() => syncStageHistory(odoo, orgSlug));
  const followersStep = skip.has("followers")
    ? null
    : await runStep(() => syncProjectFollowers(odoo, orgSlug));
  const membersStep = skip.has("members")
    ? null
    : await runStep(() => syncProjectMembers(odoo, orgSlug));
  const attachmentsStep = skip.has("attachments")
    ? null
    : await runStep(() => syncAttachments(odoo, orgSlug));

  const steps = {
    core: coreStep,
    stageHistory: stageHistoryStep,
    followers: followersStep,
    members: membersStep,
    attachments: attachmentsStep,
  };
  const anyFailed = Object.values(steps).some((s) => s && !s.ok);

  return NextResponse.json({
    ok: !anyFailed,
    orgSlug,
    durationMs: Date.now() - startedAt,
    steps,
  });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
