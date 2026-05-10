# Rwasem (Sky Light Odoo) ↔ Dashboard data gap

**Authoritative source:** live Odoo at `https://skylight.rwasem.com`, db `skylight`.
**Probed:** 2026-05-10 via `scripts/probe/odoo-rwasem.ts` and `scripts/probe/odoo-extract-module.ts`.
**Why this doc exists:** before we keep building features by guessing what the team means, we cross-walk the team's feedback (`docs/TEAM_FEEDBACK_2026-05-10.md`) against the actual Odoo schema/customizations they use today.

## 1. Installed `rwasem_*` / `aptuem_*` modules (10 live)

| Module | Purpose | Maps to feedback |
| --- | --- | --- |
| `aptuem_project_default_task` | Auto-generate tasks from category templates | already mirrored (`task_templates`) |
| `rwasem_customer_report` | Customer reporting | — |
| `rwasem_document_management_project` | Smart-buttons on project/task → documents | **#14 All Documents** |
| `rwasem_document_management_project_extend` | Share-document wizard, attachment views | #14 |
| `rwasem_error_report` | Error reporting | — |
| **`rwasem_notifications_link`** | **Mention-aware DM with `[Project: X — Task: Y]` header + form-link**; assigned/unassigned task notifications | **#5 Notifications display ID instead of name/code** ← the team's reference behaviour |
| `rwasem_project_category_enhancements` | Floor + Construction Type **tag** fields, Google-Maps site address, kanban progress | **#12 multi-package** ← almost certainly *multi-category-tag* |
| **`rwasem_project_notification`** | (source not in our local mirror — extracted 2 ir.model entries only; pure Python `_inherit`) | TBD — likely project-level notify hooks |
| **`rwasem_project_task_progress`** | Manual `progress_percentage` (0–100) with progress-bar widget | feeds #19 design/edit progress |
| `rwasem_task_bulk_update` | Bulk update followers/assignees by category | already partially mirrored (bulk stage/priority) |

**Not installed but in source mirror** (still useful as design references): `rwasem_project_wizard` (#3 wizard), `rwasem_menu_project` (#15), `rwasem_livechat` (#11), `rwasem_document_enhancements` (doc-expiry), `rwasem_project_feasibility_study` (ROI tab), `eg_task_stage_duration` (stage history), `project_customization` (approval workflow).

## 2. Custom fields on `project.task` (61 non-stock; full dump in `scripts/probe/out-task-fields.json`)

Mapped to open feedback:

| Odoo field | Type | Maps to |
| --- | --- | --- |
| `design_count` | integer "Design / Post Count" | **#19 col 1** ← confirmed source |
| `closed_subtask_count` | integer | **#19 col 2 candidate** ("edits" via sub-tasks) — needs team confirmation |
| `subtask_count` | integer | sub-task pill (already shown) |
| `document_count` | integer | **#14** smart-button |
| `stage_time_ids` | one2many → `task.stage.time` | **#13 role per stage** + **#7** state-change log |
| `current_stage_duration` | char | #13 dwell-time pill |
| `category_id` | many2one → `project.category` | **#12 multi-package** root |
| `tag_ids` | many2many → `project.tags` | tagging |
| `approval_history_ids` | one2many → `project.task.approval.history` | **#4 hold + #7** unified history |
| `approval_workflow_steps_html` / `approval_user_steps_html` | html | #7 timeline payload |
| `personal_stage_type_id` / `personal_stage_type_ids` | many2one/many2many → `project.task.type` | **#17 personal calendar/stages** |
| `workflow_type` / `user_workflow_id` | selection / many2one → `workflow.user` | **#13 employee role per stage** |
| `progress_percentage` / `progress_slip` / `expected_progress` | float | progress widgets |
| `next_approver_id` / `next_approver_group_id` | many2one → res.users / res.groups | approval routing |
| `pricing_type` | selection | sale-order link |

## 3. What `rwasem_notifications_link` actually does (#5 root cause)

Source: `addons/17.0/rwasem_notifications_link/models/mail_thread.py`. Inherits `mail.thread.message_post` and, on every chatter post, sends a Discuss DM to each `@`-mentioned user with this body:

```html
[Project: <project.display_name> - Task: <task.display_name>]
<plain-text body>
```

Both `Project:` and `Task:` are anchor links to `/web#id=…&model=…&view_type=form`. **The team treats this as the canonical notification shape.** Any of our notifications that reads "في مهمة" or "تصعيد على مهمة" without project + code + title in the visible text is, by their definition, "showing IDs."

What we already do correctly:
- Mentions in `tasks/_actions.ts` (line ~457): `${actor} أشار إليك في «${project}» — ${task_code} ${title}` ✅

What we just fixed:
- `ESCALATION_ACKNOWLEDGED` now embeds `«PRJ-XXX-NNN title»` ✅
- Topbar notification panel deep-links to entity instead of dumping at section list ✅

What we should also tighten:
- `TASK_FOLLOWER` body is just `task.title` — should be `«{project}» — {task_code} {title}`
- `TASK_APPROVAL` body is just `task.title` — same
- `HANDOVER_SUBMITTED` body could include the project name explicitly
- `DM` could include `{context_task}` link when present

## 4. Recommended migrations (data we don't yet store)

Ordered by how many feedback items they unblock.

1. **`tasks.design_count` integer + `tasks.edit_count` integer** (or derive via tagged sub-tasks) → unblocks **#19**.
2. **`task_stage_history` already exists in 0007**: cross-check we record `actor_user_id` on every transition, not just `from`/`to`/`at` → unblocks **#13** (role per stage; we can render assignees-at-time-of-stage).
3. **Document smart-button**: count(*) attachments on `project_id IN (project,*tasks*)` plus a unified view → **#14**.
4. **`project_categories` + `task_categories` tag tables** → **#12** if confirmed.
5. **Saudi calendar already exists (0055)**, but team-feedback #16 wants per-project overrides; add `projects.holiday_calendar_ref` or per-project blackout dates table.
6. **Personal calendar/reminders surface for #17** — probably reuse `task_activities` (already exists from 0060) but expose a personal /calendar view.

## 5. Outstanding unknowns to confirm with the team before implementation

- Is **#19 col 2** (`closed_subtask_count`?) genuinely "edits" by their definition, or do they have a separate counter? We can show them the Odoo `design_count` label and ask "what's the equivalent for edits?"
- Is **#12 "multi-package"** really `category_id` × `tag_ids`, or do they have a separate `package_id` we haven't surfaced? (No `package_id` field on `project.task`.)
- For **#15 "Rwasem-style section"**, what specific menu/page do they want? `rwasem_menu_project` source XML has the answer — we should read its `views/menuitems.xml` once.

## 6. Probe scripts (committed under `scripts/probe/`)

- `odoo-rwasem.ts` — auths, lists installed `rwasem_*`/`aptuem` modules, dumps full field metadata for `project.task` and `project.project` to `out-task-fields.json` / `out-project-fields.json`.
- `odoo-extract-module.ts <module>` — given an installed module name, dumps its `ir.model.data`, view arch, crons, server actions, and overridden fields.

Run with `bun --env-file=.env.local scripts/probe/<file>.ts`.

## 7. Recommended next move

1. **Read** `rwasem_menu_project/views/menuitems.xml` (local mirror) — answers #15.
2. **Run** `odoo-extract-module.ts rwasem_project_notification` already returned only `ir.model` entries → ask for source via team or skip; not a blocker.
3. **Ask team to confirm**: (a) what populates "edits" column for #19; (b) if "package" = `category_id` + `tag_ids`; (c) screenshot of the notification surface they flagged for #5 (so we can pinpoint which producer to fix).
4. **Then** continue executing the feedback list with concrete data plans instead of guesses.
