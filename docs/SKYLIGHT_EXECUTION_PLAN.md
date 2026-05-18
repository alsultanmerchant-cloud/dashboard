# Sky Light Feedback — Execution Plan & Agent Dispatch

**Companion to:** `SKYLIGHT_FEEDBACK_2026-05-17.md` (the 14 issues).
**Status:** Plan locked, awaiting green light to dispatch.
**Ground truth used:** Live Rwasem Odoo at `skylight.rwasem.com` + local
addons at `/Users/mahmoudmac/Documents/projects/skylight_addons-master/addons/17.0`.

---

## What the source code told us (delta vs. the original feedback notes)

| # | Original feedback | What Rwasem source actually shows | Fix shrinks to |
|---|---|---|---|
| 1 | Tasks page filters parity | `search_default_my_open_tasks` is stock Odoo, kept by Rwasem on the main Tasks action; only removed on the project-scoped sub-action via `project_customization/views/project_task.xml:124` | Add a default "Open Tasks" saved filter on `/tasks` query state. **1-day**. |
| 2 | Kanban count ambiguity | Stock Odoo column header shows `stage · count` where count respects the active domain filter | Same fix as #1 — once the default filter is applied, the count is unambiguous. **Folds into PR-A**. |
| 3 | Origin badge (Odoo vs Dashboard) | Rwasem uses no such badge — they don't need one because they're single-source-of-truth | Surface `external_source` we already store (migration `0011`/`0040`) as a column + saved filter chip. **0.5-day**. |
| 4 | Project card task count includes archived | Rwasem uses stock `project.task_count` which filters `active=True` automatically | Add `.eq('archived', false)` (or equivalent) to our count query in `projects/page.tsx` and the project card component. **0.5-day**. |
| 5 | Search needs flex like Rwasem | Rwasem uses Odoo's built-in fuzzy search across name + description | Our migration `0061` already added `search_tsv` with `arabic` config — wire it into the visible search input and add trigram fallback for short queries. **1-day**. |
| 6 | Activity log incomplete | **No custom mail.thread overrides in Rwasem** — stock Odoo writes everything; our regression is on our side | Audit `task_activities` / `audit_log` writers; restore missing event types. **1.5-day**. |
| 7 | Light-mode contrast | n/a — Rwasem is light-mode-native; their text contrast is fine | Tailwind class sweep on task cards + kanban headers. **0.5-day**. |
| 8 | Org chart duplicates | Rwasem org tree uses stock `hr.employee.parent_id` chain — no duplicates by construction | De-dup our seed (migration `0043`) and fix the chart renderer's collapsing rule. **1-day**. |
| 9 | Employee picker typeahead | Stock Odoo many2one widget is a typeahead by default | Replace our `<select>` with shadcn `Combobox`. Reusable across ~6 places. **0.5-day**. |
| 10 | Task templates Edit | Source: `aptuem_project_default_task/views/project_category.xml` — edit form already exists in Rwasem; ours is missing | Add Edit form to `/task-templates/[id]` with `responsible_role_id` FK. **1-day**. |
| 11 | Team Leader + Dept Head | Stock Odoo: `hr.employee.parent_id` (manager) + `hr.department.manager_id`. **No custom addon needed in Rwasem** | Add two FKs to `employee_profiles`; surface in list+detail. **1-day**. |
| 12 | Departments Edit | Stock Odoo `hr.department` is editable; ours has no edit form | Add Edit dialog. **0.5-day**. |
| 13 | "No deadline" KPI tile | Rwasem shows it on both Projects and Tasks dashboards | Add tile to `/tasks` header. **0.5-day**. |
| 14 | AI assistant truncation | n/a — Rwasem has no AI surface | Audit `src/app/api/agent/route.ts` for hidden `LIMIT`; force `order by deadline asc`. **1-day**. |

**Total scoped work: ~10 dev-days.** With parallel agents, calendar time should compress to 2–3 days.

---

## PR groups (one agent per group)

Each agent runs in an isolated worktree (`isolation: "worktree"`) on its own
branch. Cross-PR file conflicts are flagged inline.

### PR-A · Tasks page coherent fix [issues #1, #2, #13] — **GATED REVIEW**

- Files: `src/app/(dashboard)/tasks/page.tsx`,
  `src/components/tasks/tasks-toolbar.tsx`, related kanban column header.
- Source-of-truth match: replicate Rwasem's `search_default_my_open_tasks=1`
  behavior — default to "Open Tasks" saved filter, render filter chip with
  total-shown count, kanban headers show `count` matching the active domain.
- Add "Tasks without deadline" KPI tile (issue #13) in the same PR — it
  shares the same toolbar.
- **Verification:** open the dashboard, confirm "Open Tasks" is on by
  default, count chip shows e.g. `· 412 of 1037`, kanban headers track
  the chip. Compare against `skylight.rwasem.com/web#action=804`.

### PR-B0 · Importer field expansion [issue #15] — **GATED REVIEW, prereq for PR-B**

- Files: `src/lib/odoo/importer.ts` (expand `TASK_FIELDS`, similarly audit
  `PROJECT_FIELDS`, `CLIENT_FIELDS`, `EMPLOYEE_FIELDS`),
  `src/lib/odoo/types.ts` (add fields to `OdooTask`), new migration
  `0064_odoo_task_sync_fields.sql` adding `created_by_employee_id` and
  similar FKs.
- Add chatter back-fill: for each imported task with `message_ids`,
  insert/update rows in `task_activities` with `external_id` keyed by
  Odoo message id (idempotent).
- **Verification:** `bun run sync:odoo` end-to-end; pick a known task,
  confirm "Created by" populates and Activity Log shows pre-import history.
- **Why first:** PR-B's "missing activity log entries" symptom is partly
  caused by never pulling `message_ids` from Odoo. Land this first, then
  PR-B only needs to fix our own writers for dashboard-originated events.

### PR-B · Data correctness: activity log + project task count [issues #4, #6] — **GATED REVIEW**

- Files for #6: every `INSERT`/`UPDATE` writer under
  `src/app/(dashboard)/tasks/**` + `src/lib/supabase/audit.ts` (or
  equivalent). Restore writes for: comments, attachments, assignee
  changes, approval gates (migration `0048`), sub-task changes
  (migration `0056`), timesheets, links/dependencies (migration `0051`).
- Files for #4: `src/app/(dashboard)/projects/page.tsx` + the project card
  component. Fix the task count to exclude archived (mirror stock Odoo's
  `active=True`).
- **Verification:** create one mutation of each type, open `/tasks/[id]`
  activity tab, confirm all show; open PRJ-01587 in dashboard and confirm
  card shows 28, not 177.

### PR-C · Task search flexibility [issue #5] — **AUTO-MERGE**

- Files: `src/lib/queries/listTasks.ts` (or wherever
  `websearch_to_tsquery` is wired), `src/components/tasks/search-input.tsx`.
- Wire `tsv` column from migration `0061` to the visible input. Add
  `pg_trgm` similarity fallback (1–2 char inputs). Debounced autocomplete.
- **Verification:** type a partial Arabic word, see live results;
  Cypress/Playwright test for "first three chars match".

### PR-D · Org admin block [issues #8, #10, #11, #12] — **GATED REVIEW** (touches schema)

- New migration `0063_employee_org_fields.sql` adds:
  - `employee_profiles.team_leader_employee_id` (nullable FK self).
  - `employee_profiles.department_head_employee_id` (nullable FK self).
  - Cycle-prevention trigger (mirror migration `0051` task-deps pattern).
- Edit form on `/organization/departments/[id]`.
- Edit form on `/task-templates/[id]` with `responsible_role_id` and
  preview-of-resolved-assignees panel.
- Org chart de-dup pass (collapse exact name+role duplicates, fix seed
  migration `0043` going forward).
- **Verification:** add a TL/Head, see it on the chart; edit a department
  and template, see audit_log rows; org chart shows no dupes.

### PR-E · Employee combobox (reusable) [issue #9] — **AUTO-MERGE**

- New component: `src/components/forms/employee-combobox.tsx` (shadcn
  Command primitive).
- Replace call sites: task assignee, approver, specialist slots
  (migration `0049`), task delegations (migration `0039`), follower add,
  any HR form.
- **Verification:** open a task edit dialog, type 3 chars, see filtered
  list; smoke test that all 6 call sites compile.

### PR-F · Origin badge [issue #3] — **AUTO-MERGE**

- New `<OriginBadge>` component reading `external_source` from row.
- Add to: Tasks list row, Projects card, Clients list row, Employees list
  row. Add saved-filter chip "Origin = Odoo / Dashboard".
- **Verification:** Odoo-synced rows show "Odoo" pill, dashboard-created
  rows show no pill (or "Dashboard").

### PR-G · Light-mode contrast pass [issue #7] — **AUTO-MERGE**

- Sweep Tailwind class usage on `src/components/tasks/*` + kanban headers.
- Replace `text-muted-foreground` over tinted columns with
  `text-foreground/70` (or define a new contrast token).
- **Verification:** screenshot diff against Gehad's light-mode shot at
  `/tasks?view=kanban&theme=light`.

### PR-H · AI assistant data completeness [issue #14] — **GATED REVIEW**

- File: `src/app/api/agent/route.ts`. Find every tool the Gemini agent
  calls that returns "tasks" — remove hidden `LIMIT`, force
  `order('deadline', { ascending: true })`, surface `total_count` so the
  agent can disclose truncation explicitly.
- System prompt: add rule — "when asked for oldest/earliest/all overdue
  tasks, return sorted by deadline ascending and disclose if capped."
- **Verification:** run Gehad's exact prompt ("اقدم التاسكات المتأخرة")
  and confirm all month-1/2/3 overdue tasks come back in one shot.

---

## Dispatch order (parallel where safe)

```
Wave 1 (parallel, ~30 min wall-clock each):
  PR-C  (search)        — auto-merge
  PR-E  (combobox)      — auto-merge
  PR-F  (origin badge)  — auto-merge
  PR-G  (contrast)      — auto-merge

Wave 2 (after Wave 1 lands, parallel):
  PR-A  (tasks page coherent)        — GATED, depends on PR-E for the combobox
  PR-B0 (importer field expansion)   — GATED, schema + sync; must land before PR-B
  PR-H  (AI completeness)            — GATED, isolated

Wave 3 (after Wave 2 lands):
  PR-B  (data correctness — our writers, post-import) — GATED
  PR-D  (org admin + schema migration)                — GATED, touches DB
```

Wave 1 is all leaf-level UI work, no schema, no overlap → safe to
parallelize and auto-merge once diffs pass build + lint.

Wave 2 needs Wave 1's combobox in place. PR-A and PR-B touch different
files. PR-H is isolated.

Wave 3 introduces a migration → must be last, gated.

---

## Agent prompt template (used for every PR above)

```text
You are an implementation agent for the mr-dashboard project at
/Users/mahmoudmac/Documents/projects/mr-dashboard.

Context:
- Read CLAUDE.md first.
- Read docs/SKYLIGHT_FEEDBACK_2026-05-17.md for the issue background.
- Read docs/SKYLIGHT_EXECUTION_PLAN.md and find the PR named "<PR-ID>".

Source-of-truth reference: the Rwasem Odoo addons folder at
/Users/mahmoudmac/Documents/projects/skylight_addons-master/addons/17.0.
Specific modules cited in your PR description are pinned reading for you.

Your job:
1. Implement exactly the files + behavior listed under your PR.
2. Match Rwasem behavior, not invent new patterns.
3. Every mutation: zod-validate → check user → check org scope → write
   audit_log + ai_event per the working rules in CLAUDE.md.
4. Skeleton + empty + error states; RTL; Tajawal font.
5. After implementing, run `bun run lint` and report any errors.
6. Stop and ask if anything in the spec is unclear — do NOT invent.

Report back with: list of files changed, screenshots of new screens (if
UI), and the diff summary.
```

---

## What I need from you to dispatch

One decision:

- Wave 1 only (safest — see auto-merge work first), or all three waves
  queued (fastest — Wave 2/3 start once Wave 1 verification lands).
