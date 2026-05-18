# Sky Light Adjustments — Single Agent Prompt

Paste everything below the `---` line into Claude Code (or any coding agent)
inside the `mr-dashboard` repo to start the work.

---

You are the implementation lead for the **mr-dashboard** project at
`/Users/mahmoudmac/Documents/projects/mr-dashboard`. Your job is to land
**15 client-requested adjustments** from the Sky Light agency, organized
into 9 PRs across 3 waves. Work iteratively: ship Wave 1 in parallel,
verify, then move to Wave 2, then Wave 3.

## Step 0 — Load context (do this before touching code)

Read these files in order, fully:

1. `CLAUDE.md` — project rules, stack, working rules, single-tenant info,
   migration patterns, owner test account.
2. `docs/SKYLIGHT_FEEDBACK_2026-05-17.md` — the 15 client issues, each with
   the original Arabic quote, English translation, file paths, severity,
   and concrete action.
3. `docs/SKYLIGHT_EXECUTION_PLAN.md` — the 9 PR groups, file lists,
   dispatch waves, and the per-PR verification steps.

## Ground-truth references (don't guess — check these)

- **Live Rwasem Odoo:** `https://skylight.rwasem.com` (logged in as
  Administrator). The Tasks page at
  `https://skylight.rwasem.com/web#action=804&model=project.task&view_type=list&menu_id=582`
  is the canonical reference for "Open Tasks" default filter behavior.
  Project PRJ-01587 is the reference for "28 tasks vs 177" — open it and
  confirm the count.
- **Rwasem Odoo source addons:**
  `/Users/mahmoudmac/Documents/projects/skylight_addons-master/addons/17.0/`.
  Specifically:
  - `rwasem_menu_project/` — the Project module menu (Projects, Tasks,
    Project Category, Reporting, Configuration, Import Project).
  - `rwasem_project_task_progress/` — task progress field + kanban
    progress bar.
  - `aptuem_project_default_task/` — category → template → auto-create
    tasks engine (with working-calendar + dependency dates).
  - `project_customization/` — task view tweaks. Line 124 of
    `views/project_task.xml` shows the "Removed Open Tasks Filter" comment
    that proves the default filter is stock Odoo behavior they keep.
  - `rwasem_project_category_enhancements/` — project list/kanban changes.
  - `rwasem_task_bulk_update/` — task bulk-edit toolbar.

When in doubt about a behavior, open the matching screen in Rwasem and
look. Source code beats screenshots.

## Working rules (from CLAUDE.md — repeat for emphasis)

- Every mutation: **zod-validate → check user → check org scope →
  audit_log → ai_event (if business-relevant)**.
- Every screen: **skeleton + empty + error states; mobile responsive;
  RTL-correct; Tajawal font.**
- Migrations: **apply via `mcp__supabase__apply_migration` first, then
  mirror identical SQL to `supabase/migrations/NNNN_<snake>.sql`.**
  Idempotent (`if not exists`, `do $$ ... $$`, `or replace`). RLS read
  via `public.has_org_access`, write via
  `public.has_permission(org, '<perm_key>')`.
- Single-tenant org slug is `rawasm-demo`. Owner test account:
  `alsultain@agency.com` / `alsultain22`.
- Never commit secrets. `.env.local` has real keys.

## Execution plan

### Wave 1 — auto-merge after build+lint pass (run all 4 in parallel)

1. **PR-C — Task search flexibility** (issue #5)
   - Wire migration `0061`'s `search_tsv` (arabic config) to the visible
     search input on `/tasks`. Add `pg_trgm` similarity fallback for 1–2
     char queries. Debounced autocomplete.
2. **PR-E — Employee combobox** (issue #9)
   - New reusable `src/components/forms/employee-combobox.tsx` using
     shadcn `Command` primitive. Replace `<select>` at: task assignee,
     approver, specialist slots (migration `0049`), task delegations
     (migration `0039`), follower-add, HR forms.
3. **PR-F — Origin badge** (issue #3)
   - Surface `external_source` (migrations `0011`/`0040`) as a pill on
     Tasks list, Projects card, Clients list, Employees list. Add saved
     filter chip "Origin = Odoo / Dashboard".
4. **PR-G — Light-mode contrast pass** (issue #7)
   - Tailwind class sweep on `src/components/tasks/*` and kanban
     headers. Replace `text-muted-foreground` over tinted columns with a
     readable contrast token. Verify against the screenshot in
     `docs/SKYLIGHT_FEEDBACK_2026-05-17.md` issue #7.

After Wave 1: run `bun run build && bun run lint`. If clean, report a
diff summary back, then proceed to Wave 2.

### Wave 2 — gated review (3 PRs, run after Wave 1)

5. **PR-A — Tasks page coherent fix** (issues #1, #2, #13)
   - Default to "Open Tasks" saved filter on `/tasks` query state
     (mirror Rwasem's `search_default_my_open_tasks=1`). Render filter
     chip with count. Kanban headers show counts matching active domain.
     Add "Tasks without deadline" KPI tile (issue #13) in same toolbar.
   - Depends on PR-E for the combobox if any new pickers ship in the
     toolbar.
6. **PR-B0 — Importer field expansion** (issue #15)
   - `src/lib/odoo/importer.ts` line 953 `TASK_FIELDS` array is missing:
     `create_uid`, `write_uid`, `write_date`, `message_ids`,
     `message_follower_ids`, `parent_id`, `child_ids`, `depend_on_ids`,
     `dependent_ids`, `kanban_state`, `partner_id`. Add them all.
   - Stretch `OdooTask` type in `src/lib/odoo/types.ts`.
   - New migration `0064_odoo_task_sync_fields.sql` adding
     `created_by_employee_id` etc. on `tasks` (FKs to
     `employee_profiles`).
   - Add chatter back-fill: for each imported task with `message_ids`,
     upsert rows in `task_activities` keyed by Odoo message id
     (idempotent on `external_id`).
   - Run the same audit on `PROJECT_FIELDS`, `CLIENT_FIELDS`,
     `EMPLOYEE_FIELDS` and report missing fields back even if you don't
     fix them in this PR.
7. **PR-H — AI assistant data completeness** (issue #14)
   - `src/app/api/agent/route.ts`. Find every tool the Gemini agent
     calls that returns "tasks" — remove hidden `LIMIT`, force
     `order('deadline', { ascending: true })`, return `total_count` so
     the model can disclose truncation. Add a system-prompt rule:
     "when asked for oldest/earliest/all overdue tasks, sort by
     deadline asc and disclose if results were capped."
   - **Verification prompt:** "اقدم التاسكات المتأخرة" — must return all
     overdue tasks from months 1, 2, 3 in one response.

After Wave 2: smoke-test that the Activity Log on an Odoo-imported task
now shows historic chatter (proves PR-B0 worked). If clean, proceed to
Wave 3.

### Wave 3 — gated review (2 PRs, run after Wave 2)

8. **PR-B — Data correctness, dashboard side** (issues #4, #6)
   - Audit every `INSERT`/`UPDATE` writer under
     `src/app/(dashboard)/tasks/**` and confirm each writes to
     `audit_log` + `task_activities` per the CLAUDE.md working rule.
     Restore events for: comments, attachments, assignee changes,
     approval gates (migration `0048`), sub-task changes (migration
     `0056`), timesheets, links/dependencies (migration `0051`).
   - Fix project card task count to exclude archived: stock Odoo's
     `project.task_count` filters `active=True`. Mirror it. Verify
     PRJ-01587 shows **28** in our dashboard, not 177.
9. **PR-D — Org admin block** (issues #8, #10, #11, #12)
   - Migration `0065_employee_org_fields.sql` (or next available
     number): `employee_profiles.team_leader_employee_id` (nullable FK
     self), `employee_profiles.department_head_employee_id` (nullable
     FK self), cycle-prevention trigger (mirror migration `0051` deps
     pattern).
   - Edit form on `/organization/departments/[id]` (issue #12).
   - Edit form on `/task-templates/[id]` with `responsible_role_id`
     field and a "preview resolved assignees" panel (issue #10).
   - Org chart de-dup pass: collapse exact `name+role` duplicates in
     `/organization/chart`, fix seed migration `0043` going forward
     (issue #8).
   - Surface Team Leader + Department Head on employee list + detail
     (issue #11).

## How to report progress

After **each PR lands**, post a short status with:

- PR ID, files changed, migrations added.
- Screenshots for any UI change.
- One sentence verifying behavior against Rwasem (e.g. "PRJ-01587 now
  shows 28 Tasks in our dashboard, matching skylight.rwasem.com").
- Any spec gap you found that I should clarify before moving on.

**Do not invent.** If a spec is ambiguous, stop and ask. The two docs
under `docs/` are the source of truth for this batch — read them again
if anything seems missing.

Start with **Wave 1**, all 4 PRs in parallel.
