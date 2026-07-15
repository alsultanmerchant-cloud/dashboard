import { NextRequest, NextResponse } from "next/server";
import { odooFromEnv } from "@/lib/odoo/client";
import {
  runImport,
  reconcileOdooDeletions,
  type ImportPhase,
  type SyncMode,
} from "@/lib/odoo/importer";
import { syncStageHistory } from "@/lib/odoo/syncs/stage-history";
import { syncProjectFollowers } from "@/lib/odoo/syncs/project-followers";
import { syncTaskFollowers } from "@/lib/odoo/syncs/task-followers";
import { syncProjectMembers } from "@/lib/odoo/syncs/project-members";
import { syncAttachments } from "@/lib/odoo/syncs/attachments";
import { syncTaskAssigneeManagers } from "@/lib/odoo/syncs/task-assignee-managers";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
//   ?mode=full    Re-pull everything + reap deletes (nightly reconcile). Default
//                 is incremental: pull only rows changed since the watermark
//                 (sync_watermarks table), which is what fits the time budget.
//
// Step names: core, core-base, core-projects, core-tasks, core-comments,
// reconcile, stage-history, assignee-managers, followers, members, attachments.
// `core` runs the whole import in one go (manual full runs); the `core-*`
// slices run one phase each so the staggered cron never blows the function
// budget. When neither param is set, all steps run sequentially.
//
// Staggered cron layout (see migration 0116) — one phase per job:
//   :00  core-base       :30  core-comments
//   :08  core-projects   :38  stage-history,assignee-managers
//   :16  core-tasks      :46  followers
//                        :54  members,attachments

export const runtime = "nodejs";
// Hobby plan serverless functions top out at 300s. Full `?only=core` runs are
// therefore not suitable on Vercel Hobby; use the phased `core-*` cron slices
// (and the supplementary step slices) instead.
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

  // ?mode=full re-pulls everything + reaps deletes (nightly reconcile, manual
  // backfills). Default is incremental: pull only rows changed since the stored
  // watermark, which is what keeps the every-2h business-hours runs fast.
  const mode: SyncMode =
    request.nextUrl.searchParams.get("mode") === "full" ? "full" : "incremental";

  const startedAt = Date.now();
  const odoo = odooFromEnv();

  // Core import. Conditional now — the staggered "supplementary" cron jobs
  // assume core has been run by an earlier entry, so they pass ?only=<other>
  // to skip it. Manual runs (no params) still run core first as before.
  let coreStep: StepStatus | null = null;
  if (shouldRun("core")) {
    coreStep = await runStep(() => runImport(odoo, orgSlug, undefined, mode));
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

  // Phased core slices. The full `core` is too heavy for a single 300s
  // function, so the staggered cron runs one phase per entry. Each is
  // isolated — a partial failure doesn't abort the others — and rebuilds its
  // ID maps from already-synced rows, so order across cron runs is enough.
  const CORE_PHASE_STEPS: Record<string, ImportPhase> = {
    "core-base": "base",
    "core-projects": "projects",
    "core-tasks": "tasks",
    "core-comments": "comments",
  };
  const corePhaseSteps: Record<string, StepStatus> = {};
  for (const [stepName, phase] of Object.entries(CORE_PHASE_STEPS)) {
    if (shouldRun(stepName)) {
      corePhaseSteps[stepName] = await runStep(() =>
        runImport(odoo, orgSlug, [phase], mode),
      );
    }
  }

  // Delete-reconciliation — cheap id-set diff that reaps rows hard-deleted in
  // Odoo (the incremental upserts never delete). Runs in the nightly job.
  const reconcileStep = shouldRun("reconcile")
    ? await runStep(() => reconcileOdooDeletions(odoo, orgSlug))
    : null;

  // Supplementary steps — each isolated so a partial failure is acceptable.
  const stageHistoryStep = shouldRun("stage-history")
    ? await runStep(async () => {
        const res = await syncStageHistory(odoo, orgSlug);
        // Realign tasks.stage_entered_at with the freshly-synced Odoo
        // stage_in_date so stage-dwell matches Rwasem, not the sync time (0250).
        const { data: reconciled } = await supabaseAdmin.rpc(
          "reconcile_stage_entered_at",
          { p_task_ids: undefined },
        );
        return { ...res, stageEnteredAtReconciled: reconciled ?? 0 };
      })
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
    ...corePhaseSteps,
    reconcile: reconcileStep,
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
    mode,
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
