import { NextRequest, NextResponse } from "next/server";
import { odooFromEnv } from "@/lib/odoo/client";
import { runImport } from "@/lib/odoo/importer";
import { syncStageHistory } from "@/lib/odoo/syncs/stage-history";
import { syncProjectFollowers } from "@/lib/odoo/syncs/project-followers";
import { syncTaskFollowers } from "@/lib/odoo/syncs/task-followers";
import { syncProjectMembers } from "@/lib/odoo/syncs/project-members";
import { syncAttachments } from "@/lib/odoo/syncs/attachments";
import { syncTaskAssigneeManagers } from "@/lib/odoo/syncs/task-assignee-managers";

// Odoo sync entry-point. Triggered by Supabase pg_cron via pg_net.http_post.
// Auth: shared secret in the X-Cron-Secret header (CRON_SECRET env var).
//
// The full pipeline (core import → assignee-managers → stage-history →
// followers → members → attachments) does not fit in a single 300s Vercel
// function budget for Sky Light's data volume, so we expose two query params
// to slice it up across separate cron entries:
//
//   ?only=<csv>   Run ONLY these steps. Everything else is skipped.
//   ?skip=<csv>   Run everything EXCEPT these steps.
//
// Step names: core, stage-history, assignee-managers, followers, members,
// attachments. When neither param is set, all steps run sequentially.
//
// Staggered cron layout (4 jobs, each comfortably under 280s):
//   :00  ?only=core
//   :15  ?only=stage-history,assignee-managers
//   :30  ?only=followers
//   :45  ?only=members,attachments

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

function parseCsv(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
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
  const only = parseCsv(request.nextUrl.searchParams.get("only"));
  const skip = parseCsv(request.nextUrl.searchParams.get("skip"));
  const shouldRun = (step: string) =>
    only.size > 0 ? only.has(step) : !skip.has(step);

  const startedAt = Date.now();
  const odoo = odooFromEnv();

  // Core import. Conditional now — the staggered "supplementary" cron jobs
  // assume core has been run by an earlier entry, so they pass ?only=<other>
  // to skip it. Manual runs (no params) still run core first as before.
  let coreStep: StepStatus | null = null;
  if (shouldRun("core")) {
    coreStep = await runStep(() => runImport(odoo, orgSlug));
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
  }

  // Supplementary steps — each isolated so a partial failure is acceptable.
  const stageHistoryStep = shouldRun("stage-history")
    ? await runStep(() => syncStageHistory(odoo, orgSlug))
    : null;
  const assigneeManagersStep = shouldRun("assignee-managers")
    ? await runStep(() => syncTaskAssigneeManagers(orgSlug))
    : null;
  const followersStep = shouldRun("followers")
    ? await runStep(async () => ({
        project: await syncProjectFollowers(odoo, orgSlug),
        task: await syncTaskFollowers(odoo, orgSlug),
      }))
    : null;
  const membersStep = shouldRun("members")
    ? await runStep(() => syncProjectMembers(odoo, orgSlug))
    : null;
  const attachmentsStep = shouldRun("attachments")
    ? await runStep(() => syncAttachments(odoo, orgSlug))
    : null;

  const steps = {
    core: coreStep,
    assigneeManagers: assigneeManagersStep,
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
    only: only.size > 0 ? Array.from(only) : null,
    steps,
  });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
