# Handoff — Live-Odoo agent, continue here

**As of orchestrator commit `d51caf7` on `main`.** Read this whole file before your next task.

---

## 1. What's already on `main` (don't redo)

The orchestrator just landed Wave 5a + 5b in commit `d51caf7`:

- **4 edge functions deployed + cron'd** via pg_cron + pg_net:
  `sla-watcher` (every 5m), `governance-watcher` (daily 06:00 Riyadh), `renewal-scheduler` (daily 06:05 Riyadh), `monthly-cycle-roller` (1st of month 06:00 Riyadh), `weekly-digest` (Sun 07:00 Riyadh).
- **Migration `0029_reporting_views.sql`** applied. 4 views + `weekly_digest_runs` table.
- **`/dashboard`** has 4 new KPI tiles (rework, on-time, productivity, review backlog) — additive to the existing hero grid.
- **`/reports`** promoted from placeholder to 4 sections + AI summary button + digest preview.
- New files you must NOT touch: `supabase/migrations/0029*`, `supabase/functions/weekly-digest/`, `src/lib/data/reports.ts`, `src/app/(dashboard)/reports/_actions.ts`, `src/app/(dashboard)/reports/summarize-week-button.tsx`, `tests/reporting-views.test.mjs`, `docs/phase-T9-report.md`, `docs/phase-edge-deploy-report.md`.

The `/dashboard` and `/reports` pages were edited too — your edits and the orchestrator's are now both committed. If you need to touch either, **rebase your local edits on top, do not overwrite**.

---

## 2. Architecture (recap of the Option C decision)

**Odoo = display source of truth.** You own this layer:
- `src/lib/odoo/live.ts` — server-only fetchers wrapping `OdooClient.searchRead()`
- `/api/odoo/{projects, clients, tasks, employees}` — route handlers
- The 4 display pages: `clients/page.tsx`, `projects/page.tsx`, `tasks/page.tsx` (list), `employees/page.tsx`

**Supabase = reactive + dashboard-native data.** Orchestrator owns this layer:
- All migrations, edge functions, the reactive layer (SLA/governance/renewals/monthly-cycle/weekly-digest)
- All the dashboard-native tables: `notifications`, `ai_events`, `sla_rules`, `exceptions`, `escalations`, `governance_violations`, `weekly_digest_runs`, `contracts`, `monthly_cycles`, `renewal_cycles`, `permissions`, `roles`, `user_roles`
- The Supabase tables `tasks`, `projects`, `clients`, `employee_profiles` exist but are dormant — stay populated only when a user creates something natively in the dashboard. **Do not read from them in your live-Odoo path.** Pages that DO read from them (task detail with comments/assignees, project detail, governance, SLA dashboards) keep working — they just stay empty until native data exists.

**The importer (`src/lib/odoo/importer.ts`, `scripts/sync-odoo.ts`) is dead.** Don't run it, don't extend it, don't delete it (parking lot).

---

## 3. Hard rules (do NOT violate, these have cost real time)

Pulled verbatim from `docs/HANDOFF.md` §2 — applies to you the same as it applies to the orchestrator.

### 3.1 Branch hygiene
- Work directly on `main`. No feature branches, no PRs.
- Commit when a logical chunk is green. Commit message format like `feat(odoo-live): <what>`.
- **Never push** unless the user explicitly asks. The user pushes.
- If you find changes you didn't make in your tree, **don't clean or stash them** — orchestrator may have left them. Stop and ask.

### 3.2 File ownership — your lane
**Your files (you own, edit freely):**
- `src/lib/odoo/client.ts`, `src/lib/odoo/live.ts`, `src/lib/odoo/types.ts` (if any)
- `src/app/api/odoo/**` — route handlers
- `src/app/(dashboard)/clients/page.tsx`, `projects/page.tsx`, `tasks/page.tsx`, `employees/page.tsx` — list pages
- Any new test files under `tests/odoo-*.test.mjs`

**MUST NOT TOUCH:**
- `supabase/migrations/**` (orchestrator territory)
- `supabase/functions/**` (orchestrator territory)
- `src/lib/supabase/types.ts` (generated)
- `src/lib/data/reports.ts`, `src/lib/data/governance.ts`, `src/lib/data/renewals.ts`, `src/lib/data/contracts.ts`, `src/lib/data/sla*.ts` — orchestrator's reactive-layer loaders
- `src/app/(dashboard)/reports/`, `governance/`, `escalations/`, `contracts/`, `am/[id]/`, `projects/[id]/renewals/` — orchestrator's pages
- `src/app/(dashboard)/dashboard/page.tsx` and `src/components/layout/topbar.tsx` if a future orchestrator phase touches them — coordinate first.
- The Odoo importer files (parking lot)

If you discover you need to cross the line, write a question to `docs/phase-odoo-questions.md` and stop.

### 3.3 Other invariants
- Arabic-only UI, RTL, mobile-responsive at 375px.
- Never commit secrets. `.env.local` is real; `.env.example` is the template.
- Never regenerate `src/lib/supabase/types.ts`.
- Never apply migrations.

---

## 4. T3.5 — head per-employee task filters (now your scope)

T3.5 used to be the orchestrator's queue item, but since you now own the `/tasks` list page and that page reads from `/api/odoo/tasks`, the filter implementation lives in your lane.

**Spec:** `docs/phase-T3.5-filters.md`. Five filters from the owner's verbatim Arabic feedback. Recommended: ship #1, #2, #3a (no schema needed) first; defer #4 + #5.

How to implement:
- Extend `/api/odoo/tasks` to accept query params: `directReportsOf=<employee_id>`, `notRedistributed=<bool>`, plus whatever #3a needs.
- The filter resolves to an Odoo domain expression (Odoo's RPC domain DSL) — push the filter down to Odoo, not in TS.
- Show the filter chips in `tasks/page.tsx` only for users whose role is `manager` (= head). Use `getServerSession()` from `src/lib/auth-server.ts` to gate.
- For "direct reports of <head>" you need an employee→manager mapping. In Odoo that's `hr.employee.parent_id`. Fetch once via `/api/odoo/employees?managerOf=<id>` and pass the resulting employee IDs into the tasks domain.

---

## 5. The dormant-reactive-layer gap (owner-pending)

Because you don't mirror Odoo data into Supabase, the reactive layer the orchestrator just shipped (SLA watcher, governance watcher, weekly digest, T9 reporting) **only fires for tasks/projects that are natively created in the dashboard**. Existing Odoo data won't trigger any of it.

The owner has been told. They may decide to either:
- (a) Accept dormant state; reactive layer grows as native usage grows.
- (b) Ask the orchestrator to build a thin "mirror sync" layer — when you fetch an Odoo task, the orchestrator's hook upserts a minimal mirror row keyed by `external_source='odoo' + external_id` (column already in migration 0011).
- (c) Re-implement the reactive layer to read live Odoo.

If the owner picks (b), the orchestrator will need a hook point in your `src/lib/odoo/live.ts` — you'll be asked to export the per-entity fetcher functions plainly so the orchestrator can wrap them. Don't pre-build this; wait for the owner's call. But **do design `live.ts` as plain exported async functions, not class methods**, so wrapping is trivial later.

---

## 6. Pre-flight before your next task

1. `git status --short` → should show your uncommitted edits to `agent/page.tsx`, `topbar.tsx`, `clients/page.tsx`, `projects/page.tsx`, plus your new `src/app/api/odoo/`, `src/lib/odoo/live.ts`. Plus possibly `tasks/page.tsx`, `employees/page.tsx` from your in-flight work.
2. `git log --oneline -3` → top should be `d51caf7 feat(T9+5a): reporting views, weekly digest, edge fns deployed`.
3. **Build state:** the user reported a pre-existing build error on `/dev/design-system` (`useAuth outside AuthProvider`). Confirm whether your changes regressed anything else. If `bun run build` shows errors only in `/dev/design-system`, that's not yours.
4. **Tests:** `bun test tests/` — all 11 pre-existing files + the 1 new T9 file (`reporting-views.test.mjs`, 21 assertions) should pass. None of those touch live Odoo, so your changes shouldn't affect them.

---

## 7. Where to leave things at end-of-shift

When you finish your current chunk (4 routes + 4 pages), commit it as one chunk:

```
feat(odoo-live): swap clients/projects/tasks/employees lists to live Odoo

- src/lib/odoo/live.ts: server-only fetchers
- /api/odoo/{projects,clients,tasks,employees}: route handlers
- 4 display pages updated to consume live data
- Importer left in place (parking lot)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then write a short report at `docs/phase-odoo-live-report.md` covering:
- What's wired (which pages live-Odoo, which still Supabase-native)
- Performance notes (latency on a cold Odoo call)
- Any TODO/FIXME you left in the code
- T3.5 status (deferred for next chunk, or already shipped here)
- Whether the dormant-reactive-layer gap (§5) was raised again with the owner

Do NOT push. The user pushes.

---

## 8. Standing rules from the user

- **Ship and ask, not ship and hope.** Surface every unclear decision via a `phase-*-questions.md` doc.
- Owner gave verbatim Arabic feedback on head-of-department filters; preserved in `docs/phase-T3.5-filters.md`. Don't paraphrase — implement what's literally there.
- Smoke the UI manually each chunk (login, click, screenshot). Playwright suite committed-as-contract but not running yet.
- Single-tenant. Sky Light only. Never justify code with "for tenants later."

Good luck. Stay in your lane. Ask early.
