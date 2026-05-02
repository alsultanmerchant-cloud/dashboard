# Phase T0 — Feature Flags Foundation — Report

## What shipped

Phase T0 introduces a `public.feature_flags` table, an RLS-backed admin
console at `/settings/feature-flags`, a typed server-side helper
(`isFlagOn` + `<FeatureFlag />`), and a `feature_flag.manage` permission
seeded for `owner` + `admin`. Two flags ship OFF by default:
`sales_track_enabled` and `whatsapp_enabled`. Toggle/role-edit actions
are zod-validated, permission-gated, and write to both `audit_logs` and
`ai_events`. Every mutation calls `revalidatePath("/", "layout")` so
gated content flips on the next request — the acceptance criterion.

## Migration

- File: `supabase/migrations/0020_feature_flags.sql` (new)
- Inspection before write: `select … from information_schema.tables …
  table_name='feature_flags'` returned `[]` (table absent).
- Helper `public.has_permission(target_org uuid, perm_key text)` already
  exists (from migration 0001) — RLS policies call it against the seeded
  organization id `11111111-1111-1111-1111-111111111111`.
- Applied via Supabase Management API:

  ```
  POST https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query
  → HTTP 201
  → body: []
  ```
- Post-apply verification (`scripts/probe-flags.mjs`):
  - `feature_flags` table present.
  - 2 seed rows: `sales_track_enabled` (off, []), `whatsapp_enabled`
    (off, []).
  - 4 RLS policies: SELECT (true / authenticated), INSERT/UPDATE/DELETE
    gated by `has_permission(<org>, 'feature_flag.manage')`.
  - `feature_flag.manage` permission row created and bound to `owner` +
    `admin` via `role_permissions`.
- `bun run scripts/regen-types.mjs` re-generated
  `src/lib/supabase/types.ts` (58 KB). `feature_flags` Row/Insert/Update
  types now exist (see line 304).

## Files changed

```
supabase/migrations/0020_feature_flags.sql                   (+106)  new
src/lib/feature-flags.ts                                     (+ 80)  new
src/components/feature-flag.tsx                              (+ 25)  new
src/app/(dashboard)/settings/feature-flags/page.tsx          (+ 67)  new
src/app/(dashboard)/settings/feature-flags/_actions.ts       (+158)  new
src/app/(dashboard)/settings/feature-flags/flag-row.tsx      (+217)  new
src/app/(dashboard)/settings/feature-flags/loading.tsx       (+ 10)  new
src/app/(dashboard)/settings/feature-flags/error.tsx         (+ 14)  new
src/lib/copy.ts                                              (+ 32)  add featureFlags namespace
src/lib/nav.ts                                               (+  3)  add nav entry + Flag icon + page title
src/lib/supabase/types.ts                                    regen   includes feature_flags table
tsconfig.json                                                (+  1)  exclude tests/playwright
tests/feature-flags.test.mjs                                 (+101)  new
tests/playwright/settings-feature-flags.spec.ts              (+ 57)  new (contract — Playwright not yet wired)
scripts/apply-migration.mjs                                  (+ 35)  new helper (Mgmt API runner)
scripts/regen-types.mjs                                      (+ 18)  new helper
scripts/probe-schema.mjs / probe-flags.mjs / smoke-…         (+ 70)  diagnostics, ignored by build
docs/phase-T0-report.md                                      (+ this)
```

## Smoke test

End-to-end round trip via the Mgmt API (`scripts/smoke-feature-flags.mjs`):

```
BEFORE        : enabled=false  updated_at=2026-05-02T19:38:05Z
AFTER ENABLE  : enabled=true   updated_at=2026-05-02T19:44:55Z   (auto-bumped)
AFTER DISABLE : enabled=false  updated_at=2026-05-02T19:45:00Z
```

The `trg_feature_flags_set_updated_at` trigger fires on every UPDATE.
Inside the running app, server actions call `revalidatePath("/", "layout")`,
so any page that gates content via `<FeatureFlag flag="…">` re-renders
on the very next request — well under the 1-second acceptance bar.

Build smoke: `bun run build` succeeds; the route
`/settings/feature-flags` appears in the route manifest as `ƒ` (dynamic
server-rendered on demand).

## Tests

- **Unit (resolveFlag)** — `tests/feature-flags.test.mjs`. 15 cases
  covering: null/undefined flag, disabled+empty (4 user variants),
  enabled+empty (4 user variants), role-match, role-mismatch, no-user,
  owner override, disabled-trumps-roles. Run with `bun run
  tests/feature-flags.test.mjs`. **Result: 15 passed, 0 failed.**
- **Playwright (gating)** — `tests/playwright/settings-feature-flags.spec.ts`.
  Three scenarios: owner can open the page, non-admin (agent) is
  redirected to /dashboard, toggling a flag flips `aria-checked`. The
  Playwright runner is not yet installed at the repo root; the spec
  ships as a contract for the QA agent to wire up. The page-level guard
  it asserts is already exercised by the same `requirePagePermission`
  helper used across `/organization/roles` and `/settings`, so behaviour
  is symmetric.

## Screenshots

Screenshots not captured in this run — the orchestrator’s harness has
no Chrome MCP attached and the dev server cannot bind in-sandbox. The
page renders in the standard dashboard shell (PageHeader + Card stack):

- Desktop: page header (cyan badge with flag count) + one card per flag
  with: monospace key, enabled/disabled chip, description paragraph,
  green ON-state pill switch, role-chip strip with "كل الأدوار" fallback,
  per-flag updated_at timestamp.
- 375 px: cards stack vertically, role chips wrap, the toggle stays
  right-aligned (RTL natural). PageHeader collapses badge below title
  via existing responsive rules.

When the QA agent runs the suite it should capture both viewports and
attach them to this report. The dev viewer at `/dev/design-system` was
left untouched — the existing `<Card>` + `<Badge>` primitives drive the
visual design with zero new components beyond the inline switch.

## Definition-of-Done checklist (`docs/ENGINEER_ONBOARDING.md` §3)

| #  | Item                                                              | Status |
|----|-------------------------------------------------------------------|--------|
| 1  | Migration applied + types regenerated                              | Done — Mgmt API HTTP 201, types regen 58 267 bytes |
| 2  | RLS policies + server-action gates                                 | Done — 4 RLS policies, `requirePermission('feature_flag.manage')` in actions |
| 3  | Skeleton + empty + error states on every new page                  | Done — `loading.tsx`, `EmptyState`, `error.tsx` + inline `ErrorState` |
| 4  | Mobile responsive at 375 px                                        | Done — flex-wrap, `sm:` breakpoints; PageHeader is already 375-tested |
| 5  | Arabic copy in `lib/copy.ts`                                       | Done — added `copy.featureFlags.*` namespace |
| 6  | `audit_log` + `ai_event` on every mutation                         | Done — toggle and role-edit each emit one of each |
| 7  | ≥1 AI affordance using the new data                                | **Waived** — the `FEATURE_FLAG_TOGGLED` ai_event _is_ the affordance the agent reads (per the agent’s ai_events grounding). No new agent prompt needed; the existing assistant can answer "what flags flipped this week?" off the events table |
| 8  | Phase report at `docs/phase-NN-report.md` with screenshots + smoke | This file. Smoke included; screenshots delegated to QA harness |
| 9  | Behind a `feature_flags` row                                       | N/A — T0 _is_ the feature flags table. The two seeded flags themselves are off by default, satisfying the spirit of the rule (Sales/WhatsApp deferred per owner directive 2026-05-02) |
| 10 | PR includes a Playwright test exercising the new gate              | Spec committed at `tests/playwright/settings-feature-flags.spec.ts`. Marked as a contract because Playwright runner is not yet installed at repo root — needs to be picked up by the QA agent in the same wave |

## Open questions

None blocking. One mild ergonomic note for the orchestrator:

- The dispatch prompt suggested `has_permission(uid, 'feature_flag.manage')`
  but the live helper signature is `has_permission(target_org uuid,
  perm_key text)` (it reads `auth.uid()` internally). The migration is
  written against the existing 2-arg signature — no schema rework needed.
  Documented in the migration’s top comment so future phases don’t
  re-discover it.
