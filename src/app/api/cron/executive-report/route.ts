import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateAndStoreExecutiveReport } from "@/lib/executive-report-generate";
import { daySpan, type DashboardRange } from "@/lib/dashboard-range";
import { riyadhTodayIso } from "@/lib/tz";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// =========================================================================
// Monthly executive report — generates LAST calendar month's report so it is
// already waiting in /reports (and printable) on the 1st, instead of needing
// someone to remember to click "generate".
//
// Query params:
//   ?month=YYYY-MM   generate that month instead of the previous one
//   ?dry=1           resolve the period and return it, generate nothing
//
// Auth mirrors the other cron routes: Vercel sends `Authorization: Bearer
// <CRON_SECRET>`; pg_cron and manual runs use x-cron-secret or ?secret.
// =========================================================================

/** Previous calendar month in Riyadh terms, as YYYY-MM. */
function previousMonthIso(todayIso: string): string {
  const [y, m] = todayIso.split("-").map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Full calendar month as an inclusive report range. */
function monthRange(monthIso: string): DashboardRange {
  const [y, m] = monthIso.split("-").map(Number);
  const from = `${monthIso}-01`;
  // Day 0 of the next month = last day of this one.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${monthIso}-${String(last).padStart(2, "0")}`;
  return { from, to, preset: "custom", days: daySpan(from, to) };
}

async function run(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "not configured" }, { status: 500 });
  const provided =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const monthParam = request.nextUrl.searchParams.get("month");
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : previousMonthIso(riyadhTodayIso());
  const range = monthRange(month);
  const dry = request.nextUrl.searchParams.get("dry") === "1";

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", "rawasm-demo")
    .single();
  if (orgError || !org) return NextResponse.json({ error: "org not found" }, { status: 500 });

  if (dry) return NextResponse.json({ ok: true, dry: true, month, range });

  try {
    // requestedBy = null marks this as a scheduled (not human) run.
    const report = await generateAndStoreExecutiveReport(org.id, range, null);
    return NextResponse.json({
      ok: true,
      month,
      range: { from: range.from, to: range.to },
      reportId: report.id,
      model: report.model,
      // Non-null when the facts landed but some narrative chapter failed —
      // the run is still usable, so this is a warning, not an error.
      aiWarning: report.errorMessage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "report generation failed";
    console.error("[cron.executive-report]", message);
    return NextResponse.json({ ok: false, month, error: message }, { status: 500 });
  }
}

// pg_cron invokes these routes with net.http_post; GET is kept for manual and
// ?dry=1 runs from a browser or curl.
export const POST = run;
export const GET = run;
