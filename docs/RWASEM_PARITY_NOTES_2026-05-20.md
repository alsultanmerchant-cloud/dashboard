# Rwasem (Odoo) ↔ Dashboard parity notes — 2026-05-20

**Audience:** senior dev.
**Goal:** narrow the UI/UX gap between our dashboard and the Rwasem Odoo system the Skylight team uses today, so a long-time Odoo operator can switch without retraining. Read-only audit of `https://skylight.rwasem.com` against `localhost:3000`. No data was modified.

---

## ⚠️ PIXEL-PERFECT MANDATE (read this first)

> **Every button, tab, icon, smart-button pill, breadcrumb, pagination control, view-switcher, filter chip, and form field that exists in Rwasem MUST exist in our dashboard in the same position, with the same label, the same iconography, and the same data.** Our additional features (WhatsApp groups, renewal cycles, project holidays, AI assistant, approval gates, role-based assignees, 6-card KPI strip, etc.) come **AFTER** — visually below, or in a clearly separated section — never replacing, reordering, or hiding the Odoo equivalents.

Rules of engagement for every PR:
1. **Mirror first, extend second.** If a screen does not already pixel-match Rwasem, no merge of "our addition" UI changes for that screen lands until the mirror is in place.
2. **Same labels and same order.** Don't rename "Customer" → "Client", don't rename "Categories" → "Service categories", don't reorder fields. Operators read by position; renames break muscle memory.
3. **Same chrome density.** Action bar = one compact row (≤56 px). Smart-button pills inline with breadcrumb. Pagination top-right. Right-rail of icons. No tall colored banner on detail screens.
4. **Same icons.** When Odoo uses a `calendar / chart / pivot / graph / activity / gantt` icon in the view switcher, we use the same iconography in the same order.
5. **Our additions live below the Odoo body**, as their own card/section, with their own heading (`الأقسام الإضافية` / "Dashboard extras"). They never break the Odoo top-to-bottom reading flow.
6. **Acceptance test:** an experienced Skylight Odoo user, given a task to perform, can complete it in our dashboard in the same number of clicks, in the same locations, as in Rwasem — without help.

The rest of this document is the gap analysis. Use it as the source of truth for what must be added/moved to satisfy the mandate.

**Pages audited (Rwasem PRJ-01539 / Rayana — ذهبية - 6 شهور):**
1. Projects list (`action=794`, list + kanban)
2. Project info (form, all 4 tabs + chatter)
3. Tasks list (`action=804`, list + kanban + 7 view types)
4. Task info (form, all 7 tabs + chatter)
5. Global chrome / navigation

Existing in-tree references: `docs/ODOO_AUDIT.md`, `docs/RWASEM_DATA_GAP.md`, `supabase/migrations/0048..0062`.

---

## TL;DR — what the client will feel

> "Your dashboard looks nicer but I cannot find what I always have in Odoo."

The biggest gaps (ranked by what Skylight operators touch every day):

1. **No chatter / activity feed** on projects and tasks. This is where the team logs decisions, mentions teammates with `@`, attaches design files. Without it operators have nowhere to "talk about the work".
2. **No record-level pagination** (`< 47/105 >`). Odoo lets users walk through tasks one by one without going back to the list. Major workflow loss.
3. **Header banner is too tall** and the dashboard is missing **smart-button stat pills** in the header. Odoo packs Tasks count, Status, Collaborators, All Documents into compact clickable pills.
4. **List view is missing Odoo columns** the team scans every day: `Expected %`, `Progress Slip %`, `Hours Spent`, `Next Activity`, `Approval Status`.
5. **Task list view modes are too few** (we have kanban / list / calendar / pivot — Odoo also has Graph, Activity, Gantt).
6. **Several real bugs** in our project view (progress > 100 %, task count is org-wide instead of project-scoped, Tags row showing categories).

Address those 6 and most of the "this feels foreign" complaints go away.

---

## 1. Global chrome / navigation

### What Odoo has (operators rely on)

- **App switcher** (9-dot icon, top-left) — jump between Project, Discuss, Calendar, etc.
- **Module bar** (`Project` module > `Projects | Tasks | Project Category | Reporting | Configuration | Import Project`) — persistent across the whole module.
- **Breadcrumb action bar** (under the purple bar): `[New] Projects › ذهبية - 6 شهور  <gear>` plus inline smart-button pills (`Tasks 15`, `Project Status Done`, `Collaborators 0`, `All Documents 12`) and `1 / 1 < >` pagination at the far right.
- **View switcher** in the top-right (list, kanban, calendar, pivot, graph, activity, gantt).
- **Right rail** (Bookmark Panel, Magnifier, Search, Fullscreen, Add Bookmark) — power-user shortcuts.

### What we have

- Tall purple page banner with title + description.
- Top-right action cluster (`New`, search, calendar, dark-mode, agent, notifications).
- Sub-tab strip `Projects | Tasks | Service categories | Task templates | Reports | Import` repeated on every page.
- View switcher icons exist on listing pages but only show 3–4 views.
- No breadcrumb. No per-record pagination. No smart-button pills on detail pages.

### Dev notes

- **[NAV-1]** Replace the per-page tall banner on detail screens (`/projects/[id]`, `/tasks/[id]`) with an **Odoo-style action bar**: one compact row containing `[New] · Projects › <name> · <gear>` + smart-button pills + `n / N < >` pagination. Title and description can live below in a smaller block. The banner currently steals ~140 px vertically on every load.
- **[NAV-2]** Add **record pagination** to detail pages. Use the same filter context that brought the user to the record. Bind `Cmd/Ctrl + ←/→` as keyboard shortcuts to match Odoo muscle memory.
- **[NAV-3]** The page-level tabs (`Projects | Tasks | Service categories | Task templates | Reports | Import`) read as "sub-tabs of a page" but they are actually the **module bar**. Lift them out of the page card into a thin persistent module bar directly under the topbar — Odoo style — so they survive when the user is deep in a task and still feels like global navigation rather than something local to the current page.
- **[NAV-4]** Add a **right-rail of power-user shortcuts** (or a `cmd+k` palette) — Odoo's right rail is a defining "feels like Odoo" element. At minimum: Star (favorite), Search, Toggle fullscreen, Bookmark.
- **[NAV-5]** Drop the redundant "Tasks" tab when you are already on `/tasks`. Active state isn't enough — operators routinely click it expecting something to happen. Either remove the tab when active, or surface a meaningful "All Tasks vs My Tasks" toggle there (Odoo's Tasks menu opens to `My Tasks / All Tasks`).
- **[NAV-6]** Add a **9-dot app-switcher** affordance even if it only contains 2–3 destinations today — it primes the muscle memory for the eventual full Rwasem-replacement scope.

---

## 2. Projects list page (`/projects`)

### Parity already achieved

- Kanban card layout: project code, customer, progress bar, category chips, Store Name, Start, End, Site, Cost, Project Manager, Account Manager, `n Tasks` link, assignee avatars, status dot.
- View switcher: kanban / list / calendar.
- Filters: `With service categories` filter chip.

### Gaps vs Odoo

- **[PROJ-LIST-1]** Odoo's filter facet panel exposes: `My Projects`, `My Favorites`, `Unassigned`, `Timesheets >100%`, `Start Date`, `End Date`, `Archived`, `With Active Categories`, `All Categories Archived`, `Add Custom Filter`. We expose only `With service categories`. Add at minimum: `My Projects`, `My Favorites`, `Unassigned`, `Archived`, `Date range`. Implement as the same search-popover pattern (Filters / Group By / Favorites columns).
- **[PROJ-LIST-2]** Odoo Group By: `Project Manager`, `Status`, `Tags`. We have none. Add server-side groupBy with collapsible sections.
- **[PROJ-LIST-3]** Odoo "Favorites" lets users **save searches** (`Save current search`). High value for daily operators. We don't have it.
- **[PROJ-LIST-4]** Project totals off-by-one: Odoo says `1-74/74`, we say `75`. Re-run sync — likely a stale row or one project archived in Odoo but still active here. (Also note: per-card task counts mismatch — Odoo `15 Tasks` vs ours `16 مهام` for PRJ-01539, same family of issue.)
- **[PROJ-LIST-5]** Odoo list view columns are: `Project ID | Name | Customer | Project Manager | <status dot> | View Tasks`. Our list view should match these column names and order, plus `View Tasks` deep-link button at the end of the row.
- **[PROJ-LIST-6]** Our 6-card KPI strip at top (`إجمالي المشاريع / المهام / المتوسط / بدون ديدلاين / تحتاج موعد انتهاء / تجديدات هذا الشهر`) is a great addition — keep it. Just move it under the module bar so the page chrome stays compact.

---

## 3. Project info page (`/projects/[id]`)

### Layout reference (Odoo)

Top → bottom:
1. Action bar with breadcrumb, smart-button pills (`Tasks 15`, `Project Status Done`, `Collaborators 0`, `All Documents 12`), pagination.
2. `Share Read-only / Share Editable / Remove Category` buttons.
3. Two-column form: **left** = Name of the Tasks, Categories, embedded task list. **right** = Project Manager, Start Date, Total Progress %, Planned Date, Allocated Hours.
4. Below form: Working Calendar, Tags, Followers, Customer, Site Address.
5. **Bottom tabs:** `Description | Settings | Gantt Settings | Customer Info`.
6. **Chatter** with `Send message / Log note / Activities`, follow button, follower count, message history.

### Gaps + bugs vs Odoo

#### Bugs in our view to fix first
- **[PROJ-INFO-BUG-1]** `Total Progress (%)` shows `159%` for this project — value can never exceed 100. Inspect computation in `src/lib/data/projects.ts` and the trigger / view that populates progress.
- **[PROJ-INFO-BUG-2]** `Total Tasks 204` KPI card is showing the org-wide count, not the project's. Should match Odoo's `15`. Scope the query to the project id.
- **[PROJ-INFO-BUG-3]** Our `Tags` row is displaying Categories (`Renewal of Acc Manager`, `Renewal Media Buying`). Tags and Categories are different fields in Odoo — Tags must show `projects.tags` (currently empty in Odoo) and Categories must show `project_categories` chips. Fix the binding.
- **[PROJ-INFO-BUG-4]** Followers list only shows 1 person (`اية خفاجي`) vs 4 in Odoo. The Odoo sync didn't pull `message_follower_ids` — extend the importer.
- **[PROJ-INFO-BUG-5]** "Project Team" KPI says `1` but `Customer Info` data plus followers imply ≥4 people. Likely the same followers-sync issue.

#### Missing features (highest priority)
- **[PROJ-INFO-1] Chatter / activity feed** — `Send message`, `Log note`, `Activities`, `Follow`, follower count, timestamped activity feed grouped by date. This is the single biggest miss. Skylight operators write the brief, post @mentions, and dump design links into the chatter every day. Treat this as P0.
  - Sub-requirements: `@user` autocomplete, file attachments (inline images render as a grid like Odoo), reactions, "Follow" toggle with follower count badge.
  - Schema: we already have `task_activities` (migration 0060). Project chatter likely needs a parallel `project_messages` table or reuse the existing `audit_log` / `ai_event` rails with a message subtype.
- **[PROJ-INFO-2] Smart-button stat pills** in the action bar (`Tasks n`, `Project Status …`, `Collaborators n`, `All Documents n`). Each one should be a clickable link that filters the relevant child list.
- **[PROJ-INFO-3] Customer Info tab fields are richer in Odoo**:
  - `Store Name` — text (e.g. "Rayana")
  - `Target` — picklist (e.g. "OFF Target")
  - `Account Manager` — employee reference
  - `SEO Specialist`, `Media Specialist`, `Social Specialist` — already in our schema (migration 0049). We are missing **Store Name, Target, Account Manager**. Add columns to `projects` and surface them in our Customer Info section. The existing "Quick facts" card duplicates some of this and can be folded back in.
- **[PROJ-INFO-4] Settings tab content not yet visible in our dashboard**:
  - `Analytic Account` (free text, denormalized "Customer - Project" string),
  - `Visibility` (Invited internal users (private) / All internal users / Invited portal users + all internal (public)) — radio.
  - `End Date`,
  - `Financial Info` (currently "No costs"),
  - `Create tasks by sending an email to` (mail alias),
  - `TIME MANAGEMENT — Timesheets` (Log time on tasks) toggle,
  - `SALES & INVOICING — Billable` toggle.
  - These are operations levers Skylight uses. Decide which to implement vs ignore; document the decision.
- **[PROJ-INFO-5] Gantt Settings tab** has two columns of toggles Odoo users tweak:
  - Auto Mode Tasks (Start Date, End Date)
  - Gantt Chart Settings: `Dynamic Text`, `Dynamic Progress`, `Days Off`, `Quick Info` toggles
  - Tooltip Settings (Name, Duration, Start Date, End Date, Progress, Deadline, Stage, Constraint Type, Constraint Date — each its own toggle)
  - Mail Timesheet User
  We have `projects.gantt_prefs jsonb` (migration 0062) — extend the schema to cover all of these and render the same UI inside Gantt Settings tab.
- **[PROJ-INFO-6] All Documents tab / files** — Odoo header shows `All Documents 12`. We have no documents UI on the project. Either wire to Supabase Storage or surface a list of file links pulled from chatter attachments.

#### Our additions to keep (the client paid for these)
- WhatsApp groups (`قروب العميل / القروب الداخلي`) — keep, move below Customer Info tab.
- Project holidays — keep.
- `دورات التجديد` (Renewal cycles) — keep.
- Kanban Task Board embedded — keep, but scope the count to project (see BUG-2).
- AI assistant floating button — keep.

---

## 4. Tasks list page (`/tasks`)

### Parity already achieved

- Kanban view grouped by stage.
- List view.
- Calendar view, Pivot view.
- Saved filters: `Behind Schedule`, `Ahead of Schedule`, `Critical Delay`, `Due Today` (migration 0052) — match Odoo names exactly.
- `Open Tasks` quick filter chip.

### Gaps vs Odoo

- **[TASK-LIST-1] Missing list columns** Odoo shows by default: `Title | Project | Assignees | Task Progress (sparkline) | Task Progress (numeric) | Expected % | Progress Slip % | Hours Spent | Progress | Next Activity | Tags | Stage | Approval Status`. Our list has: `المهمة | المشروع | الخدمة | المرحلة | الفريق | الأولوية | الموعد النهائي | تصاميم | تعديلات | المدة في المرحلة | التقدم`. Map and add: `Expected %`, `Progress Slip %`, `Hours Spent`, `Next Activity`, `Approval Status`. These are the columns the team scans daily — "is the task slipping vs plan" is the question they answer from this view.
- **[TASK-LIST-2] Missing view modes:** Odoo has 7 (list, kanban, calendar, pivot, graph, activity, **gantt**). We have 4. Highest priority addition is **Gantt** (the `/projects/[id]/gantt` route only does single-project Gantt; we need a cross-project task Gantt). Then **Activity** view (mail.activity-style upcoming-to-do list per assignee) — we already have `task_activities` so the data is there.
- **[TASK-LIST-3] Missing filters:** Odoo exposes: `My Tasks`, `Followed`, `Unassigned`, `Private Tasks`, `Favorite Projects`, `Starred Tasks`, `Last Stage Update` (date range), `Deadline` (date range), `Open Tasks` (we have), `Closed Tasks`, `Closed On` (range), `Archived`, `In Progress (1-99%)`, `Completed (100%)`, `Not Started (0%)`, `Behind Schedule` (we have), `Ahead of Schedule` (we have), `Critical Delay` (we have), `Due Today` (we have).
- **[TASK-LIST-4] Missing Group By:** Odoo: `Assignees`, `Stage`, `Project`, `Tags`, `Customer`, `Creation Date`, `Assignment Date`, `Last Stage Update`, `Deadline`, `Properties`, `Progress Range`, `Category`. We need this many — operators reach for `Group by Assignee` and `Group by Customer` constantly.
- **[TASK-LIST-5] "Open Tasks" should be a removable chip** that lives in the search bar like Odoo, not part of the toolbar. The behavior is right; the placement is different.
- **[TASK-LIST-6]** Total task count on `/tasks` shows `200 of 903` (page size 200, total 903). Odoo says `1-80/856`. Investigate the delta (`903 - 856 = 47`) — probably tasks we created locally that haven't been written back to Odoo yet, but worth confirming with Skylight before they ask.
- **[TASK-LIST-7] Card density (kanban):** Odoo kanban card shows: title, time-ago badge (red if late: "27 days ago"), Duration, Service tag, progress bar, "Behind: X%", star, clock, assignee avatars, status dot. Our cards already match. Keep parity.

---

## 5. Task info page (`/tasks/[id]`)

### Parity already achieved

- Two-column form with similar fields (Project, Assignees, Tags, Service, Priority, Progress, Allocated time, Deadline, Planned date, Completed at, Delay days, Design count, Revision count).
- Stage chips in a horizontal progression bar.
- Internal Note vs Send message tabs at the bottom of the page.
- Sub-tasks, dependencies, timesheets, activities, stage history concepts (migrations 0048, 0051, 0056, 0057, 0060).

### Gaps vs Odoo

- **[TASK-INFO-1] Per-stage time-in-stage indicators** on the progression bar: Odoo shows `New 14d`, `In Progress`, `Manager Review 12h`, `Specialist Review 13h`, etc. Each completed stage shows the time the task spent there. We show only `24h` on the current stage. Surface time-in-stage for every stage the task has already crossed (data is in `task_stage_history` per migration 0048).
- **[TASK-INFO-2] Star priority widget** next to title (Odoo's `priority` is a 1-star "High" radio just to the right of the title). Our `Medium` chip works but the inline star feels native to Odoo users.
- **[TASK-INFO-3] Action bar with smart buttons + record pagination** (`1 / 105 < >`), same as PROJ-INFO. Add `All Documents` smart button at minimum.
- **[TASK-INFO-4] Bottom tabs structure** — Odoo: `Description | Gantt Detail | Timesheets | Sub-tasks | Link Task | Extra Info | Task Stage History`. Our task page scrolls vertically through similar sections. Switch to a tabbed structure to match Odoo muscle memory. Existing migrations already provide the data; this is presentation only.
  - `Gantt Detail` content: `Unschedule` (checkbox), `Task Type`, `Enable Task Duration` toggle, `Start Date`, `End Date`, `Duration`, `Average Hour per Day`, `Schedule Mode` (Auto/Manual radio), `Constraint Type` (As Soon As Possible / etc).
  - `Extra Info` content: `Parent Task`, `Analytic Account`, `Sequence`, `Email cc`, `Cover Image`, `Assignment Date`, `Last Stage Update`.
- **[TASK-INFO-5] Chatter parity** — same notes as PROJ-INFO-1. Odoo's task chatter is where the actual collaboration happens (design uploads from Google Drive, @mentions, deadline change logs auto-posted). Our `Internal note / Send message` tabs are the right surface but they need: `@user` autocomplete, file attachments, inline image rendering, auto-posted system messages on stage/deadline changes, reactions.
- **[TASK-INFO-6] "Approval gate" + role-card section we added** is more sophisticated than Odoo's flat assignee list — keep, but render it after the Odoo-style fields so muscle memory works.

---

## 6. Cross-cutting bug list (one consolidated view)

| # | Page | Issue | Fix locus |
|---|---|---|---|
| B1 | `/projects/[id]` | `Total Progress %` exceeds 100 | progress calc in `src/lib/data/projects.ts` + DB trigger |
| B2 | `/projects/[id]` | "Total Tasks 204" is org-wide instead of project-scoped | `getProjectStats(projectId)` query |
| B3 | `/projects/[id]` | Tags row renders Categories | view binding in `app/(dashboard)/projects/[id]/page.tsx` |
| B4 | `/projects/[id]` | Followers list incomplete (1 vs 4) | Odoo importer doesn't pull `message_follower_ids` |
| B5 | `/projects` | Project total off by one (75 vs 74) | reconcile sync vs source-of-truth |
| B6 | `/projects/[id]` | Per-project task count off by one (16 vs 15) | same scope/sync issue as B2/B5 |
| B7 | `/tasks` | Total `903` vs Odoo `856` | identify the delta (locally created tasks?) |

---

## 7. Rollout order — mirror first, extensions second

Three sequential waves. **Wave A and Wave B must ship before any new dashboard-extras UI work lands.** Each numbered item is a single PR.

### Wave A — pixel-perfect Odoo chrome (every page)
Until this wave is done, no extras work on the affected page.
- [NAV-1] Replace tall purple banner on detail screens with Odoo-style action bar (one row, ≤56 px): `[New] Projects › <name> <gear>` + smart-button pills + `n/N < >` pagination.
- [NAV-2] Record pagination (`< n / N >`) with `Cmd/Ctrl+←/→` binding.
- [NAV-3] Lift the page-level tabs into a persistent module bar under the global topbar (same items, same order: `Projects | Tasks | Project Category | Reporting | Configuration | Import Project`).
- [NAV-5] Remove redundant Tasks/Projects sub-tab on its own page, OR add Odoo's `My Tasks / All Tasks` split there.
- [NAV-6] 9-dot app switcher placeholder at top-left.
- [NAV-4] Right-rail of power-user shortcuts (Star, Search, Fullscreen, Bookmark, Magnifier) — same icons, same order.
- [PROJ-INFO-2] Smart-button stat pills inline on project action bar (`Tasks n`, `Project Status …`, `Collaborators n`, `All Documents n`) — same icons, same order, clickable.
- [TASK-INFO-3] Same smart-button pills on the task action bar.

### Wave B — pixel-perfect Odoo body (every page)
- [PROJ-LIST-5] Reorder Projects list columns to: `Project ID | Name | Customer | Project Manager | <status dot> | View Tasks` — same labels, same order.
- [PROJ-LIST-1, PROJ-LIST-2, PROJ-LIST-3] Filters/Group By/Favorites panel with the exact Odoo entries, in the same order.
- [PROJ-INFO-3] Add `Store Name`, `Target`, `Account Manager` to Customer Info tab. Tab order must remain `Description | Settings | Gantt Settings | Customer Info`.
- [PROJ-INFO-4] Settings tab fields in Odoo order (`Analytic Account`, `Visibility`, `End Date`, `Financial Info`, `Create tasks by sending an email to`, `Timesheets`, `Billable`).
- [PROJ-INFO-5] Gantt Settings tab toggles in the same two-column Odoo layout (`Auto Mode Tasks`, `Gantt Chart Settings`, `Tooltip Settings`, `Mail Timesheet User`).
- [TASK-LIST-1] Add list columns: `Expected %`, `Progress Slip %`, `Hours Spent`, `Next Activity`, `Approval Status` in the same positions as Odoo.
- [TASK-LIST-2] Add Gantt + Activity views to `/tasks` so the view switcher matches Odoo's 7-icon set, same icons same order: list, kanban, calendar, pivot, graph, activity, gantt.
- [TASK-LIST-3, TASK-LIST-4] Filters + Group By panel matches Odoo entries verbatim.
- [TASK-INFO-4] Restructure task page into tabs `Description | Gantt Detail | Timesheets | Sub-tasks | Link Task | Extra Info | Task Stage History` — same labels, same order.
- [TASK-INFO-1] Per-stage time-in-stage (`14d`, `12h`, `13h`) rendered on the stage progression bar.
- [TASK-INFO-2] Star priority widget inline with the title.
- [PROJ-INFO-1] Chatter parity (Send message / Log note / Activities tabs, Follow toggle, follower count, @mentions, attachments, inline image grid, auto-posted system events).
- [PROJ-INFO-6] Documents tab / smart-button content (file list).
- All B1–B7 bugs fixed.

### Wave C — extensions land below the mirror
Only starts once Waves A + B are merged for that page. Each extension lives in a clearly labelled section (`الأقسام الإضافية` / "Dashboard extras") **below** the Odoo body.
- WhatsApp groups (Project page, below Customer Info tab area).
- Project holidays (Project page, below Settings tab area).
- Renewal cycles (Project page, below Customer Info tab area).
- AI assistant floating widget (global, but never overlapping action bar).
- Approval gates panel (Task page, below the Odoo tabbed body).
- Role / Team-leader / Head-of-dept assignee cards (Task page, below default Assignees row).
- 6-card KPI strip on `/projects` (above the kanban, but **after** Odoo's action bar).

---

## 8. Where our extensions go (positioning spec)

**Rule:** an Odoo user scrolling top → bottom must see the Odoo layout exactly as in Rwasem before encountering any of our additions.

| Extension | Page | Position (top → bottom) | Heading |
|---|---|---|---|
| 6-card KPI strip | `/projects` | After Odoo action bar, before kanban/list view | (none; visual strip) |
| WhatsApp groups | `/projects/[id]` | After the 4 Odoo bottom tabs (Description/Settings/Gantt Settings/Customer Info), before chatter | `قنوات المشروع` |
| Project holidays | `/projects/[id]` | After WhatsApp groups, before chatter | `إجازات المشروع` |
| Renewal cycles | `/projects/[id]` | After Project holidays, before chatter | `دورات التجديد` |
| Embedded task board (kanban) | `/projects/[id]` | After Renewal cycles, before chatter | `لوحة المهام` |
| Quick facts card | `/projects/[id]` | Folded into the Customer Info tab content (don't show separately) | — |
| Approval gates | `/tasks/[id]` | After the 7 Odoo tabs, before chatter | `بوابات الموافقة` |
| Role / Team-leader / Head-of-dept cards | `/tasks/[id]` | Inside the default Assignees section as a collapsed "تفاصيل التعيين" expander — Odoo's Assignees row stays visible at the top | (collapsed by default) |
| AI assistant | global | Floating bottom-right, must not overlap the right-rail or action bar | (icon only) |

These all stay — they are paid-for differentiators — they just sit **after** the Odoo mirror, not interleaved with it.

---

## 9. Definition of done

A page is "parity-complete" when **all five** are true:
1. Screenshot diff vs Rwasem at 1440×900 (Chrome) shows action bar, smart pills, breadcrumb, pagination, right-rail, view switcher, filter chips, form-field order, and bottom-tab order in the same positions.
2. Every Odoo label is present and unchanged (Arabic + English where applicable).
3. Every Odoo icon in the view switcher / right-rail is the same icon (same SVG family) in the same order.
4. All bugs in §6 affecting that page are closed.
5. Our extensions are confined to the dedicated `الأقسام الإضافية` band defined in §8 — never above the Odoo mirror.
