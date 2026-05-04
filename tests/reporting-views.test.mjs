// Phase T9 — Reporting + KPIs contract tests.
//
// Pure-Bun/Node. Run with:
//   bun run tests/reporting-views.test.mjs
//   node tests/reporting-views.test.mjs
//
// We do not boot Postgres or Next here. We assert that the SQL migration,
// the reports data loader, the weekly-digest edge function, and the
// /reports page contain the contract strings T9 requires. Mirror style
// of tests/governance.test.mjs.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const MIGRATION_PATH = join(repoRoot, "supabase/migrations/0029_reporting_views.sql");
const LOADER_PATH    = join(repoRoot, "src/lib/data/reports.ts");
const EDGE_PATH      = join(repoRoot, "supabase/functions/weekly-digest/index.ts");
const REPORTS_PAGE   = join(repoRoot, "src/app/(dashboard)/reports/page.tsx");
const REPORTS_ACTS   = join(repoRoot, "src/app/(dashboard)/reports/_actions.ts");
const DASHBOARD_PAGE = join(repoRoot, "src/app/(dashboard)/dashboard/page.tsx");

const cases = [
  // -- migration ----------------------------------------------------------
  ["migration file exists", () => assert.ok(existsSync(MIGRATION_PATH))],
  ["migration declares all four views", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    for (const v of [
      "v_rework_per_task",
      "v_on_time_delivery",
      "v_agent_productivity",
      "v_review_backlog",
    ]) {
      assert.match(sql, new RegExp(`create view public\\.${v}`), `missing view ${v}`);
    }
  }],
  ["migration creates weekly_digest_runs table with idempotency unique key", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /create table if not exists public\.weekly_digest_runs/i);
    assert.match(sql, /unique \(organization_id, iso_year, iso_week\)/);
  }],
  ["migration uses business_minutes_between for review backlog", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /business_minutes_between/);
    assert.match(sql, /> 960/); // 2 business days
  }],
  ["migration uses 1-arg has_permission overload on weekly_digest_runs", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    assert.match(sql, /has_permission\('reports\.view'\)/);
  }],
  ["migration has split-write RLS on weekly_digest_runs (no FOR ALL)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    for (const cmd of ["select", "insert", "update", "delete"]) {
      assert.match(
        sql,
        new RegExp(`policy weekly_digest_runs_${cmd}.*for ${cmd}`, "is"),
        `missing ${cmd} policy`,
      );
    }
    assert.ok(
      !/policy [a-z_]+ on public\.weekly_digest_runs\s+for all/i.test(sql),
      "FOR ALL policy detected on weekly_digest_runs — split it instead",
    );
  }],
  ["v_on_time_delivery anchors UTC for IMMUTABLE-safe date cast", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // The completed_at::date trap from 0023 — make sure we use UTC anchor.
    assert.match(sql, /at time zone 'UTC'\)::date/);
  }],

  // -- data loader --------------------------------------------------------
  ["loader exists and exports all four view loaders", () => {
    const src = readFileSync(LOADER_PATH, "utf8");
    for (const fn of [
      "getRework",
      "getOnTimeDelivery",
      "getAgentProductivity",
      "getReviewBacklog",
      "getCEOWeeklyDigest",
    ]) {
      assert.match(src, new RegExp(`export async function ${fn}`), `missing ${fn}`);
    }
  }],
  ["loader composes a digest payload with all required keys", () => {
    const src = readFileSync(LOADER_PATH, "utf8");
    for (const key of [
      "rework", "on_time", "productivity", "review_backlog",
      "renewals_next_90d", "sla_by_department",
      "iso_year", "iso_week", "week_start_date",
    ]) {
      assert.ok(src.includes(key), `digest missing key: ${key}`);
    }
  }],
  ["loader exposes dashboard tile counters", () => {
    const src = readFileSync(LOADER_PATH, "utf8");
    for (const fn of [
      "countReworkThisWeek",
      "getOnTimePct",
      "countClosedThisWeek",
      "countReviewBacklog",
    ]) {
      assert.match(src, new RegExp(`export async function ${fn}`), `missing ${fn}`);
    }
  }],
  ["loader queries v_review_backlog (not raw tasks) for backlog counter", () => {
    const src = readFileSync(LOADER_PATH, "utf8");
    assert.match(src, /from\("v_review_backlog"\)/);
  }],

  // -- weekly-digest edge function ----------------------------------------
  ["edge function file exists", () => assert.ok(existsSync(EDGE_PATH))],
  ["edge function uses service role + supabase-js", () => {
    const src = readFileSync(EDGE_PATH, "utf8");
    assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(src, /createClient/);
  }],
  ["edge function has Sunday 04:00 UTC cron header", () => {
    const src = readFileSync(EDGE_PATH, "utf8");
    assert.match(src, /0 4 \* \* 0/);
  }],
  ["edge function is idempotent per (org, iso_week)", () => {
    const src = readFileSync(EDGE_PATH, "utf8");
    assert.match(src, /weekly_digest_runs/);
    assert.match(src, /already_generated/);
  }],
  ["edge function inserts in-app notifications (Option A) and ai_event", () => {
    const src = readFileSync(EDGE_PATH, "utf8");
    assert.match(src, /WEEKLY_DIGEST_READY/);
    assert.match(src, /from\("notifications"\)/);
    assert.match(src, /from\("ai_events"\)/);
    // Option A: must NOT call Resend / SendGrid / Postmark / WhatsApp.
    assert.ok(!/resend|sendgrid|postmark|whatsapp/i.test(src),
      "edge fn appears to call an email/WhatsApp transport — Option A forbids that");
  }],
  ["edge function pulls owner/admin/manager recipients from user_roles", () => {
    const src = readFileSync(EDGE_PATH, "utf8");
    assert.match(src, /from\("user_roles"\)/);
    assert.match(src, /\["owner", "admin", "manager"\]/);
  }],

  // -- /reports page + AI button ------------------------------------------
  ["/reports page promoted to four sections + weekly digest", () => {
    const src = readFileSync(REPORTS_PAGE, "utf8");
    for (const txt of [
      "التزام SLA حسب القسم",
      "إعادة العمل حسب الخدمة",
      "لوحة الأفراد",
      "توقّع التجديدات",
      "موجز الأسبوع",
    ]) {
      assert.ok(src.includes(txt), `/reports missing section heading: ${txt}`);
    }
    // RTL contract — page is rendered inside RTL layout; we verify the
    // AI button label exists.
    assert.match(src, /SummarizeWeekButton/);
  }],
  ["AI summary action grounds the prompt only on the digest payload", () => {
    const src = readFileSync(REPORTS_ACTS, "utf8");
    assert.match(src, /summarizeWeekAction/);
    assert.match(src, /getCEOWeeklyDigest/);
    assert.match(src, /gemini-3-flash-preview/);
    // No tool calls — the model must NOT have queryDatabase / webSearch.
    assert.ok(!/tool\(|tools:/i.test(src),
      "summarize action exposes tools to the model — keep it tool-free for grounding");
  }],

  // -- /dashboard tiles ---------------------------------------------------
  ["dashboard page additively imports the 4 T9 counters", () => {
    const src = readFileSync(DASHBOARD_PAGE, "utf8");
    assert.match(src, /countReworkThisWeek/);
    assert.match(src, /getOnTimePct/);
    assert.match(src, /countClosedThisWeek/);
    assert.match(src, /countReviewBacklog/);
  }],
  ["dashboard renders 4 new T9 tiles", () => {
    const src = readFileSync(DASHBOARD_PAGE, "utf8");
    for (const label of [
      "إعادة عمل هذا الأسبوع",
      "التسليم في الموعد",
      "إنتاجية الأسبوع",
      "عُلوق المراجعة",
    ]) {
      assert.ok(src.includes(label), `dashboard missing tile: ${label}`);
    }
  }],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    pass += 1;
    console.log(`  ok ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
