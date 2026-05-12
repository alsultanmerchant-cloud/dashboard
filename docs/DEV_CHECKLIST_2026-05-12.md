# Dashboard — Requirements & Developer Checklist

**Source:** Client feedback (Sky Light AI System WhatsApp thread)
**Reporters:** Gehad (Thu 4:39 PM – Sun 4:23 PM), Menna (Mon 11:06 AM – 11:55 AM), Eng. Mohammed Alsultan (Mon 10:16 AM / 10:49 AM)

## Priority legend
- **P1** — Blocking / broken functionality
- **P2** — Missing functionality
- **P3** — Enhancement / UX polish

---

## 1. Tasks module

### 1.1 Add design & edit count fields  ·  P2
- [ ] Keep existing **Design / Post Count** field on the task detail view
- [ ] Add new **Edit / Revision Count** field on the task detail view
- [ ] Add a **monthly filter** that totals "Design Count" and "Edit Count" across a chosen month (used for monthly closing per designer)

*Source: Gehad Thu 4:41 PM · re-confirmed missing Menna Mon 11:06 AM*

### 1.2 Per-stage owner from template (by position)  ·  P2
- [ ] In the task **template**, allow defining the **position responsible per stage**
- [ ] At runtime, system resolves the responsible person by matching that position against the people assigned to the task
- [ ] One position may map to different employees across different projects — resolution must be per-project

*Depends on §10.1*
*Source: Gehad Thu 4:51 PM · re-confirmed Menna Mon 11:15 AM*

### 1.3 Stage-progression lock  ·  P2
- [ ] Prevent moving a task to a **previous** stage
- [ ] When advancing to the next stage, show a confirmation: "You won't be able to go back"

*Source: Gehad Thu 5:02 PM*

### 1.4 Show assignee position  ·  P2
- [ ] Display the **position** under or next to each assignee name in the task's "All Participants" panel
- [ ] Visually distinguish each assignee's role for the current stage (Executor vs. Responsible)

*Source: Gehad Sun 3:17 PM · re-confirmed Menna Mon 11:15 AM*

### 1.5 Add assignees after task creation  ·  P2
- [ ] Allow editing/adding **assignees on an existing task** (currently no UI to do so post-creation)

*Source: Menna Mon 11:36 AM*

### 1.6 Deadline management  ·  P2
- [ ] If a task is created **without a deadline**, allow setting/editing the deadline later from the task view
- [ ] Add a **periodic reminder/alert** that surfaces tasks created without a deadline

*Source: Menna Mon 11:51 AM*

### 1.7 File / task upload inside task  ·  P1 (pending requirements)
- [ ] **Schedule a meeting with Gehad** to capture the detailed scenario — known ongoing pain point

*Source: Gehad Thu 5:27 PM*

---

## 2. Projects module

### 2.1 Show project name instead of Project ID  ·  P2
- [ ] In the **task header**, show the project name beside the task name (not `PRJ-xxx`)
- [ ] In **notifications**, show project name (not `PRJ-xxx`)
- [ ] Verify across all surfaces (Kanban, list, drawers)

*Source: Gehad Sun 3:08 PM, 3:12 PM · re-confirmed Menna Mon 11:11 AM*

### 2.2 Project Info access  ·  P2
- [ ] Restore the **"Project Info"** entry under the project's three-dots menu (as in Rwasem)
- [ ] Default landing when opening a project = **Tasks tab** (not Project Info). Project Info should be reachable via a button. The previous flow was faster for reaching tasks

*Source: Gehad Thu 4:57 PM · re-confirmed Menna Mon 11:09 AM*

### 2.3 Open project in new tab  ·  P3
- [ ] Clicking a project name (e.g. from a task) should support **opening in a new tab**, same as the tasks view

*Source: Gehad Thu 4:57 PM*

### 2.4 BUG — task count wrong on newly created project  ·  P1
- [ ] Newly created project shows `0 tasks` even when tasks exist
- [ ] Verify the count query/cache

*Source: Gehad Sun 3:09 PM*

### 2.5 BUG — clicking project loads all system tasks  ·  P1
- [ ] Clicking a project currently opens what looks like the **global task list** (e.g. "New (87)") instead of filtering tasks to the clicked project
- [ ] Scope task query to the selected project

*Source: Gehad Sun 3:09 PM*

### 2.6 BUG — project creation skips to step 3  ·  P1
- [ ] Project creation flow auto-advances to step 3 for ~2 seconds and **auto-creates** before the user can complete the form
- [ ] Reproduce and fix the step-machine / auto-submit

*Source: Gehad Sun 3:10 PM · reproduced Menna Mon 11:12 AM*

### 2.7 Multi-package selection on project create  ·  P2
- [ ] Allow selecting **more than one package** when creating a project (Nova / Golden / Silver / Ads / Social / SEO can combine)

*Source: Gehad Sun 3:11 PM · re-confirmed Menna Mon 11:13 AM*

### 2.8 Hold/Pause attribution  ·  P2
- [ ] When a project enters Hold/Pause, persist and display **who set it on hold** and **timestamp**
- [ ] Surface in the project card and/or log note

*Source: Gehad Sun 3:11 PM*

### 2.9 Project-level log note  ·  P2
- [ ] Implement a **log note feed at the project level** (covering the whole project, not just per-task)

*Source: Menna Mon 11:55 AM*

### 2.10 "All Documents" section in project info  ·  P2
- [ ] Add the **All Documents** tab inside project info (parity with Rwasem/Odoo)

*Source: Gehad Sun 4:07 PM, 4:08 PM*

### 2.11 BUG — recurring error when scrolling Projects page  ·  P1
- [ ] On the Projects page, scrolling down triggers a recurring "حدث مشكلة غير متوقعة" error overlay; refresh fixes it temporarily but it returns
- [ ] Investigate pagination / lazy-load / API failure

*Source: Eng. Mohammed Alsultan Mon 10:16 AM (screenshot)*

---

## 3. Services module

### 3.1 Service-level tags  ·  P2
- [ ] Currently tags exist at **project** and **task** level — add tag support at the **service** level too (e.g. so a service can be flagged "Hold")

*Source: Gehad Thu 4:59 PM · re-confirmed Menna Mon 11:10 AM*

### 3.2 BUG — new task inside a service not showing  ·  P1
- [ ] Tasks created **inside a service** do not appear in the service's task list

*Source: Gehad Sun 4:11 PM*

### 3.3 BUG — "Add service inside project" options empty  ·  P1
- [ ] The options dropdown is empty, blocking the flow
- [ ] Verify it is wired to the services catalog and that selecting a service auto-creates the associated tasks

*Source: Menna Mon 11:32 AM*

---

## 4. Notifications

### 4.1 Show project name (see §2.1)  ·  P2
- [ ] Notifications should reference project by name, not `PRJ-xxx`

### 4.2 Arabic localization rendering  ·  P2
- [ ] When system language is switched to Arabic, notifications **don't render correctly** (visible in screenshot)
- [ ] Audit notification templates for RTL / Arabic strings

*Source: Menna Mon 11:43 AM*

### 4.3 State-change logging  ·  P2
- [ ] Any **state change** on a task (e.g. cancelled, completed) must be recorded in the log with **who** and **when**

*Source: Gehad Sun 3:12 PM*

---

## 5. Reports

### 5.1 BUG — empty black banner overlays  ·  P1
- [ ] On the Reports page, an empty black tooltip/banner appears over the chart in:
  - "متوسط البقاء في كل مرحلة" (Average time per stage)
  - "توزيع التأخر الزمني" (Delay distribution)
- [ ] Remove or populate the overlay

*Source: Gehad Sun 3:13 PM*

### 5.2 Filters parity with Rwasem  ·  P2
- [ ] Filters set should match Rwasem 1:1 — users filter by their own custom needs as discussed in the meeting
- [ ] Collect the exact filter list from the client / Rwasem reference

*Source: Gehad Sun 4:23 PM*

---

## 6. Calendar & Activities

### 6.1 Activities ⇄ Calendar link  ·  P2
- [ ] Newly added **Activities** must be linked to the calendar itself
- [ ] Clicking the calendar icon should open the date picker with **days that have scheduled activities highlighted**

*Source: Menna Mon 11:30 AM*

### 6.2 Personal scheduling  ·  P3
- [ ] Allow individual employees to create personal schedule/reminders that appear in the calendar
- [ ] Current usage as a project start/end filter isn't viable — repurpose accordingly

*Source: Gehad Sun 4:16 PM*

### 6.3 Multi-day holiday periods  ·  P2
- [ ] Allow adding **a date range** for holidays (Eid etc. span multiple days) — not just day-by-day

*Source: Menna Mon 11:33 AM*

### 6.4 Auto-push deadlines on holidays / skip dates  ·  P2
- [ ] When a holiday or "skip date" is registered, automatically **push deadlines forward**
- [ ] Available at **per-project** scope and at **all-projects** scope

*Source: Gehad Sun 4:09 PM (edited)*

### 6.5 Clarify deadline-adjustment alert  ·  P2
- [ ] The deadline-shift confirmation message isn't clear about **what changed in the timeline**
- [ ] Show explicitly which tasks are pushed and by how many days

*Source: Menna Mon 11:35 AM*

---

## 7. Direct messaging / communication

### 7.1 DM from assignee click  ·  P2
- [ ] Clicking on an assignee should open a **direct chat** with that person
- [ ] Icon has been added per Thu 4:52 PM request, but the chat surface is incomplete

*Source: Gehad Thu 4:52 PM · Sun 4:22 PM*

### 7.2 Conversations icon in navbar  ·  P2
- [ ] Add a global **conversations / chat icon in the navbar** giving access to all DMs
- [ ] Currently users must navigate: project → task → chat to reach a previous conversation

*Source: Gehad Sun 4:22 PM · re-confirmed Menna Mon 11:22 AM*

### 7.3 Persistent chat threads  ·  P2
- [ ] Each DM thread should be addressable/restorable independently of the task it was started from

*Source: Gehad Sun 4:22 PM*

---

## 8. Followers

### 8.1 BUG — Followers field not editable  ·  P1
- [ ] Followers dropdown shows only ~2 fixed people, regardless of org size
- [ ] Verify the options list is sourced from the full user directory and the field accepts a selection

*Source: Gehad Sun 3:12 PM · re-confirmed Menna Mon 11:44 AM*

---

## 9. AI assistant

### 9.1 BUG — AI freezes  ·  P1
- [ ] AI hangs at a point and stops returning answers — investigate timeout / streaming / error handling

*Source: Menna Mon 11:47 AM*

### 9.2 Persistent conversations across sessions  ·  P1
- [ ] Chats currently persist **within a session**, but are **wiped on logout / app close**
- [ ] Persist conversations to the database, scoped per user, surviving sessions and page navigations

*Source: Gehad Sun 3:48 PM · Menna Mon 11:47 AM*

---

## 10. Structural prerequisites

### 10.1 Departments & positions structure  ·  P1 (dependency)
- [ ] Define and seed the **departments** structure inside the system
- [ ] Tag every employee with a **position** in their department
- [ ] Required to power §1.2 (per-stage owner by position) and §1.4 (show assignee position)

*Source: Eng. Mohammed Alsultan · Menna Mon 10:49 AM, 11:15 AM*

---

## Open meeting items
- [ ] **Upload tasks inside a task** — schedule a walkthrough with Gehad (§1.7)
- [ ] **Reports filters spec** — collect the exact filter list to match Rwasem (§5.2)

---

## Summary
| Bucket | P1 | P2 | P3 |
|---|---|---|---|
| Tasks | 1 (pending) | 6 | — |
| Projects | 4 | 6 | 1 |
| Services | 2 | 1 | — |
| Notifications | — | 3 | — |
| Reports | 1 | 1 | — |
| Calendar | — | 4 | 1 |
| Messaging | — | 3 | — |
| Followers | 1 | — | — |
| AI | 2 | — | — |
| Foundational | 1 | — | — |
| **Total** | **12** | **24** | **2** |

---

## Implementation status as of 2026-05-12

Cross-referenced against the gap analysis performed at the end of this session. See `docs/HANDOFF_2026-05-12.md` §4 for actionable next steps.

| ✅ Done | ⚠️ Partial | ❌ Open / not started | 🟡 Pending spec |
|---|---|---|---|
| 1.1, 1.2, 1.3, 1.5, 2.3, 2.6, 2.7, 2.8, 2.9, 2.10, 4.1, 4.2, 4.3, 6.3, 6.4, 6.5, 7.1, 7.3, 10.1 | 1.4, 1.6, 2.1, 3.3, 8.1 | 2.2, 2.4, 2.5, 2.11, 3.1, 3.2, 5.1, 6.1, 6.2, 7.2, 9.1, 9.2 | 1.7, 5.2 |
