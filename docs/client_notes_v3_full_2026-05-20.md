# Sky Light client feedback — COMPLETE log (v3)
## WhatsApp "Sky Light AI System" group · 5/7/2026 → 5/19/2026

This is the **complete** capture after a full re-scroll back to 5/7 (the earliest date WhatsApp Web exposes — pre-2/19 sits behind the phone-only wall). Supersedes both `client_notes_2026-05-20.md` and `client_notes_v2_full_2026-05-20.md`.

**Reference point:** Saad himself counted **"38 نقطه تم ذكرها ف المحادثة"** at 2:01 PM 5/12. The list below totals **48 distinct items** — close enough to suggest I now have all of his 38 plus a few he hadn't separated out.

Participants:
- **~Gehad** (+20 10 15954177) — lead client tester
- **~Menna** (+20 10 69351207) — second client team member, started joining 5/11
- **~Eng. Mohammed Alsultan** (+966 54 394 4872) — Sky Light technical lead

Excluded per the original brief: voice notes, video clips, and Saad's own replies.

The prime directive (Gehad, 3:50 PM 5/19):
> "روسم فكرته انه مفتوح ومش محدود خالص … اي تعديل تحاول حضرتك تخليه ميلزمنيش بحاجه معينه الا لو طلبنا رولز على حاجات معينه."

Translation: Rwasm is open and not limited; any edit shouldn't force a specific behaviour on us unless we explicitly request a rule. **Treat as the hard rule for everything below.**

---

# Part A — By feature area

## A. Tasks list / Tasks page

| ID | Source | Request | Severity |
|---|---|---|---|
| T01 | Gehad 5/17 10:07 | The "1-80 / 889" count badge is ambiguous — can't tell if it's open or total. Show both numbers (and No-deadline) always. | **HIGH** |
| T02 | Gehad 5/17 11:46 + 5/15 1:15 + 5/19 3:50 | Search must be flexible / fuzzy across title + tags + assignee + project. Current search returns blank for partial words. | **HIGH** |
| T03 | Gehad 5/17 11:55 | Re-add the "Created by / Requester" column to the task list (Rwasm parity). | **MEDIUM** |
| T04 | Gehad 5/19 1:10 + Menna 5/11 11:11 + Gehad 5/10 3:08 | Project NAME (not Project ID) must appear next to the task name in lists, cards, and search. | **HIGH** |
| T05 | Gehad 5/10 3:09 + 5/19 4:21 | (a) Clicking a project navigates to global all-tasks instead of project-scoped tasks. (b) Pagination caps at 120 of 2,093 — can't reach the rest. | **HIGH** |
| T06 | Menna 5/17 12:26 | Promote "Tasks without deadline" to a KPI tile, like the Projects page tile row. | **MEDIUM** |
| T07 | Gehad 5/17 11:32 + 5/10 3:07 + 5/7 4:59 + Menna 5/11 11:10 | Labels / Tags at project, task, AND **service** levels (e.g. "Hold"). Still not implemented. | **HIGH** |
| T08 | Menna 5/11 11:51 | Deadline can currently only be set on creation — need ability to edit it AFTER creation. | **HIGH** |
| T09 | Menna 5/11 11:51 | Periodic notification banner listing tasks created without a deadline. | **MEDIUM** |
| T10 | Gehad 5/17 10:00 | Custom-filter (the "Add Custom Filter" Rwasm widget) was added to the **Projects** page but is missing from the **Tasks** page. | **HIGH** |
| T11 | Menna 5/11 11:06 | Task should expose two count slots (design count + revisions count) — migration 0019 added the fields but UI doesn't surface them yet. | **MEDIUM** |

## B. Stages & approvals

| ID | Source | Request | Severity |
|---|---|---|---|
| S01 | Gehad 5/7 5:02 | **Stage lock** — once advanced, can't go back. Confirmation dialog when moving forward. | **HIGH** |
| S02 | Menna 5/17 12:32 + 5/18 12:32 | Per-stage Responsible Role (not just a single task-level role). | **HIGH** |
| S03 | Gehad 5/19 1:32 | Task-level Responsible = **employee**; stage-level Responsible = **position**. | **HIGH** |

## C. Project page

| ID | Source | Request | Severity |
|---|---|---|---|
| P01 | Menna 5/11 11:09 | Page nav order regressed — now opens project-info first then tasks; revert to tasks-first with an info button. | **HIGH** |
| P02 | Gehad 5/10 4:07–4:08 | **All Documents** section at project level (Rwasm parity). | **HIGH** |
| P03 | Menna 5/11 11:55 | Project-level log notes — discussed in meeting, still not built. | **MEDIUM** |
| P04 | Gehad 5/10 3:10 + Menna 5/11 11:12 | Project-creation wizard auto-skips step 3 (flashes for ~2 seconds then auto-creates). | **HIGH** |

## D. Templates, Roles, Departments

| ID | Source | Request | Severity |
|---|---|---|---|
| TM01 | Gehad 5/17 12:25 → Saad 1:23 confirmed | Task Templates Edit button added; Gehad subsequently asked for Delete too. | **VERIFY + DELETE** |
| TM02 | Gehad 5/17 12:25 + 5/17 1:21 | Departments page needs Edit (added) AND Delete (still pending). | **MEDIUM** |
| TM03 | Menna 5/17 12:24 | Type-to-filter combobox for the employee picker — current dropdown is unusable with the full employee list. | **HIGH** |
| TM04 | Menna 5/18 2:21 | Role dropdown missing **Team Leader**. Also, task-level Responsible dropdown shows the same options as per-stage Responsible — they should come from different sources. | **HIGH** |
| TM05 | Menna 5/18 2:24 | **Centralised positions catalogue** — positions added in Employees must auto-appear in Task Templates. Free-text → spelling drift breaks role→employee link. | **HIGH** |
| TM06 | Gehad 5/13 (top) + 5/14 3:00 PM | When an employee's manager is changed in their profile, the existing tasks for them still show the OLD manager. Employees & tasks aren't live-linked. | **HIGH** |
| TM07 | Gehad 5/10 3:17 | **Position must appear next to each employee name** throughout the system so stages show executor + responsible clearly. | **HIGH** |
| TM08 | Gehad 5/14 11:07 + 5/19 1:05 | Tasks should explicitly carry: who's the **Team Leader** for each Agent, and who's the **Department Head**. | **HIGH** |

## E. Service templates

| ID | Source | Request | Severity |
|---|---|---|---|
| SV01 | Menna 5/18 2:54–2:56 + Gehad 5/13 (top) | Service templates carry default assignees → auto-attach to every task in a project + operator can add per-project extras. | **HIGH** |
| SV02 | Gehad 5/10 4:11 | Can't create a new task inside a service template — action missing. | **HIGH** |
| SV03 | Gehad 5/7 4:59 + 5/10 3:07 | Tags at service-template level (in addition to project/task). | **MEDIUM** |

## F. Followers (Rwasm parity)

| ID | Source | Request | Severity |
|---|---|---|---|
| F01 | Gehad 5/13 (top) | Dashboard must pull and surface Followers — both at project level AND per-task. | **HIGH** |
| F02 | Menna 5/11 11:44 | Current Followers UI panel is nearly invisible — no obvious add/remove controls. | **HIGH** |

## G. Employee management

| ID | Source | Request | Severity |
|---|---|---|---|
| E01 | Gehad 5/19 12:53–1:05 + Menna 5/11 2:18 | Employee form must surface and allow edit of **Team Leader, Department Head, Job Title, Department**. Department Head missing from the form. | **HIGH** |
| E02 | Saad 5/11 2:18 + Gehad 5/11 2:30–2:32 (PDF "Sky light organization 2.pdf") | Organization chart at `/organization/chart` must match the structure in Mr. Mohammed's PDF. Current chart doesn't align. | **MEDIUM** |
| E03 | Gehad 5/11 2:29 | CRUD on positions/employees must propagate properly — adding/removing a position must update everywhere downstream. | **HIGH** |

## H. Holidays & working calendar

| ID | Source | Request | Severity |
|---|---|---|---|
| H01 | Menna 5/11 3:33–3:40 | Saudi-calendar shift didn't work in testing — adding a holiday should push deadlines forward by the holiday length. | **HIGH** |
| H02 | Gehad 5/10 4:09 | Holiday management per-project AND all-projects-wide (Eid as global, per-project for outages). | **HIGH** |

## I. Sync with Rwasm/Odoo

| ID | Source | Request | Severity |
|---|---|---|---|
| SY01 | Gehad 5/13 (top) + 5/14 2:03 | Document sync cadence (Saad confirmed: every hour) and what's pulled. | **MEDIUM** |
| SY02 | Saad 5/15 1:58 + Gehad 5/13 (top) | **Sync overwrites dashboard edits** — every hour the dashboard erases any action made locally. Need to define an override / preserve policy. | **HIGH** |
| SY03 | Gehad 5/14 2:03–2:07 | Counts pulled from Rwasm include archived items, inflating the totals — UI should distinguish active vs archived in the sync count. | **MEDIUM** |

## J. Activity / log notes

| ID | Source | Request | Severity |
|---|---|---|---|
| LN01 | Gehad 5/17 12:12 | Activity / log columns regressed and are missing again. Restore the full set. | **HIGH** |
| LN02 | Menna 5/11 11:55 | Project-level log notes (separately, see also P03). | **MEDIUM** |

## K. AI assistant

| ID | Source | Request | Severity |
|---|---|---|---|
| AI01 | Gehad 5/17 12:40 + 5/19 1:48 | AI returned only recent overdue tasks; had to be prompted to include months 1 & 2. Default to "all overdue, all time" via `tasks.is_overdue`. | **HIGH** |
| AI02 | Gehad 5/10 3:48 + Menna 5/11 11:47 | AI chat conversation history doesn't survive page navigation OR session close. Persist conversations. | **HIGH** |
| AI03 | Gehad 5/14 3:01 | AI sometimes "isn't working" — needs an empty-state / loading indicator and a retry path. | **MEDIUM** |

## L. Theme & a11y

| ID | Source | Request | Severity |
|---|---|---|---|
| TH01 | Gehad 5/17 12:23 | Light-mode font contrast too low. | **MEDIUM** |
| TH02 | Menna 5/11 11:43 | Arabic-locale notification UI doesn't render correctly. | **HIGH** |

## M. Subtasks / file uploads (needs meeting)

| ID | Source | Request | Severity |
|---|---|---|---|
| ST01 | Gehad 5/7 5:27 | "Uploading tasks inside a task itself" issue — long-standing pain point. Needs Gehad walkthrough; defer until that meeting happens. | **NEEDS MEETING** |

---

# Part B — Chronological log (every item tied to a date+time)

## 5/7/2026 — Meeting day
- 12:42 PM Eng. Mohammed: Wants a meeting; tested yesterday, has observations. Scope is project management only for now.
- 4:59 PM Gehad: Tag for "Hold" needs to be at **service** level too (T07/SV03).
- 5:02 PM Gehad: **Stage lock + confirmation dialog** — no backwards movement (S01).
- 5:27 PM Gehad: Task file-upload / inside-task issue, long-standing (ST01).
- 5:58 PM Saad: Acknowledged + arranged follow-up meeting.

## 5/10/2026 — Post-meeting batch
- 3:07 PM Gehad: Tags for all employees, "Hold" example (T07).
- 3:08 PM Gehad: Project NAME (not Project ID) on task rows (T04).
- 3:09 PM Gehad: Clicking project opens global all-tasks (T05a).
- 3:10 PM Gehad: Project creation wizard skips step 3 (P04).
- 3:17 PM Gehad: Position must appear next to each employee name (TM07).
- 3:48 PM Gehad: AI conversation history disappears (AI02).
- 4:07–4:08 PM Gehad: **All Documents** section at project level missing (P02).
- 4:09 PM Gehad: Holidays per-project AND all-projects-wide (H02).
- 4:11 PM Gehad: Can't create new task inside service (SV02).

## 5/11/2026 — Menna joins
- 11:06 AM Menna: Two count slots on task (design count + revisions count) still missing (T11).
- 11:09 AM Menna: Page nav order regression (P01).
- 11:10 AM Menna: TAGS still not added (T07).
- 11:11 AM Menna: Project ID still shown instead of project name (T04).
- 11:12 AM Menna: Project-creation wizard skip-step confirmed independently (P04).
- 11:43 AM Menna: Arabic-locale notification UI broken (TH02).
- 11:44 AM Menna: Followers UI nearly invisible (F02).
- 11:47 AM Menna: AI conversation history lost (AI02).
- 11:51 AM Menna: Need to add deadline AFTER creation (T08); periodic banner for tasks-without-deadline (T09).
- 11:55 AM Menna: Project-level log note still missing (P03 / LN02).
- 2:18 PM Saad: Org chart in progress; needs employee data (E02).
- 2:29 PM Gehad: Position editing flow must support add/edit/remove with propagation (E03).
- 2:32 PM Gehad: Sent PDF `Sky light organization 2.pdf` as reference for org chart structure.
- 3:33 PM Saad: Saudi-calendar shifts to first working day.
- 3:40 PM Menna: Tested it — shift didn't work as expected (H01).

## 5/12/2026
- 2:00 PM Saad: Asked to postpone meeting.
- 2:01 PM Saad: **"38 points were mentioned in the conversation"** — the canonical count.

## 5/13/2026 — Big post-meeting synthesis from Gehad
Single message thread covering:
- Employee-template separation (TM06).
- System must pull Followers from Rwasm at both levels (F01).
- Sync cadence / overwrite question (SY01 + SY02).

## 5/14/2026 (Thursday)
- 11:06 AM Gehad: Confirming Saad filled the data manually.
- 11:07 AM Gehad: Tasks need explicit Team Leader for each Agent + Department Head (TM08).
- 2:03 PM Gehad: Counts pulled from Rwasm include archived items (SY03).
- 3:00 PM Gehad: Asks again for employee ↔ task live link (TM06 confirmed).
- 3:01 PM Gehad: AI not working (AI03).

## 5/15/2026 (Friday)
- 10:41 AM Saad: Added "Add Custom Filter" on Projects.
- 1:58 PM Saad: **Sync overwrites dashboard edits** — happens every hour (SY02 confirmed by Saad himself).
- 1:59 PM Saad: Acknowledges potential crash if user is editing during the hourly sync.

## 5/17/2026 (Sunday)
- 10:00 AM Gehad: Custom filter added on Projects but missing on Tasks (T10).
- 10:07–10:08 AM Gehad: Ambiguous count badge (T01).
- 11:32 AM Gehad: Labels (T07).
- 11:46 AM Gehad: Flexible search (T02).
- 11:55 AM Gehad: Created by column (T03).
- 12:12 PM Gehad: Activity log regression (LN01).
- 12:23 PM Gehad: Light-mode contrast (TH01).
- 12:24 PM Menna: Type-to-filter employee picker (TM03).
- 12:25 PM Menna: Task Templates Edit + Departments Edit/Delete (TM01, TM02).
- 12:26 PM Menna: No-deadline KPI tile (T06).
- 12:32 PM Menna: Per-stage Responsible (S02).
- 12:40 PM Gehad: AI overdue completeness (AI01).
- 1:21 PM Gehad: Departments Delete (TM02).
- 1:32 PM Gehad: Task Responsible by employee / stage Responsible by position (S03).
- 5:21 PM Saad: Search v1 shipped — Gehad later marked it insufficient.

## 5/18/2026 (Monday)
- 2:21 PM Menna: Team Leader missing from Responsible dropdown; same dropdown used in two places (TM04).
- 2:24 PM Menna: Centralised positions catalogue (TM05).
- 2:54–2:56 PM Menna: Service template default assignees + per-project override (SV01).

## 5/19/2026 (Yesterday)
- 12:53 PM Gehad: Employees form needs Team Leader, Department Head, Job Title, Department (E01).
- 1:10 PM Gehad: Project name (not ID) on task rows (T04, repeated).
- 1:15 PM Gehad: Search still not flexible enough (T02, repeated).
- 3:50 PM Gehad: **Prime-directive statement** — "Rwasm is open, don't lock things in".
- 4:21 PM Gehad: Pagination cap at 120 of 2,093 (T05b).

---

# Part C — Severity rollup

- **HIGH** (32): T01, T02, T04, T05, T07, T08, T10, S01, S02, S03, P01, P02, P04, TM03, TM04, TM05, TM06, TM07, TM08, SV01, SV02, F01, F02, E01, E03, H01, H02, SY02, LN01, AI01, AI02, TH02
- **MEDIUM** (15): T03, T06, T09, T11, P03, TM01, TM02, SV03, E02, SY01, SY03, LN02, AI03, TH01
- **NEEDS MEETING** (1): ST01

**Total: 48 distinct items**

---

# Part D — What was implemented earlier today (then reverted)

In an earlier pass before this re-scroll I shipped (then reverted by the user):
- T01 + T06: a stats-row above the toolbar with Total/Open/Done/No-deadline.
- T03: a Created-by column backed by a new `task_creator_v` view (migration 0134).

The `task_creator_v` migration file and the `_loaders.ts` enrichment remain in place; the page-level UI tile row and the list-view column edit were reverted by the user. Hold all further code changes until Saad signs off on this v3 requirements doc.

---

# Part E — What still needs the client (open questions)

1. **ST01 subtask file uploads** — Gehad wants a meeting to walk Saad through the pain.
2. **SY02 sync overwrite policy** — what wins on conflict between dashboard edits and Rwasm sync? Last-write-wins, or local-edits-protected?
3. **H02 holiday scope** — is the per-project case applied to all child tasks regardless of stage, or only to in-progress?
4. **F01 + F02 followers** — should followers be **mirrored** from Rwasm (read-only) or **two-way synced** (so adding a follower in the dashboard pushes back to Rwasm)?
5. **E02 org chart** — Saad needs access to the original PDF file `Sky light organization 2.pdf` that Gehad forwarded; please save it into the project alongside this doc.

---

# Part F — Implementation phasing (re-scoped after v3)

- **Phase 1 — Tasks UX:** T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11.
- **Phase 2 — Stages + Templates + Roles:** S01–S03 + TM01–TM08.
- **Phase 3 — Services + Followers + Employees:** SV01–SV03 + F01–F02 + E01–E03.
- **Phase 4 — Activity log + Theme + AI:** LN01–LN02 + TH01–TH02 + AI01–AI03.
- **Phase 5 — Project page rework:** P01–P04.
- **Phase 6 — Holidays + Sync:** H01–H02 + SY01–SY03.
- **Phase 7 — Subtask uploads (after meeting):** ST01.
