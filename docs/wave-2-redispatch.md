# Wave 2 — Re-dispatch prompts

Three agents to fire after the 2am Cairo usage reset. Wave-2 first attempt aborted due to usage cap. T2's migration was salvaged and applied (see commit `fff4bff`); the rest is open.

**Common dispatch boilerplate (every agent gets this prefix):**

```
You are an engineering agent on the Sky Light dashboard project at
/Users/mahmoudmac/Documents/projects/mr-dashboard. Working directly on
the `main` branch — no feature branch, no PR. Commit once when done with
the message specified at the bottom. Do NOT push.

Required reading before writing any code:
  - CLAUDE.md
  - docs/ENGINEER_ONBOARDING.md
  - docs/ENGINEERING_PLAN.md (your phase section)
  - docs/SPEC_FROM_OWNER.md
  - docs/SPEC_FROM_PDF.md
  - docs/DECISIONS_LOG.md
  - docs/AGENT_DISPATCH.md  (esp. State-of-schema preamble + the
                              tasks-schema reality block)
  - docs/phase-T0-report.md, docs/phase-T1-report.md
  - the migration file(s) listed under "schema context" below

Hard rules:
  - SUPABASE MCP: use `mcp__supabase__list_tables` / `execute_sql` /
    `list_migrations` for inspection. The `mcp__supabase__*` server is
    correctly bound to project `vghokairfpzxcciwpokp` (Rawasm).
    DO NOT use `mcp__supabase-bookitfly__*` (different project).
  - DO NOT call `mcp__supabase__apply_migration`. The orchestrator
    applies migrations after the wave commits.
  - DO NOT regenerate src/lib/supabase/types.ts.
  - DO NOT run `bun run build`.
  - has_permission has TWO overloads: `has_permission(target_org uuid,
    perm_key text)` and `has_permission(perm_key text)`. Use the 1-arg
    overload for global-scope policies.
  - Arabic-only UI. RTL. Mobile responsive at 375px.
  - Every mutation: zod validate → check user → check org scope →
    audit_log + ai_event when relevant.
  - Update `src/lib/nav.ts` if your phase ships a new top-level page.
  - If owner intent is unclear, STOP and write a question to
    docs/phase-T{N}-questions.md.
```

---

## T2-finish — server-action hardening + tests + report

**Scope:** finish what `feat(T2-partial)` started. The migration (0022) is already applied. Only the non-SQL deliverables remain.

**File ownership:**
- `src/app/(dashboard)/tasks/_actions.ts` (existing — HARDEN, don't refactor unrelated code)
- `tests/rls-attack.spec.ts` (CREATE)
- `tests/rls-attack.test.mjs` (pure-Bun MJS variant — see T0/T1 pattern)
- `docs/phase-T2-report.md` (CREATE)

**Schema context:** `tasks.created_by` is the owner column; assignments via `task_assignees` join + `employee_profiles.user_id`. Permission keys already seeded in 0022: `task.view_all` plus `task.transition.{specialist_to_manager_review|manager_to_specialist_review|specialist_to_ready_to_send|ready_to_send_to_sent|sent_to_client_changes|client_changes_to_done}`.

**Deliverables:**
1. Audit every action in `src/app/(dashboard)/tasks/_actions.ts`. For `transitionStage` (or whatever the move-stage helper is named — inspect first), replace any role-name string match with `has_permission(<task.transition.*>)`. The DB trigger `assert_stage_transition_allowed` (from migration 0015) is the canonical enforcement; the server-side check is the friendly-error pre-flight. They must agree.
2. For `addLogNote` / comment-author paths: verify caller is on `task_assignees` for the parent task OR is `tasks.created_by` OR has `task.view_all`. Reject otherwise with an Arabic friendly error.
3. Pure-Bun MJS `tests/rls-attack.test.mjs` — log in as a seeded Agent (or create an ephemeral test user via service role), use the anon key to query `tasks` directly, expect zero rows for tasks where the user has no assignment + no creator role + no `task.view_all` permission. Mirror the `tests/feature-flags.test.mjs` style.
4. `tests/playwright/rls-attack.spec.ts` — committed as a contract (Playwright runner is still not wired; T0 carry-over).
5. `docs/phase-T2-report.md` — what shipped, what was waived (DoD #10 Playwright-runner waiver continues), screenshot of the agent-vs-owner task list contrast.

**Commit:** `feat(T2-finish): action gates + RLS attack tests`

---

## T3 — Task Workflow PDF Gaps

**Scope:** close every row in `docs/SPEC_FROM_PDF.md §13`.

**File ownership:**
- `supabase/migrations/0023_task_pdf_gaps.sql` (CREATE)
- `src/app/(dashboard)/tasks/[id]/...` (task detail UI changes)
- `src/app/(dashboard)/projects/[id]/...` (project HOLD ribbon — NOT `/projects/new` which T4 owns)
- `src/lib/data/task-detail.ts` (or similar — for stage-history reads)
- new server actions for followers + project hold under `_actions.ts` files in the route folders
- `tests/playwright/task-followers.spec.ts`, `tests/playwright/project-hold.spec.ts`
- `tests/task-delay-days.test.mjs`
- `src/lib/nav.ts` (only if you add a new top-level page; followers + hold are nested, so likely no nav change)

**Must NOT touch:** `src/app/(dashboard)/tasks/_actions.ts` (T2's), `src/app/(dashboard)/projects/new/...` (T4's), `src/app/(dashboard)/service-categories/...` (T4's), `src/lib/supabase/types.ts`.

**Schema reality:** `projects.hold_reason` and `projects.held_at` already exist (migration 0019). DO NOT re-add. `task_comments.kind` enum already exists (0019). The current `tasks_select` policy (just shipped in 0022) does NOT include followers — your migration drops + re-creates it adding the followers branch.

**Deliverables:**

1. `supabase/migrations/0023_task_pdf_gaps.sql`:
   ```sql
   ALTER TABLE public.tasks
     ADD COLUMN IF NOT EXISTS delay_days INTEGER GENERATED ALWAYS AS (
       CASE WHEN status='done' AND deadline IS NOT NULL AND completed_at IS NOT NULL
            THEN GREATEST(0, EXTRACT(DAY FROM completed_at - deadline)::INT)
       END
     ) STORED,
     ADD COLUMN IF NOT EXISTS hold_reason TEXT,
     ADD COLUMN IF NOT EXISTS hold_since TIMESTAMPTZ;

   CREATE TABLE IF NOT EXISTS public.task_followers (
     task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     added_by UUID REFERENCES auth.users(id),
     added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (task_id, user_id)
   );
   ALTER TABLE public.task_followers ENABLE ROW LEVEL SECURITY;
   -- SELECT: anyone in the org who can see the parent task
   -- INSERT/DELETE: caller is task creator OR has task.view_all
   ```
   Then DROP and re-CREATE `tasks_select` to add the follower branch:
   ```sql
   DROP POLICY IF EXISTS tasks_select ON public.tasks;
   CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
   USING (
     public.has_org_access(organization_id) AND (
       public.has_permission('task.view_all')
       OR tasks.created_by = auth.uid()
       OR EXISTS (SELECT 1 FROM public.task_assignees ta
                  JOIN public.employee_profiles ep ON ep.id = ta.employee_id
                  WHERE ta.task_id = tasks.id AND ep.user_id = auth.uid())
       OR EXISTS (SELECT 1 FROM public.task_followers tf
                  WHERE tf.task_id = tasks.id AND tf.user_id = auth.uid())
     )
   );
   ```
   For `project_status` enum: inspect first; if `hold` is missing AND the column is an enum (not text), add it via `ALTER TYPE … ADD VALUE`. Otherwise key UI off `projects.held_at IS NOT NULL`.

2. New server actions:
   - `addFollower(taskId, userId)` / `removeFollower(taskId, userId)` — gate on creator or `task.view_all`.
   - `setProjectHold(projectId, reason)` writes `hold_reason + held_at = now()`.
   - `resumeProject(projectId)` clears both.
   - All audit_log + ai_event.

3. UI:
   - Task detail: "تاريخ المراحل" tab (surface `task_stage_history`), "متابعون" section (followers), red banner "متأخر بـ N يوم" when `delay_days > 0`.
   - Project box: red HOLD ribbon when `held_at IS NOT NULL`, with reason on hover.
   - Log Note attachments via Supabase Storage (verify existing bucket; surface as a question if not configured).

4. Tests + phase report (`docs/phase-T3-report.md`). Flip every row in `docs/SPEC_FROM_PDF.md §13` to ✅ in the same commit.

**Commit:** `feat(T3): task workflow PDF gaps`

---

## T4 — Categories Engine

**Scope:** port Odoo's task-template engine. Selecting services on a new project auto-generates the right tasks with correct deadlines and assignees.

**File ownership:**
- `supabase/migrations/0024_categories_engine.sql` (CREATE)
- `scripts/import-odoo-categories.ts` (CREATE — READ-ONLY Odoo)
- `src/app/(dashboard)/projects/new/...`
- `src/app/(dashboard)/service-categories/...` (CREATE — admin page; ADD nav entry)
- `src/lib/projects/*` helpers
- offset-computation tests
- `src/lib/nav.ts` (ADD `/service-categories` entry under "العملاء والمشاريع" group, gated by `category.manage_templates` perm; topbar entry in PAGE_TITLES too)

**Must NOT touch:** `src/app/(dashboard)/tasks/_actions.ts`, `src/app/(dashboard)/tasks/[id]/...`, any tasks RLS, `src/app/(dashboard)/projects/[id]/...`, `src/lib/supabase/types.ts`.

**Schema reality:** `task_templates` and `project_services` and `task_template_items` already exist (rows present). ALTER, do not recreate.

**Deliverables (full spec in docs/AGENT_DISPATCH.md T4 section):**

1. `0024_categories_engine.sql`:
   - `service_categories` table per-org keyed by `(organization_id, key)`
   - ALTER `task_templates` to add `category_id`, `default_owner_position`, `deadline_offset_days`, `upload_offset_days`, `default_followers_positions[]`, `depends_on_template_id`, `sla_minutes_new`, `sla_minutes_in_progress`
   - ALTER `project_services` to add `category_id`, `week_split`, `weeks`
   - RLS on `service_categories` with `has_permission('category.manage_templates')` (1-arg)
   - Seed `category.manage_templates` perm bound to admin + manager (head)

2. `scripts/import-odoo-categories.ts` — read project.category (13) + project.category.task (279) READ-ONLY from live Odoo, dry-run dumps `tmp/categories-diff.csv`, `--commit` flag for actual writes.

3. Extend the `createProject` server action — expand selected `project_services` into tasks via `task_templates`. Match deadline computation to the existing handover engine convention. Wrap in transaction.

4. UI: `/projects/new` with multi-select chips + preview pane + week-split toggle. `/service-categories` admin page (drag-to-reorder). Both with skeleton/empty/error.

5. Update `src/lib/nav.ts`:
   ```ts
   { label: "تصنيفات الخدمات", href: "/service-categories", icon: <pick from lucide>, perm: "category.manage_templates" }
   ```
   plus `PAGE_TITLES["/service-categories"]`.

6. Tests + phase report (`docs/phase-T4-report.md`).

**Commit:** `feat(T4): categories engine`

---

## After all three commit

Orchestrator runs:
```bash
# Apply migrations in order via mcp__supabase__apply_migration
#   - 0023_task_pdf_gaps
#   - 0024_categories_engine
# Regen types
node scripts/regen-types.mjs
# Smoke
bun run build
# Run all *.test.mjs in tests/
```

Then dispatch Wave 3: T5 ‖ T7 ‖ T7.5.
