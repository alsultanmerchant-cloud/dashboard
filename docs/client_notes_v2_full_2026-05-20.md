# Sky Light client feedback — COMPLETE chronological log
## WhatsApp "Sky Light AI System" group · 5/7/2026 → 5/19/2026

This supersedes `client_notes_2026-05-20.md` (which only covered 5/17–5/19). I went back through the WhatsApp scrollback to 5/7 — the earliest date accessible from WhatsApp Web. Messages before 2/19/2026 sit behind the phone-only wall, so this is the full set we can extract from the web.

Participants captured:
- **~Gehad** (+20 10 15954177) — primary client testing the dashboard
- **~Menna** (+20 10 69351207) — second client team member, started joining around 5/11
- **~Eng. Mohammed Alsultan** (+966 54 394 4872) — Sky Light tech contact
- Voice notes, video clips, and Saad's own replies are intentionally excluded per the original brief — only client-originated written + screenshot requests are recorded.

A note on the prime directive (Gehad, 3:50 PM 5/19):
> "روسم فكرته انه مفتوح ومش محدود خالص … اي تعديل تحاول حضرتك تخليه ميلزمنيش بحاجه معينه الا لو طلبنا رولز على حاجات معينه."

Treat as the rule for everything below — prefer permissive, override-able defaults; don't enforce strict rules unless the client explicitly asks for them.

---

# 1. By feature area (implementation-ready)

## 1.1 Tasks list / Tasks page

| ID | Source date | Request | Severity |
|---|---|---|---|
| T01 | 5/17 10:07 | Ambiguous task-count badge ("1-80 / 889") — can't tell open vs total. Wants both numbers visible always. | **HIGH** |
| T02 | 5/17 11:46 + 5/15 1:15 + 5/19 3:50 | Search must be flexible / fuzzy — typing any substring should match across title + tags + assignee + project. Current search returns blank. | **HIGH** |
| T03 | 5/17 11:55 | Re-add the "Created by / Requester" column — Rwasm shows it. | **MEDIUM** |
| T04 | 5/19 1:10 | Project NAME (not Project ID) must appear next to the task name in lists / cards / search results. | **HIGH** |
| T05 | 5/10 3:09 + 5/19 4:21 | Clicking a project should open that project's tasks, not the global all-tasks list. Also pagination breaks at 120 of 2,093. | **HIGH** |
| T06 | 5/17 12:26 | Promote "Tasks without deadline" to a KPI tile, mirroring the Projects page. | **MEDIUM** |
| T07 | 5/17 11:32 + 5/10 3:07 + 5/7 4:59 | Labels / Tags (like WhatsApp colour labels). Tag at project, task, AND **service** levels. "Hold" tag used as exemplar. | **HIGH** |
| T08 | 5/11 11:51 | Deadline can only be set on task **creation**. Need ability to add / edit deadline AFTER creation. | **HIGH** |
| T09 | 5/11 11:51 | Periodic notification banner listing tasks created without a deadline. | **MEDIUM** |

## 1.2 Stages & approvals

| ID | Source date | Request | Severity |
|---|---|---|---|
| S01 | 5/7 5:02 | **Stage lock** — once moved forward, a task should not go back to a previous stage. Confirmation dialog on stage transition warning "this is irreversible". | **HIGH** |
| S02 | 5/17 12:32 + 5/18 12:32 | Per-stage Responsible Role (not just a single task-level role). Each stage can have its own assignee. | **HIGH** |
| S03 | 5/19 1:32 | Task-level Responsible should be by **employee**; stage-level Responsible should be by **position**. | **HIGH** |

## 1.3 Project page

| ID | Source date | Request | Severity |
|---|---|---|---|
| P01 | 5/11 11:09 | Project page nav order regression — currently opens project-info first, then tasks. Used to open tasks first with a button to project-info. Restore old order. | **HIGH** |
| P02 | 5/10 4:07 + 5/10 4:08 | **All Documents** section at project level (like Rwasm) — not present yet. | **HIGH** |
| P03 | 5/11 11:55 | **Project-level log notes** — discussed in earlier meeting, still not built. | **MEDIUM** |
| P04 | 5/10 3:09 + 5/11 11:12 | Project creation wizard skips the 3rd step — flashes for ~2 seconds and auto-creates the project. Step needs to stay interactive. | **HIGH** |

## 1.4 Templates, Roles, Departments

| ID | Source date | Request | Severity |
|---|---|---|---|
| TM01 | 5/17 12:25 | Task Templates need an **Edit** button. (Saad confirmed shipped 5/17 1:23 — Gehad subsequently asked also for **Delete**.) | **DONE / VERIFY** |
| TM02 | 5/17 12:25 + 5/17 1:21 | Departments page needs **Edit AND Delete** options. (Edit shipped; delete pending.) | **MEDIUM** |
| TM03 | 5/17 12:24 | Type-to-filter combobox for the employee picker — the dropdown is unusable with the full employee list. | **HIGH** |
| TM04 | 5/18 2:21 | Role dropdown is missing **Team Leader**. Same dropdown is used for both task-level Responsible and per-stage Responsible — they should draw from different role sets. | **HIGH** |
| TM05 | 5/18 2:24 | **Centralised positions catalogue** — adding a position in Employees must auto-appear as an option in Task Templates. Currently positions are free-text → spelling drift breaks role→employee mapping. | **HIGH** |
| TM06 | 5/13 (top of 5/13 message) | When the manager on an employee profile is changed, the existing tasks for that employee still show the **old** manager. Employees and tasks aren't linked live. | **HIGH** |

## 1.5 Service templates

| ID | Source date | Request | Severity |
|---|---|---|---|
| SV01 | 5/18 2:54–2:56 + 5/13 (top) | Service templates carry default assignees; when a service is dropped into a project, defaults attach to every task. Operator can additionally add extra people who get auto-assigned to all that service's tasks in that project. | **HIGH** |
| SV02 | 5/10 4:11 | Can't create a new task inside a service template. The "create task within service" action is missing. | **HIGH** |
| SV03 | 5/10 3:07 + 5/7 4:59 | Tags at service-template level (in addition to project/task). | **MEDIUM** |

## 1.6 Followers (Rwasm-parity)

| ID | Source date | Request | Severity |
|---|---|---|---|
| F01 | 5/13 (top) | The dashboard must pull and surface **Followers** like Rwasm — both at project-level AND per-task. | **HIGH** |

## 1.7 Employee management

| ID | Source date | Request | Severity |
|---|---|---|---|
| E01 | 5/19 12:53 + 12:59 + 1:05 + 5/11 2:18 | Employee form must surface and allow edit of: **Team Leader, Department Head, Job Title, Department**. Department Head missing from the form. | **HIGH** |
| E02 | 5/11 2:18 + 5/11 2:27 | **Organization chart** at `/organization/chart` — wired from employees, hierarchical, with titles. Mohamed sent a structure to base it on. | **MEDIUM** |

## 1.8 Holidays & working calendar (`/settings/holidays`)

| ID | Source date | Request | Severity |
|---|---|---|---|
| H01 | 5/11 3:33–3:40 | Saudi working-calendar shift didn't work in testing — adding a holiday should push affected task deadlines forward by the holiday length, but didn't. | **HIGH** |
| H02 | 5/10 4:09 | Holiday management **per-project** AND **all-projects-wide** — e.g. Eid as a global holiday, or a project-specific outage. | **HIGH** |

## 1.9 Sync with Rwasm/Odoo

| ID | Source date | Request | Severity |
|---|---|---|---|
| SY01 | 5/13 (top) | Document the **sync cadence** (every how-often does the dashboard pull from Rwasm) and whether local edits get overwritten by the next sync. | **MEDIUM** |

## 1.10 Activity / log notes

| ID | Source date | Request | Severity |
|---|---|---|---|
| LN01 | 5/17 12:12 | Activity / log fields regressed and are missing again. Restore the full set. | **HIGH** |

## 1.11 AI assistant

| ID | Source date | Request | Severity |
|---|---|---|---|
| AI01 | 5/17 12:40 + 5/19 1:48 | AI returns only recent overdue tasks — Gehad had to remind it about months 1 & 2. Default to "all overdue, all time" via `tasks.is_overdue`. | **HIGH** |
| AI02 | 5/11 11:47 + 5/10 3:48 | AI chat conversation history doesn't survive a session close — when she reopens she can't find old conversations. | **HIGH** |

## 1.12 Theme & a11y

| ID | Source date | Request | Severity |
|---|---|---|---|
| TH01 | 5/17 12:23 | Light-mode font contrast is too low — text is hard to read. | **MEDIUM** |

## 1.13 Subtasks / file uploads (vague, needs meeting)

| ID | Source date | Request | Severity |
|---|---|---|---|
| ST01 | 5/7 5:27 | "Uploading tasks inside a task itself" issue — long-standing pain point, she wanted to explain in the 5/7 meeting. Probably about creating subtasks / attaching files inside a task. Confirm scope with her. | **NEEDS MEETING** |

---

# 2. Chronological log (so you can trace back to the source message)

### 5/7/2026 (Eng. Mohammed Alsultan + Gehad — meeting day)
- 12:42 PM Mohammed: "We can have a meeting, I tested yesterday, have observations" — current scope is **project management only**.
- 4:59 PM Gehad: Tag for "Hold" needs to be at **service** level too (already exists at project + task).
- 5:02 PM Gehad: **Stage lock + confirmation dialog** — no backwards movement once advanced (S01).
- 5:27 PM Gehad: Task file-upload / inside-task issue — long-standing; needs meeting (ST01).
- 5:58 PM Saad acknowledged + arranged follow-up meeting.

### 5/10/2026 (Gehad — after the meeting)
- 3:07 PM: Tags ("Hold" example) for all employees to surface in-progress filters (T07).
- 3:08 PM: Project NAME vs Project ID — wants name next to task name (T04).
- 3:09 PM: Click-project nav bug — opens all-system tasks instead of the project's tasks (T05).
- 3:10 PM: Project creation wizard skips step 3 (~2 seconds visible) — auto-creates project (P04).
- 4:07–4:08 PM: **All Documents** section at project level missing (P02).
- 4:09 PM: Holidays per-project AND all-projects-wide (H02).
- 4:11 PM: Cannot create a new task inside a service (SV02).

### 5/11/2026 (Menna joins; Gehad continues)
- 11:09 AM Menna: Project page nav-order regression — wants tasks first, info-button second (P01).
- 11:10 AM Menna: TAGS still not added (T07).
- 11:11 AM Menna: Project ID still showing instead of project name (T04).
- 11:12 AM Menna: Project-creation wizard skip-step bug confirmed independently (P04).
- 11:47 AM Menna: AI conversation history lost on session close (AI02).
- 11:51 AM Menna: No way to add a deadline AFTER task creation (T08); also wants a periodic banner for tasks-without-deadline (T09).
- 11:55 AM Menna: Project-level log note still missing (P03).
- 2:18 PM Saad: Org chart in progress; needs employee data (E02).
- 2:25 PM Saad: Will implement and follow up with another meeting.
- 2:27 PM Gehad: Asks Saad to base the chart on the structure Mr. Mohamed sent.
- 3:33 PM Saad: Saudi-calendar shift behavior — "tasks shift to first working day".
- 3:40 PM Menna: Tested and the shift didn't work as expected (H01).
- 9:06 PM Saad: Will schedule a meeting tomorrow.

### 5/12/2026
- 5:16 PM Saad: Sends Google Meet link for 5/13 meeting.

### 5/13/2026 (Gehad — post-meeting big synthesis)
- Big message covering:
  - Employee → task disconnect: changing manager on employee doesn't propagate to existing tasks (TM06).
  - System must pull Followers from Rwasm at both project- and task-level (F01).
  - Asks for confirmation on sync cadence and whether local edits get overwritten on next sync from Rwasm (SY01).

### 5/17/2026 (Sunday — original feedback batch)
- 10:07 AM: Ambiguous count badge (T01).
- 10:08 AM: Follow-up screenshot on the same count confusion.
- 11:32 AM: Labels feature request (T07).
- 11:46 AM: Flexible search like Rwasm (T02).
- 11:55 AM: Created by column (T03).
- 12:12 PM: Activity log regression (LN01).
- 12:23 PM: Light-mode contrast (TH01).
- 12:24 PM: Type-to-filter employee picker (TM03).
- 12:25 PM: Task Templates Edit + Departments Edit/Delete (TM01, TM02).
- 12:26 PM: No-deadline KPI tile (T06).
- 12:32 PM (Menna): Per-stage Responsible (S02).
- 12:40 PM: AI overdue completeness (AI01).
- 1:21 PM: Departments page now has Edit; wants Delete too (TM02).
- 1:32 PM: Task Responsible by employee / stage Responsible by position (S03).
- 5:21 PM Saad: Search v1 shipped — Gehad confirmed it's progress but later marked insufficient.

### 5/18/2026 (Monday — second batch)
- 2:21 PM (Menna): Team Leader missing from Responsible dropdown; same dropdown used in two places (TM04).
- 2:24 PM (Menna): Centralised positions catalogue (TM05).
- 2:54–2:56 PM (Menna): Service template default assignees + per-project override (SV01).

### 5/19/2026 (Yesterday — third batch)
- 12:53 PM: Employees form needs Team Leader, Department Head, Job Title, Department (E01).
- 1:10 PM: Project name (not ID) on task rows (T04) — old screenshot used to show it.
- 1:15 PM: Search still not flexible enough (T02).
- 3:50 PM: Prime-directive statement — "Rwasm is open, don't lock things in".
- 4:21 PM: Pagination cap at 120 of 2,093 (T05).

---

# 3. Status of Phase 1 work I already did (now needs widening)

Previous Phase 1 implementation only addressed: T01 + T06 (stats row), T03 (Created by column + view + loader). That's **3 of 33** items. The remaining 30 are spread across Phases 2, 3, 4 and a new Phase 5 below.

# 4. Re-scoped phases

- **Phase 1 (Tasks UX) — DONE for T01, T03, T06.** Still owed: T02 search, T04 project name vs id, T05 nav + pagination, T07 labels, T08 deadline-after-creation, T09 no-deadline banner.
- **Phase 2 (Templates / Departments / Roles)** — TM01–TM06 + S01–S03.
- **Phase 3 (Service templates + Followers + Employees)** — SV01–SV03, F01, E01–E02.
- **Phase 4 (Holidays + Sync + Activity + AI + Theme)** — H01–H02, SY01, LN01, AI01–AI02, TH01.
- **Phase 5 (Project page rework)** — P01–P04 (page nav order, All Documents, log notes, wizard skip-step).
- **Phase 6 (Subtasks / file uploads)** — ST01, meeting-driven; defer until Gehad walks Saad through it.
