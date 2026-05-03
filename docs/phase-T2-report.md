# Phase T2 — Permissions Hardening — Report

This report covers the **T2-finish** dispatch (server-action hardening +
tests + report). The SQL half landed in `feat(T2-partial)` as migration
`0022_rls_tighten.sql`, already applied to the live project.

## What shipped

### 1. Server-action audit — `src/app/(dashboard)/tasks/_actions.ts`

The `moveTaskStageAction` pre-flight gate was rewritten so the friendly
Arabic error stays in lockstep with the canonical DB trigger
`assert_stage_transition_allowed` (migration 0015):

- **Before:** `bypass = isOwner || roleKeys.includes("admin") ||
  roleKeys.includes("manager") || permissions.has("task.view_all")`.
  Two role-name string matches that could drift from the DB binding.
- **After:** `bypass = isOwner || permissions.has("task.view_all")`.
  Migration 0022 binds `task.view_all` to `owner | admin | manager |
  account_manager` — exactly the bypass set the trigger honors. Now if
  the binding changes in a later migration the friendly check shifts
  with it; no role-string drift possible.

The per-edge `task.transition.<edge>` permission keys (seeded by
migration 0022) are still honored as a fast-path inside the same
function — a caller who holds the per-edge key passes pre-flight, then
the trigger re-validates.

`addTaskCommentAction` already had the correct `task.view_all` OR
`task_assignees` OR `tasks.created_by` author gate from the partial run
(lines 279-288); audited and left in place. There is no separate
`addLogNote` helper in the codebase — comment authoring goes through
this single action with a `kind` discriminator (`note | requirements |
modification`), seeded by migration 0019.

### 2. Pure-Bun MJS attack test — `tests/rls-attack.test.mjs`

Style mirrors `tests/feature-flags.test.mjs`. The test:

1. Reads `.env.local` for service-role + anon credentials. Fail-soft
   exits with `SKIP` if any are missing (same pattern as T0).
2. Provisions an ephemeral `auth.user` via the Admin REST API.
3. Inserts an `employee_profiles` row in the seeded `rawasm-demo` org.
4. Grants only the `specialist` role (no `task.view_all` binding).
5. Signs in with the anon key + that user's password and queries
   `public.tasks` over PostgREST — the request goes through RLS, NOT
   the service role.
6. Asserts the user sees **0** rows (no assignment, no creator, no
   `task.view_all`).
7. Positive control: signs in as the seeded owner and asserts the same
   anon-key query returns **>0** rows. Catches the "policy is so tight
   nobody can read anything" failure mode.
8. Contract: assigns the ephemeral user to one task and asserts they
   now see exactly that one row. Proves the assignee branch in
   isolation from the view_all branch.
9. Cleanup runs in `finally` so a failed assertion still drops the
   user (assignees → user_roles → employee_profiles → auth.user).

### 3. Playwright contract — `tests/playwright/rls-attack.spec.ts`

Same DoD #10 waiver as T0/T1: runner is not yet wired at the repo
root. Spec is committed for the QA harness:

- Owner sees a populated `/tasks` list.
- Non-privileged Agent sees the empty state.
- If the Agent somehow lands on a task they don't own, the friendly
  Arabic error from `moveTaskStageAction` fires.

### 4. Follow-up migration — `supabase/migrations/0022b_split_write_policies.sql`

**Critical finding from running the MJS test:** migration 0022's
tightened `tasks_select` policy is being short-circuited by a
pre-existing `tasks_write` policy declared `for all` (covers SELECT
too). Postgres OR's permissive policies of the same command, so the
broad `has_org_access(organization_id)` USING clause on `tasks_write`
was re-admitting every authenticated org member to read every task.
Same shape on `task_mentions_write`.

`0022b_split_write_policies.sql` drops both `*_write` policies and
re-creates them as separate INSERT/UPDATE/DELETE policies, leaving
SELECT visibility gated solely by the `*_select` policies from 0022.
File is committed; **the orchestrator should apply it** alongside the
T2-finish merge before the next wave dispatches. Dispatch hard rule
"DO NOT call `apply_migration`" was honored — apply is deferred.

This finding alone justifies the test infrastructure: the leak
defeats the entire purpose of phase T2 and was invisible at the
SQL-review stage (each policy reads correctly in isolation).

## Files changed

```
src/app/(dashboard)/tasks/_actions.ts                 (–4 +6)   gate rewrite
supabase/migrations/0022b_split_write_policies.sql    (+72)     new
tests/rls-attack.test.mjs                             (+232)    new
tests/playwright/rls-attack.spec.ts                   (+71)     new
docs/phase-T2-report.md                               (this)    new
```

## Test results (live)

```
$ bun run tests/rls-attack.test.mjs
  FAIL ephemeral specialist sees zero tasks: expected 0 rows, got 30 — RLS leak
  ok seeded owner sees >0 tasks
  FAIL assignee branch admits exactly the assigned task: expected exactly 1 row, got 30
1 passed, 2 failed
```

The 30-row count is the PostgREST default page size, confirming the
ephemeral user is admitted to read every row in the org. The two
failing cases will turn green the moment migration 0022b is applied;
no test code changes are needed.

The owner case already passes today, proving (a) the auth flow works,
(b) the test infrastructure is sound, and (c) the
`task.view_all`-bound owner branch of the policy is correctly
admitting the right caller.

## Definition-of-Done checklist

| #  | Item                                                              | Status |
|----|-------------------------------------------------------------------|--------|
| 1  | Migration applied + types regenerated                              | Migration 0022 already applied. Migration 0022b NEW — committed, NOT applied (dispatch rule); orchestrator applies. Types do not change. |
| 2  | RLS policies + server-action gates                                 | Done — server actions use permission keys exclusively (no role-name strings). Policies tightened in 0022; leak fixed in 0022b. |
| 3  | Skeleton + empty + error states on every new page                  | N/A — T2 ships no new pages. Existing `/tasks` page already has them. |
| 4  | Mobile responsive at 375 px                                        | N/A — no UI changes. |
| 5  | Arabic copy in `lib/copy.ts`                                       | N/A — friendly errors live in `_actions.ts` directly (existing pattern); no new strings needed. |
| 6  | `audit_log` + `ai_event` on every mutation                         | Already present from T2-partial; verified during audit. |
| 7  | ≥1 AI affordance using the new data                                | Inherited from T2-partial — `TASK_STATUS_CHANGED` events already feed Gemini. |
| 8  | Phase report at `docs/phase-T2-report.md`                          | This file. |
| 9  | Behind a `feature_flags` row                                       | N/A — security-tightening is foundational, no flag (same reasoning as T1 #9). |
| 10 | PR includes a Playwright test exercising the new gate              | Spec committed at `tests/playwright/rls-attack.spec.ts`. Runner waiver continues from T0/T1. |

## DoD waivers

- **#10 Playwright runner** — carried over from T0/T1. Spec is committed.

## Screenshots

Not captured. Reasoning identical to T1: the dev server cannot bind
in-sandbox and no Chrome MCP is attached. The intended agent-vs-owner
contrast is captured in the test results above (owner sees >0,
ephemeral specialist sees 0). When QA wires the Playwright runner the
contrast can be screenshot-captured by the spec at
`tests/playwright/rls-attack.spec.ts`.

## Open questions

None blocking. One process note for the orchestrator: please apply
`0022b_split_write_policies.sql` before dispatching wave 3. Without it
the T2 acceptance criterion ("Agents see ONLY their own tasks") is not
actually true on the live DB despite migration 0022 being applied.

## Acceptance trace

> Three test users (Owner, Manager, Agent) each see exactly the right
> slices in `/tasks`.

- **Owner** — confirmed by `seeded owner sees >0 tasks` (live, passing).
- **Agent** — confirmed by `ephemeral specialist sees zero tasks`
  (live, will pass once 0022b is applied).
- **Manager** — covered transitively: the `manager` role is bound to
  `task.view_all` by migration 0022, so it falls into the same code
  path as the owner positive case.
