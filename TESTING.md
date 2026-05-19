# Features To Test

Checklist of features built that still need manual / end-to-end verification.
Status legend: ✅ verified in browser · ⚠️ partially verified · ❌ not yet tested

---

## 1. Per-phase responsible role in task-template modals
**Where:** `/task-templates/[id]` → "إضافة مهمة قالب" and the row "تعديل" (pencil) modal
**Status:** ⚠️ edit modal verified (open + save persisted); add modal not tested

- [ ] Add modal: create a template item, set roles for several phases, save → item appears with the roles in the "مالك كل مرحلة" preview column.
- [ ] Add modal: leave all phase roles empty → item is created using the default mapping.
- [ ] Edit modal: open an item, the 8 phase dropdowns are pre-filled with current roles.
- [ ] Edit modal: change a phase role, save → "مالك كل مرحلة" preview column updates.
- [ ] Edit modal: a plain metadata edit (title only) does not wipe existing phase roles.

Files: `src/app/(dashboard)/task-templates/[id]/add-item-dialog.tsx`, `edit-item-dialog.tsx`, `_actions.ts`

---

## 2. Role → employee resolution at project creation
**Where:** create a new project from services/templates
**Status:** ❌ not tested (would create a real project + tasks)

- [ ] Create a project whose template has a phase set to `manager` → generated task gets a `manager` assignee = the service department's head.
- [ ] `specialist` and `account_manager` phases still resolve as before (no regression).
- [ ] A phase set to `agent` / `supporting_lead` / `supporting_agent` → stays unassigned (expected — no org-chart source).
- [ ] A service with no department head → its `manager` phases stay unassigned (no crash).
- [ ] Open a generated task → the "current stage owner" widget shows the resolved employee for the current phase.
- [ ] Repeat for the categories engine (project created with per-service week-split / category overrides).

Files: `src/lib/workflows/generate-tasks.ts`, `src/lib/projects/generate-from-categories.ts`

---

## 3. Per-stage owner editor on the task detail page
**Where:** `/tasks/[id]` → "المشاركون" section header → "مالك كل مرحلة" button
**Status:** ❌ not tested

- [ ] Button appears for users who can manage the task.
- [ ] Popover shows all 8 phases with role dropdowns, pre-filled from the task's `stage_owner_positions`.
- [ ] Change a phase role, save → "current stage owner" widget / assignee highlight reflect it.

Files: `src/app/(dashboard)/tasks/[id]/task-stage-owner-editor.tsx`, `_assignee_actions.ts`

---

## 4. Project name on kanban task cards
**Where:** `/tasks?view=kanban`
**Status:** ✅ verified in browser

- [ ] Each card shows the project name (+ client) above the task title, linking to the project.
- [ ] On a single project's own board (`/projects/[id]`) the header is not shown (no redundancy).

Files: `src/app/(dashboard)/projects/[id]/task-board.tsx`

---

## 5. Department head selection in the employee edit modal
**Where:** `/organization/employees` → row "تعديل" → "رئيس القسم" field
**Status:** ⚠️ field renders + seeds correctly; live save not tested (mutates shared dept)

- [ ] "رئيس القسم" dropdown is pre-filled with the employee's current department head.
- [ ] Changing the department re-seeds the head field to that department's head.
- [ ] Field is disabled until a department is selected.
- [ ] Saving a new head updates `departments.head_employee_id` → the "رئيس القسم" column reflects it for everyone in that department.

Files: `src/app/(dashboard)/organization/employees/employees-admin.tsx`, `_actions.ts`, `page.tsx`

---

## Known follow-ups (not bugs in the above)
- Console error on `/tasks` — a `useEffect` dependency array changes size between renders (pre-existing, flagged as a separate task).
- `agent` / `supporting_lead` / `supporting_agent` phase roles have no org-chart auto-resolution — needs a product decision if auto-assignment is wanted.
