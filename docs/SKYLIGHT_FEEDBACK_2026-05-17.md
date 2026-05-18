# Sky Light AI System — Client Feedback Notes

**Source:** WhatsApp group "Sky Light AI System"
**Reporter:** Gehad (+20 10 15954177)
**Date collected:** 2026-05-17 (messages span 10:00 AM – 12:41 PM)
**Status reply sent:** "جاري العمل علي الملحوظات" (work in progress)

Feedback is scoped to **Project Management** only. Contracts, HR, and the
other modules are explicitly out of scope for this round (per Mahmoud's reply
at 12:32 PM).

The client's reference behavior is repeatedly described as "زي رواسم" /
"like Rawasm" — i.e. the customized Odoo system they currently use day-to-day.
The new mr-dashboard should match that behavior unless we have a reason to
deviate.

---

## 1. Tasks page — filters parity with Projects page

**Where:** `/tasks` (`src/app/(dashboard)/tasks/page.tsx`)
**Severity:** High — blocks daily workflow.

**What Gehad reported (10:00 AM):**
> "حضرتك عملت الفلاتر في صفحة المشاريع بس مش المهام"
> "You added the filters on the Projects page but not on the Tasks page."

**What "the filter" looks like in Odoo/Rawasm (10:07 AM screenshot):**
- A pre-applied **"Open Tasks"** filter is on by default.
- The header shows the **count of open tasks** (tasks not yet in `done`).
- Clearing the filter shows **all tasks including completed ones**, and the
  count updates accordingly.

**Action:**
- On `/tasks`, port whatever filter chip / saved-filter system Projects uses.
- Default to the "Open Tasks" saved filter on first visit (consider seeding
  one of the hardcoded filters from migration `0052` — `Due Today` /
  `Behind Schedule` / `Critical Delay` — or add a 4th "Open" hardcoded
  filter if missing).
- Display a count next to the filter chip and update it as filters change.

---

## 2. Kanban column counts — ambiguous "open vs all"

**Where:** `/tasks?view=kanban` (also project-level kanban under
`/projects/[id]`).
**Severity:** Medium.

**Gehad (10:08 AM, screenshot of our kanban):**
> "حاولت هنا افهم العدد برضو كاتاسكات مفتوحة او التاسكات كلها باللي اتعملها
> done مش عارفة اوصل"
> "I tried to figure out — is the count showing open tasks, or all tasks
> including the ones marked done? I can't tell."

**Action:**
- Make the count semantics explicit in each kanban column header (e.g.
  `Stage name · 12 open` vs `Stage name · 12 / 17` showing open / total).
- Tie this to the active filter from item #1 so the count is consistent
  across the view.

---

## 3. Soft-delete / "find what was created in the dashboard"

**Context:**
- Mahmoud (10:29 AM): "السيستم بقي بيسحب الداتا ويمسح اي اكشن اتعمل علي
  الداشبورد… لو علي حسب مانا فهمت مسح اي حاجه اتكريتت في السيستم نفسه فا لا
  هما لسه موجودين" — i.e. Odoo sync overwrites dashboard-only edits;
  records created in Odoo itself are NOT deleted.
- Gehad (11:26–11:27 AM): asks for an **easy way to locate items that were
  created inside Odoo** vs items that originated in the dashboard, because
  "وارد اي حد جوا السيستم يكون عمل حاجه فا محتاجه اعرف أوصلها بسهوله"
  ("someone in Odoo might have created something and I need to reach it
  easily").
- Mahmoud (11:28 AM): proposed adding a **label**. Gehad approved.

**Action:**
- Surface the existing `external_source` / `external_id` columns
  (migrations `0011`, `0040`) as a visible **"Odoo / Dashboard" origin
  badge** on rows in Tasks, Projects, Clients, and Employees lists.
- Add a saved filter chip for "Origin = Odoo" / "Origin = Dashboard".
- Confirm copy with Gehad before shipping (she just wants discoverability,
  not separation).

---

## 4. Project card task count includes archived (should not)

**Where:** Project list / project card. The example was **PRJ-01587
"كرى أروما - ذهبية. ٦ شهور"** (`/projects/[id]`).
**Severity:** High — wrong number on a primary surface.

**Gehad (11:43 AM):**
> "هما 28 تاسك ومن جوا 28 فعلا بس اللي مكتوب برا مش عارفه لو القصد انه يحسب
> باللي موجود في الارشيف.. محتاجينه زي رواسم بيحسب عدد التاسكات المفتوحة
> حاليا"
> "There are 28 tasks, and inside really 28. But the number shown outside
> the card is something else — I don't know if it's counting the archived
> ones. We need it like Rawasm: counting the currently open tasks."

The shared screenshot shows the card displaying **"177 مهام"** for a project
that actually has 28 active tasks.

**Action:**
- The task-count badge on project cards should count **active /
  non-archived tasks only**. Exclude tasks where `stage = 'archived'` (or
  whatever flags an archived/cancelled task in our schema — confirm with
  `task_state` enum from migration `0054`).
- Apply the same fix wherever else the "X مهام" figure is rendered (Gantt
  header, AM dashboard, reports tiles).

---

## 5. Task search needs to be a forgiving "type to find"

**Where:** Tasks page search (both global `/tasks` and project-tab task
search).
**Severity:** Medium.

**Gehad (11:46 AM):**
> "محتاجة بس مرونة في السيرش زي رواسم علشان لو محتاجه اوصل لتاسك بشكل اسرع
> واكتب اسمه في السيرش"
> "I just need search to be flexible like Rawasm so I can find a task fast
> by typing its name."

**Action:**
- `listTasks()` already uses `websearch_to_tsquery` with the Arabic FTS
  column from migration `0061` — verify it's actually wired to the visible
  search input (not a separate stale filter).
- Add trigram / `ILIKE` fallback for short queries (1–2 chars) since
  `tsvector` queries don't match partial words.
- Show inline results / autocomplete (debounced) instead of requiring
  Enter.

---

## 6. Task activity log regressed — entries are missing

**Where:** `/tasks/[id]` → tab "سجل النشاط".
**Severity:** High — regression.

**Gehad (12:12 PM):**
> "اللوج نوت رجعت مبقتش كاملة تاني"
> "The log/notes came back to being incomplete again."

The screenshot shows stage-change entries (Sent to Client → Client Changes
→ Ready to Send → Specialist Review → In Progress) but evidently other
expected events are missing.

**Action:**
- Diff `task_activities` and `audit_log` writers against the previous
  working version. Likely culprits: comment posts, attachment uploads,
  assignee changes, approval gate events (migration `0048`), sub-task
  changes (migration `0056`), timesheet entries (`task_timesheets`).
- Re-confirm every mutation in `src/app/(dashboard)/tasks/` writes to
  `audit_log` per the working-rules section in CLAUDE.md.
- Add a regression test that creates each event type and asserts the
  activity feed contains all of them.

---

## 7. Light-mode contrast is unreadable

**Where:** Kanban / task cards in light theme (multiple screenshots).
**Severity:** Medium.

**Gehad (12:23 PM):**
> "لون الخط في اللايت مود مش واضح"
> "The font color in light mode is not clear."

**Action:**
- Audit Tailwind class usage on task cards and kanban headers for tokens
  that look fine in dark but wash out on light backgrounds (e.g.
  `text-muted-foreground` over pastel column tints).
- Sweep the "base-nova" shadcn theme overrides for any hard-coded greys.
- Test against the actual light palette shown in her screenshots (mint
  green columns, white surface).

---

## 8. Organization chart — duplicate / unclear nodes

**Where:** `/organization/chart` (`src/app/(dashboard)/organization/chart/page.tsx`).
**Severity:** Medium.

**Gehad (12:24 PM):**
> "في تكرار كتير وتفاصيل مش واضحة مختلفة عن اللي بعتناه"
> "There's a lot of duplication and unclear details, different from what
> we sent."

Red boxes in her screenshot highlight at least three duplicate nodes in
the chart.

**Action:**
- Compare current org seed (migration `0043_skylight_org_tree_seed.sql`)
  against the canonical org chart she shared previously (find in earlier
  WhatsApp / file shares).
- De-duplicate rows in `departments` / `employee_profiles` that share a
  name + role.
- Fix the chart renderer to collapse exact duplicates instead of drawing
  them as separate nodes.

---

## 9. Employee picker needs a typeahead

**Where:** Anywhere a user picks an employee — assignee, responsible,
approver, specialist slots (project + task), etc.
**Severity:** Medium — already painful, will get worse.

**Gehad (12:24 PM):**
> "محتاجين اوبشن كتابة هنا عشان نوصل للاسماء اسرع لان عدد الموظفين كبير"
> "We need a typing option here so we reach names faster — the employee
> count is large."

Screenshot shows a long scrolling dropdown without a search box.

**Action:**
- Replace `<select>` / static lists with the shadcn `Combobox` (Command
  primitive) — search-as-you-type.
- Touch points to check: task assignee/approver/specialist; project
  manager + specialist slots (migration `0049`); task delegations
  (migration `0039`); follower add UI (migrations `0023a`/`0023b`).

---

## 10. Task templates — no Edit action

**Where:** `/task-templates` and `/task-templates/[id]`.
**Severity:** High — blocks her from configuring auto-assignment.

**Gehad (12:25 PM):**
> "هنا قوالب المهام لسا مفهاش اوبشن تعديل ف مش عارفة اضيف دور المسؤول واجرب
> هل بناء عليه هيرتبط بالموظفين صح ولا لا"
> "Task templates still has no edit option, so I can't add the responsible
> role and test whether the employee link will resolve correctly."

**Action:**
- Add an Edit form to `/task-templates/[id]` covering at minimum:
  - title, default offsets (already covered by template defaults migration
    `0009`),
  - **responsible role** (FK into `roles`) so the template can drive
    auto-assignment via the role → employee resolution layer.
- After saving, regenerate any preview of "who would be assigned" so she
  can verify the link.

---

## 11. Employee record needs Team Leader + Department Head fields

**Where:** Employees list / employee detail
(`/organization/employees` + `[id]`).
**Severity:** Medium.

**Gehad (12:25 PM):**
> "بخصوص وجود التيم ليدر + الهيد للقسم لكل موظف لسا ماتضافش"
> "Regarding having a Team Leader + Department Head per employee — that
> hasn't been added yet."

**Action:**
- Two new FKs on `employee_profiles`:
  - `team_leader_employee_id` (nullable, FK → `employee_profiles`),
  - `department_head_employee_id` (nullable, FK → `employee_profiles`),
  or push these onto `departments` if "head of department" is naturally
  a department property (Gehad's phrasing suggests per-employee
  reference, so probably the employee-side FK is right).
- Surface both on the employee detail page and as columns/filters on
  the list.
- Cross-check with Org Chart fix in item #8 — the chart should respect
  these relations once they exist.

---

## 12. Departments page — no Edit action

**Where:** `/organization/departments` (+ `[id]`).
**Severity:** Medium.

**Gehad (12:25 PM):**
> "جزء الأقسام مفيش اي اوبشن للتعديل"
> "The Departments part has no edit option at all."

**Action:**
- Add an Edit dialog/page for `departments` rows. Fields at minimum:
  name (AR/EN), kind (from migration `0018`), parent, head employee
  (from item #11), and any sub-sections from `0018`.

---

## 13. Tasks page — missing "tasks with no deadline" KPI card

**Where:** `/tasks` page header tiles. The reference is the equivalent
tile already shown on `/projects`.
**Severity:** Low–Medium.

**Gehad (12:26 PM):**
> "لو في امكانية لاضافة عدد المهام المقترحة اللي بدون ديدلاين حاليا في صفحة
> المهام (زي اللي ف المشاريع دي)"
> "If possible, add the count of suggested/open tasks currently without a
> deadline on the Tasks page (like the one on Projects)."

**Action:**
- Add a KPI tile counting `tasks where deadline is null and state in
  ('todo','in_progress' …)` to the Tasks header.
- Clicking the tile applies the matching filter.

---

## 14. AI assistant — incomplete results on first reply

**Where:** `/agent` (`src/app/api/agent/route.ts`, Gemini-backed assistant).
**Severity:** Medium — trust issue with the AI surface.

**Gehad (12:40 PM):**
> "الـAI احسن من الاول اكيد بس هو معلوماته مش كامله — يعني مثلا طلبت منه
> يجيبلي اقدم التاسكات المتأخرة جاب انه من بداية شهر 3. رجعت اللفت انتباهه
> ان عندنا تاسكات من شهر 2 و 1 متأخرة، رجع بعتهوملي."
> "The AI is better than before, but its info isn't complete. I asked for
> the oldest delayed tasks — it returned only from start of month 3. When
> I pointed out we have delayed tasks from months 2 and 1, it then
> returned them."

**Action:**
- The agent's tool calls are almost certainly paginating or LIMITing
  results without making that visible. Audit the SQL/RPC the agent uses
  for "overdue tasks" — remove the implicit cap, or set the order
  explicitly to `deadline asc` (oldest first) and surface "showing N of
  M; ask for more" when capped.
- Add a deterministic system-prompt rule: when the user asks for "oldest"
  / "earliest" / "all" overdue items, the tool must sort by `deadline asc`
  and not truncate without disclosing the cap.

---

---

## 15. Odoo sync field completeness — `create_uid`, chatter, sub-tasks, deps missing

**Where:** `src/lib/odoo/importer.ts` line 953, the `TASK_FIELDS` array.
**Severity:** High — likely the root cause of #6 (activity log) and of
multiple smaller "X is missing on tasks" complaints.

**What's surfaced today vs what's missing:**

The current importer asks Odoo for 30 fields on `project.task` but does not
request:

| Missing field | Why it matters |
|---|---|
| `create_uid` | "Who created this task" — explicitly flagged by the client |
| `write_uid`, `write_date` | "Who last modified" — needed for the activity log |
| `message_ids` | The chatter / activity-log payload from Odoo. If we never pull it, our `task_activities` is empty for any task that originated in Odoo — directly causes #6. |
| `message_follower_ids` | Followers list (RLS + notifications target) |
| `parent_id`, `child_ids` | Sub-task tree (migration `0056`) silently misses imported sub-tasks |
| `depend_on_ids`, `dependent_ids` | Task dependencies (migration `0051`) — Gantt edges will be empty for any imported task |
| `kanban_state` | Blocked/ready flag — visible in stock Odoo kanban, lost in our import |
| `partner_id` | Customer link — needed for AM dashboard scoping |

**Action:**
- Expand `TASK_FIELDS` with all of the above.
- Stretch `OdooTask` type in `src/lib/odoo/types.ts`.
- Add columns + indexes in a new migration `0064_odoo_task_sync_fields.sql`
  for the ones we don't store yet (creator/modifier user FKs are the main
  ones — `task_activities` already has the right shape for chatter).
- Importer: map each new field into the staged row, including expanding
  `message_ids` into a chatter back-fill into `task_activities`
  (one-time per task, idempotent on `external_id`).
- Same audit on `PROJECT_FIELDS`, `CLIENT_FIELDS`, `EMPLOYEE_FIELDS` —
  if `create_uid` is missing here too, surface it.

**Verification:**
- Run `bun run sync:odoo` end-to-end.
- Open a task in `/tasks/[id]` that originated in Odoo: confirm the
  "Created by" pill is populated, the Activity Log tab shows historic
  Odoo chatter, sub-task tab shows the children, and the Gantt has the
  dependency edges.

---

## Closing note from the conversation

Gehad confirmed at 12:41 PM **"@Mahmoud Saad كدا تمام"** — the list above
is the complete set of project-management adjustments for this round.
Other modules (Contracts, HR) will come in a later batch.

---

## Suggested execution order

1. **Fix #6 first** (activity log regression — data correctness).
2. **Fix #4** (wrong task count on project cards — visible everywhere).
3. **Fix #1 + #2 + #13** together (Tasks page filter parity, kanban count
   labels, missing KPI tile — one coherent PR for `/tasks`).
4. **Fix #5** (search flexibility).
5. **Fix #9** (employee combobox — reusable component, unblocks others).
6. **Fix #10 + #11 + #12** together (org admin: template edit, employee
   FKs, department edit — one PR for `/organization` and
   `/task-templates`).
7. **Fix #8** (org chart de-dup, depends on #11 being in).
8. **Fix #3** (origin badge / label).
9. **Fix #7** (light-mode contrast pass).
10. **Fix #14** (AI completeness — separate, easy to verify with the same
    prompt Gehad used).
