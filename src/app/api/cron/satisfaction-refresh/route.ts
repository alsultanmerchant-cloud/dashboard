import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/audit";
import { getOwnerAdminUserIds } from "@/lib/data/org-roles";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import { refreshSatisfactionStatuses } from "@/lib/satisfaction-refresh";

// Nightly satisfaction status sweep: run the same reconciliation pass the
// manual "تحديث" button triggers, for every client with a current analysis —
// least-recently-refreshed first — so verified closures land without anyone
// clicking. Auth: CRON_SECRET (x-cron-secret header or ?secret=).
// Registered via pg_cron (see supabase/migrations/0264_satisfaction_status_refresh.sql).

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
// Stop STARTING new clients once this much wall-clock has elapsed, so the run
// finishes cleanly inside maxDuration instead of dying mid-client.
const TIME_BUDGET_MS = 240_000;

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

  const startedAt = Date.now();
  const orgId = await getDefaultOrgId();
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_LIMIT;

  // Current analyses, never-refreshed first, then stalest. status_refreshed_at
  // is stamped even on failure so one broken client can't wedge the queue.
  const { data: analyses, error: listError } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("id, client_id, status_refreshed_at")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .order("status_refreshed_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (listError) {
    return NextResponse.json({ ok: false, error: listError.message }, { status: 500 });
  }

  let processed = 0;
  let resolvedTotal = 0;
  let downgradedTotal = 0;
  let questionsCreated = 0;
  const errors: Array<{ clientId: string; error: string }> = [];
  for (const row of (analyses ?? []) as Array<{ id: string; client_id: string }>) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    try {
      const summary = await refreshSatisfactionStatuses(orgId, row.client_id, null, row.id, {
        source: "ai_refresh_cron",
      });
      resolvedTotal += summary.resolved.length;
      downgradedTotal += summary.downgraded;
      questionsCreated += summary.questionsCreated;
    } catch (e) {
      errors.push({ clientId: row.client_id, error: (e as Error).message });
    }
    const { error: stampError } = await supabaseAdmin
      .from("client_satisfaction_analyses")
      .update({ status_refreshed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (stampError) {
      errors.push({ clientId: row.client_id, error: `stamp failed: ${stampError.message}` });
    }
    processed += 1;
  }

  // New questions need a human — nudge the satisfaction-alert audience
  // (owner+admin, same recipients as the insight-alerts engine). Dedup: skip
  // anyone still holding an UNREAD questions notification; once they read it,
  // a still-growing queue legitimately re-surfaces on the next run.
  if (questionsCreated > 0) {
    const recipients = await getOwnerAdminUserIds(orgId);
    for (const userId of recipients) {
      const { count } = await supabaseAdmin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("recipient_user_id", userId)
        .eq("type", "SATISFACTION_QUESTIONS_PENDING")
        .is("read_at", null);
      if ((count ?? 0) > 0) continue;
      await createNotification({
        organizationId: orgId,
        recipientUserId: userId,
        type: "SATISFACTION_QUESTIONS_PENDING",
        title: `أسئلة جديدة تحتاج إجابة الفريق (${questionsCreated})`,
        body: "متابعة رضا العملاء لم تجد دليلًا كافيًا للحكم على بعض البنود — إجابة واحدة تغلق البند أو تُبقيه مفتوحًا.",
        entityType: "satisfaction_question",
        entityId: null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    resolvedTotal,
    downgradedTotal,
    questionsCreated,
    errors,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
