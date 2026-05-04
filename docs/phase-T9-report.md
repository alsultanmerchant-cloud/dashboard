# Phase T9 — Reporting + KPIs (report)

**Status:** DONE (single dispatch, ~75 min). All four views, the digest function, the dashboard tiles, the /reports page, the AI button, and the contract tests shipped.

---

## Owner decision honoured: Option A — in-app only

Notification delivery for the CEO weekly digest is **in-app only**. The `weekly-digest` edge function does **not** call any email / WhatsApp / Slack / Resend / SendGrid transport. Instead:

1. It composes the digest JSON (same shape as `getCEOWeeklyDigest()` in `src/lib/data/reports.ts`).
2. It upserts one row into the new `weekly_digest_runs` table, keyed by `(organization_id, iso_year, iso_week)` — the unique index gives us idempotency on cron reruns and a payload cache.
3. It inserts one `notifications` row of type `WEEKLY_DIGEST_READY` per recipient (owner / admin / manager via `user_roles` join).
4. It writes one `ai_events` row of type `WEEKLY_DIGEST_READY` per org.

Email + WhatsApp delivery is deferred to **T8** (already on the road-map; see HANDOFF §6).

The `/reports` page exposes a "موجز الأسبوع المخزَّن" section that renders the latest stored digest payload (no recomputation), and the `/dashboard` tiles each link to `/reports` for the deep-dive — that's the prominent banner / "View digest" surface.

---

## What shipped

### Migration `0029_reporting_views.sql`

Four read-only views (plain views — Postgres ≥15 defaults to `security_invoker = true` and RLS is inherited from base tables; the dashboard's loaders use `supabaseAdmin` and scope by `organization_id`):

| View | Per-row meaning | Key columns |
|---|---|---|
| `v_rework_per_task` | Per task: count of `task_comments` authored while task was inside any `client_changes` window from `task_stage_history`. | `organization_id, task_id, project_id, rework_comment_count, last_client_changes_entered_at` |
| `v_on_time_delivery` | Per task currently in `done`: did `done_at` (= first `task_stage_history.entered_at` where `to_stage='done'`, fallback `tasks.completed_at`) land on/before `coalesce(due_date, planned_date)`? | `organization_id, task_id, project_id, service_id, deadline_date, done_at, on_time_bool` |
| `v_agent_productivity` | Per `(user_id, ISO-week-Mon)`: closed-task count + median minutes-per-stage as JSONB. Joins via `task_assignees → employee_profiles.user_id`. | `organization_id, user_id, week_start_date, closed_count, median_minutes_per_stage_jsonb` |
| `v_review_backlog` | Tasks currently in `manager_review` or `specialist_review` whose `business_minutes_between(stage_entered_at, now()) > 960` (= 2 business days, per migration 0025). | `organization_id, task_id, project_id, service_id, stage, stage_entered_at, business_minutes_in_stage` |

Plus one bookkeeping table:

- `weekly_digest_runs (organization_id, iso_year, iso_week, generated_at, recipient_count, payload jsonb)` with `unique(organization_id, iso_year, iso_week)`. Split-write RLS on the 1-arg `has_permission('reports.view')` overload — no FOR-ALL.

Permissions: `reports.view` is seeded (idempotent `on conflict do nothing`) and granted to `owner / admin / manager`.

### Edge function `supabase/functions/weekly-digest/index.ts`

- Cron header `0 4 * * 0` (Sunday 04:00 UTC = 07:00 Asia/Riyadh).
- Service-role client; per-org loop.
- Idempotency: short-circuit if a `weekly_digest_runs` row already exists for `(org, iso_year, iso_week)`.
- Composes the digest JSON inline (cannot import from `src/`); the JSON shape is the same contract enforced by `tests/reporting-views.test.mjs` against `src/lib/data/reports.ts`.
- Inserts notifications + ai_event. Mirrors the style of `governance-watcher`.

### Server-side data loaders `src/lib/data/reports.ts`

- `getRework`, `getOnTimeDelivery`, `getAgentProductivity`, `getReviewBacklog` — direct passthroughs over the four views.
- `getReworkHeatmapByService`, `getAgentLeaderboard`, `getRenewalForecast90d`, `getDepartmentSlaCompliance` — derived rollups.
- `countReworkThisWeek`, `getOnTimePct`, `countClosedThisWeek`, `countReviewBacklog` — the four dashboard-tile counters.
- `getCEOWeeklyDigest` — composes the JSON shape consumed by both `/reports` and the edge fn.
- `getLatestStoredDigest` — fetches the most recent stored payload from `weekly_digest_runs`.

### `/reports` page

Promoted from placeholder. Sections:
1. AI affordance — "اختصر لي تقرير الأسبوع" button calling `summarizeWeekAction` (Gemini, no tool calls — grounded only on the digest JSON).
2. 4 KPI tiles (on-time %, review backlog, rework total, renewals 90d).
3. Per-department SLA compliance — bar list.
4. Rework heat-map by service — bar list.
5. Agent leaderboard (top 10, last 4 weeks) with utilization % (relative ranker, labelled as such).
6. Renewal forecast next 90 days (top 12).
7. Stored weekly-digest summary cards.

### `/dashboard` (additive)

Added a SECOND row of 4 KPI tiles directly under the existing 4 hero KPIs (so it's now 8 tiles in 2×4). Did NOT rewrite the layout, the commercial card, or the watch-lists. New tiles all link to `/reports`:

- إعادة عمل هذا الأسبوع
- التسليم في الموعد (% over last 30 days)
- إنتاجية الأسبوع (closed tasks this ISO week)
- عُلوق المراجعة

Each loader is wrapped in `.catch(() => fallback)` so a transient view error never crashes the dashboard.

### Tests `tests/reporting-views.test.mjs`

21 contract assertions, pure Bun/Node, mirror style of `tests/governance.test.mjs`. Asserts:

- All four views declared.
- `weekly_digest_runs` table + uniqueness key + split-write RLS (no FOR-ALL).
- `business_minutes_between(...) > 960` used.
- UTC-anchored date cast (no IMMUTABLE trap).
- 1-arg `has_permission('reports.view')` in policies.
- Loader exports + digest-payload key contract.
- Edge fn cron + idempotency + Option-A guard (no email transport keywords).
- Edge fn pulls recipients from `user_roles` for `owner/admin/manager`.
- `/reports` has the four required sections + AI button.
- AI action is tool-free (grounding guarantee).
- `/dashboard` imports the 4 counters and renders 4 new tile labels.

Run: `node tests/reporting-views.test.mjs` → **21 passed, 0 failed**.

---

## Pre-flight smoke

- `mcp__supabase__execute_sql EXPLAIN <v_rework_per_task body>` parses cleanly against the live schema (verified before writing the migration).
- Schema spot-check: `tasks` has `due_date`, `planned_date`, `completed_at`, `service_id`, `stage_entered_at`; `task_stage_history` has `entered_at`, `exited_at`, `to_stage`, `duration_seconds`. Spec strings `deadline_date` / `done_at` were mapped to `coalesce(due_date, planned_date)` and the first `to_stage='done'` history transition (with `completed_at` fallback) — see migration comment block.
- The migration is **not** applied. Per HANDOFF §2 the orchestrator applies it.

---

## Decisions taken on ambiguity

| Area | Choice | Why |
|---|---|---|
| `deadline_date` source | `coalesce(due_date, planned_date)` | Live schema has neither column called `deadline_date`. `due_date` is the operator-set value; `planned_date` is the template-projected fallback. |
| `done_at` source | First `task_stage_history.entered_at` with `to_stage='done'`, fallback `tasks.completed_at`. | A task that bounces in/out of done still has a canonical first-delivery timestamp; matches the "did it land on time" question better than `completed_at` alone. |
| On-time rollup approach | Base view + computed-in-TS rollup over a 30-day window. | Owner spec gave the choice. Configurable window is simpler in TS than parametrised SQL function, and keeps the view dependency-free. |
| Agent leaderboard "utilization %" | Relative ranker = `closed / max(closed) * 100`. | We don't capture hours-tracked, so absolute capacity isn't computable. UI label says "نسبة استخدام نسبيّة" implicitly via the leaderboard hint. Documented in code comment + this report. |
| Digest payload storage | Inside `weekly_digest_runs.payload jsonb`. | Simpler than embedding into `notifications.body`; makes idempotency deduplication trivial via the unique index; lets `/reports` render the latest digest with one query. |
| Recipients | owner / admin / manager via `user_roles + roles.key`. | Matches the existing CEO-style dashboard audience (HANDOFF §2.6). |

No `phase-T9-questions.md` was needed — every ambiguity had a defensible default.

---

## What's NOT in this phase (deferred)

- Email + WhatsApp transport for the digest (T8, owner-confirmed deferral).
- Persisted user preferences for digest cadence / opt-out (use `notifications.read_at` for now).
- Materialized views — chose plain views; rebuild cost is negligible at Sky Light's data volume. Revisit if `/reports` open latency exceeds 500ms after T10 cutover.

---

## Files touched

**NEW**
- `supabase/migrations/0029_reporting_views.sql` (~230 LOC)
- `supabase/functions/weekly-digest/index.ts` (~290 LOC)
- `src/lib/data/reports.ts` (~360 LOC)
- `src/app/(dashboard)/reports/_actions.ts` (~50 LOC)
- `src/app/(dashboard)/reports/summarize-week-button.tsx` (~40 LOC) — co-located client component for the AI button
- `tests/reporting-views.test.mjs` (~190 LOC)
- `docs/phase-T9-report.md` (this file)

**EDITED**
- `src/app/(dashboard)/dashboard/page.tsx` — added 4 imports, 4 `Promise.all` entries, 1 new `<div>` row of 4 `<MetricCard>` tiles. No layout rewrite.
- `src/app/(dashboard)/reports/page.tsx` — full rewrite from placeholder to 7-section page (4 spec'd sections + 4-tile KPI strip + AI affordance + stored-digest preview).

**NOT touched** (per file ownership): `src/lib/supabase/types.ts`, theme/sidebar/topbar, `src/lib/nav.ts`, `src/lib/copy.ts` (no shared strings reused — page-local Arabic literals were enough), other migrations, the 4 already-deployed edge functions, T6/T7/T7.5 modules.
