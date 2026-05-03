# Phase T5 — Decisions + SLA + Escalation Engine

**Status:** Migration written (not yet applied — orchestrator runs `apply_migration`). Code, edge function, UI and tests committed on `main`.

**Goal:** owner spec layers 6 + 8 — encode decision rights, escalation paths and an SLA control loop with auto-escalation on breach. Per owner directive (DECISIONS_LOG `Q4 — Exceptions`) the auto-action is **notification + log entry only**, not a workflow override.

## Deliverables

### 1. Migration `supabase/migrations/0025_decisions_escalations.sql`
Purely additive against the live schema. RLS gates use the **1-arg `has_permission(text)`** overload (per dispatch hard rule). Every write policy is split per-command (INSERT/UPDATE/DELETE) per the Wave-2 lessons in `0022b` / `0023b` — no FOR-ALL policies that re-open SELECT.

Tables:
- `decision_rights (id, organization_id, decision_key UNIQUE per org, owner_position, scope_note)` — seeded with the 6 rows from `SPEC_FROM_OWNER §13` (`execute`, `distribute`, `approve_quality`, `change_scope`, `client_exception`, `resource_priority`).
- `escalation_paths (id, organization_id, kind CHECK in operational/functional/client/critical, from_position, to_position, sla_minutes)` — seeded with the 4 paths from `§12`.
- `sla_rules (id, organization_id, stage_key UNIQUE per org, max_minutes, severity, business_hours_only)` — seeded with the 5 owner-confirmed values: `manager_review=30`, `specialist_review=30`, `ready_to_send=15`, `sent_to_client=240`, `client_changes=480`.
- `business_hours (weekday PK, open_time, close_time, tz default 'Asia/Riyadh')` — seeded Sun(0)–Thu(4) at 09:00–17:00. Fri(5) and Sat(6) deliberately absent.
- `exceptions (id, organization_id, task_id, kind CHECK client/deadline/quality/resource, reason, opened_by, opened_at, resolved_by, resolved_at, resolution_note, stage_entered_at)`. Partial unique index `uniq_exceptions_open_per_stage` on `(task_id, stage_entered_at) WHERE kind='deadline' AND resolved_at IS NULL` makes the SLA watcher idempotent.
- `escalations (id, organization_id, exception_id, task_id, level, raised_to_user_id, raised_at, acknowledged_at, acknowledged_by, status default 'open')`.

`tasks` extension:
- `ADD COLUMN sla_override_minutes INTEGER`.

Helper SQL function:
- `business_minutes_between(start, end) RETURNS INTEGER` — pure (no table reads), `STABLE` (timezone-data dependent so cannot be `IMMUTABLE`). Iterates Riyadh-local days, intersects each Sun–Thu 09:00–17:00 window with `[start, end]`.

Permissions seeded:
- `escalation.view_own` → bound to **every role** (everyone gets their own inbox).
- `escalation.view_all` + `escalation.acknowledge` → owner / admin / manager.
- `exception.open` → owner / admin / manager / specialist (per spec §11 — specialist+).

RLS highlights:
- `exceptions_select` admits the row when caller is `escalation.view_all`, the opener, or related to the task (creator / assignee / follower) — the predicate joins `task_assignees`, `task_followers` and `employee_profiles` but is INSERT-side OR'd with the existing tight policies; we keep it on `SELECT` only so it never re-opens writes.
- All write policies are split per-command.

### 2. Edge function `supabase/functions/sla-watcher/index.ts`
Cron: every 5 min (15-min SLAs need sub-15-min cadence). For every task NOT `done`:
- Resolve `max_minutes` precedence: `tasks.sla_override_minutes` → `task_templates.sla_minutes_new` / `sla_minutes_in_progress` (only for stages `new` / `in_progress`) → `sla_rules.max_minutes` for the stage → `null` (skip).
- Compute time-in-current-stage with `business_minutes_between` when `sla_rules.business_hours_only` is true; raw minutes otherwise.
- If exceeded AND no open `deadline` exception for `(task_id, stage_entered_at)`:
  - INSERT `exceptions` (`kind='deadline'`, `reason='تجاوز الـSLA بـ N دقيقة (source)'`, `stage_entered_at` set for idempotency).
  - Resolve the task's team-lead via `services.default_department_id → department_team_leads → departments.head_employee_id → projects.account_manager_employee_id` (best-effort cascade).
  - INSERT `escalations` to that team-lead, INSERT `notifications` (`type='SLA_BREACHED'`), and INSERT `ai_events` (`event_type='SLA_BREACHED'`, importance `high`).

Idempotency comes from the partial unique index in 0025 — the function can be invoked safely at any cadence.

### 3. Server actions — `src/app/(dashboard)/escalations/_actions.ts`
- `openExceptionAction(prev, formData)` — gated by `exception.open`. Validates kind (closed list), org-scopes the task, snapshots `tasks.stage_entered_at` so a future SLA-watcher pass treats it as covered. Writes `audit_log` + `ai_event(EXCEPTION_OPENED, importance=high)`.
- `resolveExceptionAction(prev, formData)` — opener OR `escalation.view_all` may close. Auto-closes any open escalations linked to the same exception. Writes audit + `ai_event(EXCEPTION_RESOLVED)`.
- `acknowledgeEscalationAction({ id })` — recipient OR `escalation.acknowledge`. Flips status to `acknowledged`, fires a `NOTIFICATION_CREATED` chain via `createNotification`, logs audit + `ai_event(ESCALATION_ACKNOWLEDGED)`.

### 4. UI

#### `/escalations` (new route)
- `page.tsx` (server component, `force-dynamic`) — gated by `requirePagePermissionAny(['escalation.view_own', 'escalation.view_all'])`.
- Top strip: open-exception counts by kind (4 chips).
- Toolbar: filter by kind (`?kind=client|deadline|quality|resource|<all>`).
- Two sections: **Exceptions** (with inline resolve form when allowed) and **Escalations** (with `إقرار` button).
- Skeleton/empty/error states honoured (page `force-dynamic`, sections render `EmptyState` when arrays are empty).

#### Task detail badge
- `src/app/(dashboard)/escalations/task-exception-badge.tsx` (client) — renders the red `استثناء مفتوح` badge when an open exception exists, plus a "فتح استثناء" dialog gated by `exception.open`. Uses the existing `Dialog` primitives.
- Wired into `src/app/(dashboard)/tasks/[id]/page.tsx` as a small **read-side** addition only — page imports the badge component and a one-shot Supabase query (`exceptions where task_id=… AND resolved_at IS NULL`). **`tasks/_actions.ts` is NOT touched** per the dispatch scope rule.

#### Dashboard tile
- New `MetricCard` "تصعيدات مفتوحة" added next to the existing tiles (after the AI-events tile; not a layout rewrite — single insertion point as instructed). Tone flips to `destructive` when count > 0.
- A breakdown card renders below the tile grid only when there is at least one open exception, listing counts by kind.

### 5. Nav + copy
- `src/lib/nav.ts` — new group **«العمليات»** with `/escalations` (icon `ShieldAlert`, perm `escalation.view_own`); page title added to `PAGE_TITLES`.
- `src/lib/copy.ts` — adds `empty.escalations`, `empty.exceptions`, and an `escalations` namespace with kind/status labels.

### 6. Tests
- `tests/business-minutes-between.test.mjs` — pure-JS port of the SQL function. **11 passed**, 0 failed (`bun run tests/business-minutes-between.test.mjs`). Covers same-day windows, identical/empty, before-open and after-close clamping, overnight Sun→Mon, weekend skip (Thu→Sun), pure-Friday window, full workdays, multi-day, exact edges.
- `tests/sla-watcher.test.mjs` — pure-JS port of `resolveMaxMinutes` + breach detection. **11 passed**, 0 failed. Covers override precedence, template-new, template-in-progress, global-rule fallback, null fallback, ready-to-send (15) and client-changes (480) values, plus breach edge cases (under, equal, over, null).
- `tests/playwright/escalations.spec.ts` — committed as a contract (Playwright runner not yet wired at the repo root). Two flows: owner opens-then-resolves a manual exception and dashboard surfaces the «تصعيدات مفتوحة» tile.

## Files created

- `supabase/migrations/0025_decisions_escalations.sql`
- `supabase/functions/sla-watcher/index.ts`
- `src/app/(dashboard)/escalations/page.tsx`
- `src/app/(dashboard)/escalations/_actions.ts`
- `src/app/(dashboard)/escalations/escalations-toolbar.tsx`
- `src/app/(dashboard)/escalations/resolve-exception-inline.tsx`
- `src/app/(dashboard)/escalations/acknowledge-button.tsx`
- `src/app/(dashboard)/escalations/task-exception-badge.tsx`
- `tests/business-minutes-between.test.mjs`
- `tests/sla-watcher.test.mjs`
- `tests/playwright/escalations.spec.ts`
- `docs/phase-T5-report.md`

## Files modified

- `src/lib/nav.ts` — adds `/escalations` route under «العمليات» + `PAGE_TITLES` entry.
- `src/lib/copy.ts` — adds `empty.escalations`, `empty.exceptions`, `escalations.*` namespace.
- `src/app/(dashboard)/tasks/[id]/page.tsx` — imports `TaskExceptionBadge`, adds the open-exception lookup and renders the badge above the existing delay banner (read-side only).
- `src/app/(dashboard)/dashboard/page.tsx` — adds the open-exceptions count query, the new metric tile, and the breakdown card.

## Files deliberately NOT touched

Per dispatch scope rules:
- `src/app/(dashboard)/tasks/_actions.ts` (T2/T3 territory) — the badge is a read-side addition only.
- `src/app/(dashboard)/projects/[id]/...`, `projects/new/...`, `service-categories/...` — T4's territory.
- `src/lib/supabase/types.ts` — orchestrator regenerates after migrations are applied.
- `supabase/migrations/0026*` (T7) and `0026b*` (T7.5).
- Any `contracts/` AM dashboard files (T7.5) and any `renewal_cycles` code (T7).

## How to verify (post-apply)

1. Owner runs `apply_migration` against 0025 → seeds + RLS land.
2. Deploy the edge function: `supabase functions deploy sla-watcher` and add a 5-min cron schedule.
3. Visit `/escalations` as the owner — empty state appears (no exceptions yet).
4. Open any task in the dashboard, click "فتح استثناء", choose a kind + reason, submit → red "استثناء مفتوح" badge appears at the top of the task detail; `/escalations` lists the row.
5. Click "إغلاق الاستثناء" inline, add a note, submit → row flips to "مغلق", badge disappears from task page.
6. To smoke-test the watcher, pick a task currently in `manager_review`, manually update `tasks.stage_entered_at` to e.g. 35 min ago in business hours, invoke the function (`curl <project>.functions.supabase.co/sla-watcher`) → a `deadline` exception appears, an `escalations` row to the team-lead, a `notifications` row of type `SLA_BREACHED`, and an `ai_events` row.
7. Dashboard tile "تصعيدات مفتوحة" reflects the live count and the breakdown card appears.

## Screenshot notes

- `/escalations` page: top counts strip (4 kinds) → toolbar (filter by kind) → "الاستثناءات" section → "التصعيدات" section.
- Task detail: red badge + "فتح استثناء" button stack lives between the page header and the existing delay banner.
- Dashboard: tile sits at the end of the metric grid; the breakdown card only renders when count > 0 and uses an `cc-red`-tinted border.

## Open follow-ups (not in T5 scope)

- The team-lead resolver in the watcher walks `service.default_department_id`. If/when tasks gain an explicit `department_id`, switch the resolver to the direct path — flagged for T6.
- The exceptions RLS predicate references `task_assignees`, `task_followers`, `employee_profiles`. These tables already have their own tight policies post-T2/T3, so the join is safe. If a future migration changes any of them, re-verify with the `tests/rls-attack.test.mjs` smoke against `exceptions`.
- `business_minutes_between` is `STABLE` (timezone arithmetic with `Asia/Riyadh` is not deterministic across tzdata refreshes). If we ever need to back-compute in a generated column, we'd anchor it the same way 0023 did with `(col at time zone 'UTC')::date`. Not needed today.
- The watcher's notification body is plain Arabic; we could template it via `wa_message_templates` once T8 (WhatsApp) lands.
