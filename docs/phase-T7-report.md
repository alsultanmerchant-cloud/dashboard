# Phase T7 — Renewal Cycles

**Status:** Migration written (not yet applied — orchestrator runs `apply_migration` per dispatch hard rule). Code, UI, edge function, tests committed on `main`.

**Goal:** make project renewals first-class. A renewal is the SAME `projects` row + a NEW `renewal_cycles` row (per owner DECISIONS_LOG row 1). Cycle length VARIES per client — `cycle_length_months` is a per-project integer, `NULL` = one-time.

## Deliverables

### 1. Migration `supabase/migrations/0026_renewals.sql`
Purely additive:
- `projects.cycle_length_months INTEGER NULL` — `1` (monthly), `3` (quarterly), `6`, `12`. `NULL` = one-time.
- `projects.next_renewal_date DATE NULL` — drives the 14-day badge + the scheduler.
- New table `renewal_cycles (id, project_id, cycle_no INT, started_at DATE, ended_at DATE, status TEXT)` with `UNIQUE (project_id, cycle_no)` and a `CHECK (status in ('active','completed','cancelled'))`.
- Index `idx_renewal_cycles_project (project_id, cycle_no DESC)` + partial index on `projects.next_renewal_date`.
- RLS:
  - SELECT joins `projects` via `EXISTS (… WHERE p.id = renewal_cycles.project_id AND public.has_org_access(p.organization_id))`.
  - INSERT/UPDATE/DELETE split (wave-2 lesson: never `FOR ALL` when USING references another RLS-protected table) — each gated on the **1-arg** `public.has_permission('renewal.manage')` overload (per dispatch hard rule).
- Permission seed: `renewal.manage`, bound to `owner / admin / manager / account_manager`.

### 2. Server actions — `src/app/(dashboard)/projects/[id]/renewals/_actions.ts`
A sibling sub-folder, so `src/app/(dashboard)/projects/_actions.ts` was NOT modified (per dispatch scope).
- `startRenewalCycleAction(projectId)` — picks the next `cycle_no`, inserts the row, rolls `projects.next_renewal_date` forward by `cycle_length_months` when set, and runs the **T4 categories engine** (`generateTasksFromCategories`) reusing the project's existing `project_services` rows. READ-ONLY consumer of T4 (`src/lib/projects/*` not touched).
- `setProjectCycleAction(projectId, lengthMonths, nextRenewalDate)` — updates the two new project columns.
- Both follow the project's mutation contract: zod validate → `requirePermission('renewal.manage')` → org-scope check (`project.organization_id === session.orgId`) → `audit_log` (`renewal.start_cycle` / `renewal.set_cycle`) + `ai_event` (`RENEWAL_CYCLE_STARTED` `high` / `PROJECT_RENEWAL_SCHEDULE_SET` `normal`).

### 3. Edge function — `supabase/functions/renewal-scheduler/index.ts`
- Cron daily 06:00 Asia/Riyadh (= 03:00 UTC) — to be wired up by the orchestrator alongside the existing cron entries.
- For each project where `today <= next_renewal_date <= today + 14 days` and no active `renewal_cycles` row covering that period → INSERT a `notifications` row with `type='RENEWAL_DUE_SOON'` to the project's AM, plus a matching `ai_events` row with `importance='high'`.
- Idempotent against same-day duplicate runs: pre-checks an existing `RENEWAL_DUE_SOON` notification for that project created since `today T00:00`.
- `shouldNudge` is exported as a pure function and exercised directly by `tests/renewal-scheduler.test.mjs`.

### 4. UI
- `RenewalsPanel` (`src/app/(dashboard)/projects/[id]/renewals/renewals-panel.tsx`):
  - Card 1 — جدول التجديد form (`cycle_length_months` 1..36, `next_renewal_date`). Disabled inline when caller lacks `renewal.manage`.
  - Card 2 — دورات التجديد table of historical cycles (cycle_no / started_at / ended_at / status), with the "بدء دورة تجديد جديدة" primary button. Empty state surfaces "لا توجد دورات تجديد مسجَّلة لهذا المشروع بعد".
  - Both `<form>`s use `useActionState` against the new server actions.
- Project detail (`src/app/(dashboard)/projects/[id]/page.tsx`): renewals tab inserted as a new `<SectionTitle title="دورات التجديد">` block above the tasks board. Header shows the amber 14-day badge "تجديد خلال X يوم".
- Project list (`src/app/(dashboard)/projects/page.tsx`): same amber badge inline next to the project name (RTL-correct, `RefreshCw` icon).
- Dashboard (`src/app/(dashboard)/dashboard/page.tsx`): NEW MetricCard "تجديدات هذا الشهر" added to the existing tile grid (non-rewriting — single tile insertion). Click-through links to `/projects?filter=renewals_this_month` (filter wiring is left for a later phase that owns `/projects` filters).

### 5. Data helpers — `src/lib/data/renewals.ts`
- `listProjectRenewalCycles(orgId, projectId)` — ordered by cycle_no desc, with an explicit org-scope check.
- `daysUntilRenewal(iso)` — pure helper used by both badges.
- `countRenewalsThisMonth(orgId)` — count(`*`) on the current calendar month for the dashboard tile.

### 6. Tests
- `tests/renewal-scheduler.test.mjs` — pure-Bun, 9/9 green. Covers the 14-day window (inclusive boundary), past dates, suppression by an active covering cycle, non-suppression by completed/expired/future cycles.
  ```
  $ bun run tests/renewal-scheduler.test.mjs
  9 passed, 0 failed
  ```
- `tests/playwright/project-renewal.spec.ts` — committed contract: log in → set cycle 13 days out → assert "تجديد خلال X يوم" on detail + list views → start a new cycle → assert row #1 appears in the table.

## Files created
- `supabase/migrations/0026_renewals.sql`
- `supabase/functions/renewal-scheduler/index.ts`
- `src/app/(dashboard)/projects/[id]/renewals/_actions.ts`
- `src/app/(dashboard)/projects/[id]/renewals/renewals-panel.tsx`
- `src/lib/data/renewals.ts`
- `tests/renewal-scheduler.test.mjs`
- `tests/playwright/project-renewal.spec.ts`
- `docs/phase-T7-report.md`

## Files modified (all additive, scope-respected)
- `src/app/(dashboard)/projects/[id]/page.tsx` — renewal tab + header badge.
- `src/app/(dashboard)/projects/page.tsx` — list-view badge.
- `src/app/(dashboard)/dashboard/page.tsx` — single tile insertion.
- `src/lib/data/projects.ts` — select `cycle_length_months, next_renewal_date` on the list query.
- `src/lib/copy.ts` — `empty.renewalCycles` entry.

## Files deliberately NOT touched (per dispatch scope)
- `src/app/(dashboard)/projects/_actions.ts`
- `src/app/(dashboard)/projects/new/...`
- `src/app/(dashboard)/service-categories/...`
- `src/app/(dashboard)/tasks/...`
- `src/lib/projects/*` (T4's offset/category engines — READ-ONLY consumer)
- `src/lib/supabase/types.ts`
- `supabase/migrations/0025*` (T5) and `0026b*` (T7.5)
- `src/app/(dashboard)/contracts/`, `/am/`, `/escalations/`

## Acceptance walk
1. Owner opens `/projects/<id>` and sees the new "دورات التجديد" section.
2. Sets طول الدورة = 1 شهر, تاريخ التجديد القادم = today + 13 days, presses حفظ. Toast confirms; the amber "تجديد خلال 13 يوم" badge appears in the header.
3. `/projects` shows the same badge inline next to the project name.
4. `/dashboard` shows the new "تجديدات هذا الشهر" tile counting the project.
5. Owner presses "بدء دورة تجديد جديدة" → renewal_cycles row #1 inserted, T4 engine regenerates renewal tasks, `next_renewal_date` rolls forward by 1 month. `audit_log` + `RENEWAL_CYCLE_STARTED` ai_event written.
6. Cron at 06:00 Asia/Riyadh: edge function nudges the AM via `notifications` + ai_event for any project still inside the 14-day window without an active covering cycle.

## Open follow-ups (not in T7 scope)
- `/projects?filter=renewals_this_month` link target needs a filter implementation on the projects page (left to the phase that owns `/projects` filters; the link is harmless until then because the page just lists everything).
- T7.5 will bulk-import the owner's Acc Sheet `Cycle_tracker` (979 rows) into `renewal_cycles` via `scripts/import-acc-sheet.ts`. T7 deliberately did not touch that script.
- The edge function's pg_cron schedule (`select cron.schedule(...)`) is not included here — orchestrator wires cron alongside the other phase functions.
