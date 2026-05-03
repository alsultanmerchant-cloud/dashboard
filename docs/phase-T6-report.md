# Phase T6 — Governance Enforcement — report

**Status:** shipped (DB migration + edge function + UI + action gate + tests).
**Did NOT touch:** `src/lib/supabase/types.ts`, `bun run build`, any other migration, any other phase's files.

## What shipped

### Migration (`supabase/migrations/0027_governance.sql`)
- New table `governance_violations` with `kind` check constraint over the four owner-spec kinds: `missing_log_note`, `stage_jump`, `unowned_task`, `permission_breach`.
- Indices: open-only by org, by task, by kind, and `(task_id, kind)` partial-open for the watcher's dedupe lookup.
- RLS on, with split INSERT/UPDATE/DELETE policies (Wave-2 lesson — no `FOR ALL`).
- 1-arg `has_permission(text)` overload everywhere (Wave-2 lesson).
- New permission keys seeded: `governance.view`, `governance.resolve`.
- Role grants: `governance.view` → owner + admin + manager (= Head per `0006_seed.sql`); `governance.resolve` → owner + admin only.

### Server-action gate (`src/app/(dashboard)/tasks/_actions.ts`)
- Extended `moveTaskStageAction` only — added a fresh-comment requirement after the existing per-edge gating block (after line 202) and before the DB update.
- Bypass set is unchanged: `session.isOwner || session.permissions.has("task.view_all")` — owners, admins, managers and AMs (the same set the DB trigger honors) skip the new gate.
- For everyone else, the action queries `task_comments` filtered by `task_id`, `author_user_id = session.userId`, `created_at >= now() - 5 min`. Missing → `{ error: "يجب إضافة ملاحظة قبل نقل المرحلة" }`.

### Edge function (`supabase/functions/governance-watcher/index.ts`)
- Daily 06:00 Asia/Riyadh (cron set externally — NOT yet deployed; documented in the file header).
- Service-role Supabase client, mirrors `sla-watcher/index.ts` style.
- For each org: opens `missing_log_note` for tasks with no `task_comments` in the last 7 days; opens `unowned_task` for tasks with no `task_assignees` row.
- Per-task / per-kind dedupe lookup against open `governance_violations` keeps the run idempotent. Resolved rows are NOT counted as duplicates — once a head closes a violation and the underlying gap persists, the next run reopens.
- No `deno.json` was created because `sla-watcher` does not have one either; the spec explicitly said "copy from sla-watcher if present".

### UI
- `src/app/(dashboard)/governance/page.tsx` — server component, RTL, 4 tile-by-kind summary + open-violations list. Page-level gate via `requirePagePermission("governance.view")`.
- `src/app/(dashboard)/governance/_actions.ts` — `resolveViolationAction` gated on `governance.resolve`; sets `resolved_at`, `resolver_user_id`, optional `note`; writes `audit_log` (`governance.resolve`) and `ai_event` (`GOVERNANCE_VIOLATION_RESOLVED`); revalidates `/governance` and `/dashboard`.
- `src/app/(dashboard)/governance/resolve-violation-inline.tsx` — small client form, mirrors `escalations/resolve-exception-inline.tsx`.
- `src/lib/data/governance.ts` — `getOpenViolations`, `getOpenViolationCounts`, `countOpenViolations`, kind constants and Arabic labels.
- `src/lib/nav.ts` — added `/governance` under "العمليات" with `perm: "governance.view"`, plus the `PAGE_TITLES` entry.
- `src/app/(dashboard)/dashboard/page.tsx` — additively appended a single "مخالفات حوكمة" `MetricCard` to the existing grid (after the T5 escalations tile). Did NOT rewrite the layout.

### Tests (`tests/governance.test.mjs`)
- 17 contract assertions, all passing under `bun run tests/governance.test.mjs`. Covers: migration table + kinds + split-write RLS + 1-arg `has_permission` + permission keys + role grants; the Arabic error string + 5-min window + `task_comments` query in the actions file; both kinds + service-role + dedupe-on-resolved_at in the watcher; permission gates on the page and the resolve action.

## Deviations from spec

- **Spec calls the gate "transitionStage"; actual function is `moveTaskStageAction`.** Extension applied to the actual name as the dispatch instructed.
- **Watcher cron is NOT deployed.** The dispatch said this was acceptable; the schedule is a header-comment in the function for the orchestrator to wire up via Supabase scheduler / pg_cron later.
- **`stage_jump` and `permission_breach` violations have no auto-detector yet.** They're enumerated in the table's check constraint and surfaced as zero-tiles in the UI. The owner spec only required automated detection for `missing_log_note` and `unowned_task` (per AGENT_DISPATCH §T6).
- **Manager (= Head) gets `governance.view`, NOT `governance.resolve`.** Spec from owner says "head + admin" view, "admin" resolve. Owner is also granted both for completeness (single-tenant, super-admin behavior elsewhere in the codebase grants owner everything anyway via the `isOwner` short-circuit in `auth-server.ts`).

## Pending / not in scope here

- pg_cron / supabase scheduler entry for `governance-watcher` (orchestrator).
- Type regeneration in `src/lib/supabase/types.ts` (orchestrator).
- `bun run build` (orchestrator).
- Playwright contract for "transition without log note → blocked" — the existing playwright suite is committed-as-contract but not running in CI yet (T0 carry-over waiver per HANDOFF §3). The pure-Bun contract test asserts the gate strings instead.

## Known gotchas

- The fresh-comment gate fires for *all* non-bypass users, so any specialist/agent/team_lead is required to comment before moving a stage. Heads, admins, owners, AMs (`task.view_all` holders) skip — same set as the DB trigger.
- The watcher's "fail-closed on read errors" behavior means transient lookup failures suppress new inserts that run; that's the intended posture (avoid duplicate writes when state is uncertain). Revisit if the daily run starts producing zero rows mysteriously.
- `governance_violations.task_id` and `project_id` are nullable on purpose so future kinds (`permission_breach` against an org-level event) can land without a task.
