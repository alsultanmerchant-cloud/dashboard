# Engineering Plan — Technical-First Track

> Per owner directive (2026-05-02): **"التيكنيكال اولوية"** — build everything serving the Technical department first. Sales/Telesales is **deferred** to a later track.
>
> This plan is the engineering execution layer below `MASTER_PLAN.md`. Where the master plan says "Phase 14 — Sales Engine," this plan says **deferred — see Sales Track parking lot**.

---

## How to read this doc

- **T-phases** = Technical track (in scope now).
- **S-phases** = Sales track (parked).
- Each T-phase lists: **goal · migrations · server actions · UI · permissions · tests · acceptance · estimated days**.
- All dates are calendar days (Sunday–Thursday Saudi week).
- Every phase ships behind a `feature_flags` row, gradually rolled out per role.

---

## Re-prioritized phase order (technical track only)

```
T0  Foundation        →  T1 Org realignment   →  T2 Permissions hardening
       ↓                       ↓                          ↓
T3 PDF gaps           →  T4 Categories engine →  T5 Decisions + SLA + Escalation
       ↓                       ↓                          ↓
T6 Governance         →  T7 Renewal Cycles    →  T7.5 Commercial Layer (NEW)
       ↓                       ↓
T9 Reporting/KPIs     →  T10 Cutover from Odoo
                         (S-phases + F1 WhatsApp run after T10)
```

Total estimate: **≈ 16–17 weeks** (~4 months) for a 1-engineer track — bumped from 14 due to T7.5. Add 30–40% if shared with other work.

---

## T0 — Foundation (1–2 days)

**Goal:** make every later phase shippable behind a flag, with clean docs and instrumentation.

### Migrations
- `0014_feature_flags.sql` — table `feature_flags(key TEXT PRIMARY KEY, enabled BOOL, rollout_roles TEXT[], updated_at)`.

### Code
- `src/lib/feature-flags.ts` — `isFlagOn(key, user)` server-side helper; cached per request.
- Wire `<FeatureFlag flag="..." />` server component for UI gating.

### UI
- `/settings/feature-flags` admin-only page — toggle flags, see rollout %.

### Tests
- Unit: `isFlagOn` honors `rollout_roles`.

### Acceptance
- Owner toggles a flag → effect visible in <1s for the next request.

---

## T1 — Org realignment (3–4 days)

**Goal:** schema mirrors the owner's org chart. Every later phase references positions and tiers correctly.

### Migrations
- `0015_org_realignment.sql`:
  - `departments` → add `parent_department_id UUID REFERENCES departments(id)`, `head_user_id UUID`, `kind TEXT CHECK IN ('technical','sales','admin')`.
  - `employee_profiles` → add `position TEXT CHECK IN ('head','team_lead','specialist','agent','admin')`.
  - New table `department_team_leads(department_id, user_id, PRIMARY KEY)` (multi-lead).
  - **Seed insert (technical, owner-confirmed 2026-05-02)**:
    - Account Management — Head: آيه خفاجي · 3 team leads
    - Media Buying — Head: أشرف مختار · 1 team lead
    - SEO — Head: حسن شاهين · 2 team leads
    - Social Media — Head: حسن ياسر · 1 team lead (also writes content)
    - Designing — Head: عمر الخيام · 0 team leads
    - Programming — single contributor: زياد حجي (no head, no leads)
    - SEO Content — Head: محمد عادل · 0 team leads
    - **NOT seeded:** Social Content (dissolved — work moved to Social Media)
    - **NOT seeded:** QC (dropped from scope per owner directive 2026-05-02 round 3 — "ignore the QC for now")
  - Sales + Telesales as children of a `Sales` parent under `kind='sales'` (created but parked behind `sales_track_enabled` flag).
  - HR, Accountant, Assistants under `kind='admin'`.

### Server actions
- `setDepartmentHead(deptId, userId)` — gated to admin permission.
- `addTeamLead(deptId, userId)` / `removeTeamLead(...)`.
- `setEmployeePosition(userId, position)`.

### UI
- `/organization/chart` — visual org chart (D3 or simple recursive component); RTL-correct.
- `/organization/departments/[id]` — header shows Head + Team Leads + Members; admin can edit.
- Sidebar group "Sales" hidden behind feature flag `sales_track_enabled` (off).

### Permissions
- New permission keys: `org.manage_structure`, `org.assign_position`. Owner + Admin role get both.

### Importer (read-only Odoo → Supabase)
- One-shot script: `scripts/import-odoo-org.ts`
  - Reads 110 `res.users`.
  - Maps `manager-group` (28 members) → `position='team_lead'` provisional.
  - Maps `member-group` (39 members) → `position='agent'` provisional.
  - Generates a CSV report `tmp/org-import-review.csv` for owner to verify before committing positions.

### Tests
- Migration round-trip on a fresh Supabase branch.
- Server-action: non-admin cannot setDepartmentHead.
- E2E: owner sees full chart with seeded depts.

### Acceptance
- Owner opens `/organization/chart` and sees: Sales (greyed), Technical (12 depts), Admin (4 depts), with placeholder Heads/Team Leads ready for real assignment.

---

## T2 — Permissions hardening (3 days)

**Goal:** enforce the three-tier permission model from owner §10. Agents see ONLY their own tasks.

### Migrations
- `0016_rls_tighten.sql`:
  - Replace permissive `tasks SELECT` policy with:
    ```sql
    USING (
      has_permission(auth.uid(), 'task.view_all')
      OR auth.uid() = ANY(assignee_ids)
      OR auth.uid() = ANY(follower_ids)
      OR auth.uid() = owner_user_id
    )
    ```
  - Same shape for `task_messages`, `task_attachments`.
  - New permission keys: `task.view_all` (Head + AM + QC + Admin), `task.transition_*` per stage.

### Server actions
- Audit + harden every action under `src/app/(dashboard)/tasks/_actions.ts`:
  - `transitionStage` — re-verify `STAGE_EXIT_ROLE` against caller permission, not just role-name string.
  - `addLogNote` — verify caller is assignee/follower/owner/has_view_all.

### UI
- Re-render `/tasks` and `/projects/[id]/tasks` with the tightened query — verify Agent role only sees own tasks.

### Tests
- **Critical:** `tests/rls-attack.spec.ts` — login as seeded Agent, try direct Supabase queries, expect 0 rows for other people's tasks.
- E2E: Agent can move their task `In Progress → Manager Review`; cannot move someone else's.

### Acceptance
- Three test users (Owner, Manager, Agent) each see exactly the right slices in `/tasks`.

---

## T3 — Task workflow PDF gaps (4–5 days)

**Goal:** close every ✅/⚠️/❌ in `SPEC_FROM_PDF.md` §13.

### Migrations
- `0017_task_pdf_gaps.sql`:
  - `tasks.delay_days INTEGER GENERATED ALWAYS AS (CASE WHEN status='done' AND deadline IS NOT NULL THEN GREATEST(0, EXTRACT(DAY FROM completed_at - deadline)::INT) END) STORED`.
  - `tasks.hold_reason TEXT`, `tasks.hold_since TIMESTAMPTZ`.
  - New `task_followers(task_id, user_id, added_by, added_at, PRIMARY KEY)` — separate from assignees.
  - `projects.status` enum extended with `'hold'` + `projects.hold_reason TEXT`.

### Server actions
- `addFollower(taskId, userId)` / `removeFollower(...)`.
- `setProjectHold(projectId, reason)` / `resumeProject(projectId)`.

### UI
- Task detail page:
  - **Tab: "تاريخ المراحل" (Stage History)** — surface `audit_log` filtered to this task.
  - **Section: Followers** — distinct from Assignees, with avatars + add/remove control.
  - **Banner: Delay** — shows `delay_days` if > 0 with red severity.
  - **Log Note attachments** — wire Supabase Storage; thumbnails for images, icon for files.
- Project box: HOLD overlay when status='hold' (red ribbon + reason on hover).

### Verification (no code change)
- Audit migration `0013` against `SPEC_FROM_PDF.md` §11 — every offset matches. Write a test that asserts the offset rows exist.

### Tests
- E2E: AM puts project on HOLD with reason → all task cards show HOLD ribbon → AM resumes → ribbon clears.
- E2E: Specialist adds an Agent as follower → Agent sees task in own list (assignment-or-follower visibility).

### Acceptance
- `SPEC_FROM_PDF.md` §13 delta table: every row turns ✅.

---

## T4 — Categories Engine (5–7 days)

**Goal:** port Odoo's task-template engine. Creating a project + selecting services auto-generates the right tasks with correct deadlines and assignees.

### Migrations
- `0018_categories_engine.sql`:
  - `service_categories(id, key TEXT UNIQUE, name_ar, name_en, color)`.
    - Seed: Onboarding, Social Media, Media Buying, SEO, SEO Content, Designing, Programming, Social Content, Renewal — full list from owner doc + Odoo audit.
  - `task_templates(id, category_id, name_ar, name_en, default_owner_position, deadline_offset_days, upload_offset_days, default_followers_positions[], depends_on_template_id NULL)`.
  - `project_services(project_id, category_id, week_split BOOL, weeks INT, PRIMARY KEY (project_id, category_id))` — for the "Social Media split into 3 weeks" case.

### Importer
- `scripts/import-odoo-categories.ts` — reads `project.category` (13 records) + `project.category.task` (279 records) from live Odoo via the existing `OdooClient`. **READ ONLY.** Writes to Supabase. Supports re-run (idempotent on `(category_key, name_en)`).
- Includes a dry-run mode dumping a CSV diff first.

### Server actions
- `createProject(input)` extended:
  - After project insert, read selected `project_services` → expand into `tasks` rows.
  - For each template, compute `deadline = project.start_date + offset` (or `project.end_date − offset` per existing handover engine).
  - For Social Media with `week_split=true, weeks=3`: generate 3 copies of each weekly template with offsets per `SPEC_FROM_PDF.md §11`.
  - Default `owner_user_id` = the department member with matching `position` and lowest current load.
  - Followers seeded from `default_followers_positions[]`.

### UI
- `/projects/new` form:
  - "Import Categories" multi-select (chips, RTL).
  - Preview pane: shows the tasks that will be generated, with deadlines, before user clicks Create.
  - Toggle "Split Social Media across N weeks" with N input.
- `/service-categories` admin page — list + edit templates, drag-to-reorder, edit offsets.

### Permissions
- `category.manage_templates` → Admin + Head only.
- `project.create` → AM + Head + Admin.

### Tests
- Unit: offset computation matches §11 PDF table for every (service, week) combination.
- E2E: AM creates project with Social + SEO → exactly the expected number of tasks generated with right deadlines.
- Importer dry-run on staging Odoo.

### Acceptance
- Owner picks a real client + services → sees the task list materialize, then commits.

---

## T5 — Decisions + SLA + Escalation engine (6–8 days) ✅ Q5 answered

**Goal:** owner's Layers 6 + 8 — decisions and escalations as data, with an SLA engine that auto-escalates on breach.

### SLA values (from owner 2026-05-02)

| Stage | Max | Source |
|---|---|---|
| New | per-template | `task_templates.sla_minutes_new` |
| In Progress | per-template | `task_templates.sla_minutes_in_progress` |
| Manager Review | 30 min | `sla_rules` global |
| Specialist Review | 30 min | `sla_rules` global |
| Ready to Send | 15 min | `sla_rules` global |
| Sent to Client | 4 hr (240 min) | `sla_rules` global |
| Client Changes | **8 hr (480 min)** — same workday or next | `sla_rules` global — hard cap (revised per owner 2026-05-02 round 2) |

**Business-hours clock (owner-confirmed 2026-05-02):** Sun–Thu, 09:00–17:00 Asia/Riyadh. SLA timer pauses outside these windows.

### Migrations
- `0019_decisions_escalations.sql`:
  - `decision_rights(id, decision_key TEXT UNIQUE, owner_position TEXT, scope_note TEXT)` seeded from owner §13.
  - `escalation_paths(id, kind TEXT CHECK IN ('operational','functional','client','critical'), from_position, to_position, sla_minutes INTEGER NULL)`.
  - `sla_rules(id, stage_key TEXT UNIQUE, max_minutes INTEGER, severity TEXT, business_hours_only BOOL DEFAULT TRUE)` — **seeded with the 5 global rows above**.
  - `task_templates` extended in T4 migration; back-port: `ALTER TABLE task_templates ADD COLUMN sla_minutes_new INTEGER, ADD COLUMN sla_minutes_in_progress INTEGER`.
  - `tasks` extended: `ADD COLUMN sla_override_minutes INTEGER NULL` (manual AM override per task).
  - `exceptions(id, task_id, kind TEXT CHECK IN ('client','deadline','quality','resource'), reason TEXT, opened_by, opened_at, resolved_by, resolved_at, resolution_note)`.
  - `escalations(id, exception_id NULL, task_id, level INT, raised_to_user_id, raised_at, acknowledged_at, status)`.
  - `business_hours(weekday INT, open_time TIME, close_time TIME, tz TEXT DEFAULT 'Asia/Riyadh')` — seeded **Sun–Thu, 09:00–17:00** (weekdays 0,1,2,3,4 in Postgres `EXTRACT(DOW)` where 0=Sun).

### Edge function
- `supabase/functions/sla-watcher/index.ts`:
  - **Runs every 5 min** via Supabase cron (15-min SLA requires sub-15-min cadence).
  - For each task not in `done`:
    - Compute effective time-in-current-stage **using business-hours arithmetic** (subtract overnight + weekend periods) when `sla_rules.business_hours_only=true`.
    - Resolve `max_minutes`: per-task override → per-template (for New/In Progress) → global rule.
    - If exceeded → create `exceptions` row (kind=`deadline`) + `escalations` row → `notifications` to Team Lead → `ai_event` (`SLA_BREACHED`).
  - Idempotent: skip if open exception already exists for `(task_id, current_stage_entered_at)`.
  - Helper: `business_minutes_between(start, end)` SQL function for accurate window math.

### Server actions
- `openException(taskId, kind, reason)` — manual exception creation.
- `resolveException(id, note)` — closes + writes audit.
- `acknowledgeEscalation(id)`.

### UI
- `/escalations` — inbox view per logged-in user, filterable by kind.
- Task detail: red badge when has open exception; modal to open/resolve.
- Dashboard tile: "تصعيدات مفتوحة" count + breakdown by kind.

### Tests
- Edge function unit: simulated stage entries → expected exception count.
- E2E: force a task past SLA → exception appears in Lead's inbox within 5 min.

### Acceptance
- Owner watches a task breach SLA in dev → escalation surfaces in Lead's `/escalations` and on the dashboard.

---

## T6 — Governance enforcement (4 days) — QC observer dropped per 2026-05-02 round 3

**Goal:** owner's 5 governance rules become enforced behavior, not just docs.

### Migrations
- `0020_governance.sql`:
  - `governance_violations(id, kind TEXT, task_id NULL, project_id NULL, detected_at, resolver_user_id NULL, resolved_at)` — kinds: `missing_log_note`, `stage_jump`, `unowned_task`, `permission_breach`.

### Server actions
- `transitionStage` extended: require a non-empty `task_message` written within last 5 min by caller. Rule from owner §10 (Log Notes = source of truth).

### Edge function (or server cron)
- `governance-watcher`:
  - Daily: find tasks not in `done` with no log note in last 7 days → flag `missing_log_note`.
  - Find tasks where `owner_user_id IS NULL` → flag `unowned_task`.

### UI
- `/governance` — admin/head dashboard (no QC role):
  - Counts by violation kind.
  - List of open violations, click-through to record.
  - Resolve button gated to `governance.resolve` permission.
- Admin sees governance tile on main dashboard.

### Permissions
- `governance.view` → Head + Admin.
- `governance.resolve` → Admin.

### Tests
- E2E: try to transition stage without a log note → blocked with friendly Arabic error.
- Cron: simulate stale task → violation row appears.

### Acceptance
- QC user lands on `/governance`, sees the day's issues at a glance.

---

## T7 — Renewal Cycles (5 days) ⚠ depends on owner's Sheet + Q7

**Goal:** make renewals first-class, supporting variable cycles per project (per owner: monthly / quarterly / 6-monthly / package-specific).

### Migrations
- `0021_renewals.sql`:
  - `projects.cycle_length_months INTEGER NULL` (NULL = one-time).
  - `projects.next_renewal_date DATE NULL`.
  - `renewal_cycles(id, project_id, cycle_no INT, started_at DATE, ended_at DATE, status TEXT)` — Q7 says new project row OR new cycle row; default to **new cycle row** unless owner says otherwise (preserves history without duplicating client/contract data).

### Importer
- `scripts/import-renewal-sheet.ts` — once owner sends the Sheet, parse & upsert into `projects` + `renewal_cycles`.

### Server actions
- `startRenewalCycle(projectId)` — creates new `renewal_cycles` row + auto-generates renewal-category tasks (uses T4 engine).
- `setProjectCycle(projectId, lengthMonths, nextRenewalDate)`.

### Edge function
- `renewal-scheduler` (daily): for each project where `next_renewal_date - today <= 14 days` and no current cycle for that period → fire `notifications` to AM (`RENEWAL_DUE_SOON`).

### UI
- Project box: small badge showing "تجديد خلال X يوم" if approaching.
- Project detail tab: **Renewal History** — table of cycles.
- Dashboard tile: "تجديدات هذا الشهر" with click-through.

### Tests
- E2E: set `next_renewal_date` → 13 days later → notification fires.

### Acceptance
- Owner's renewal Sheet imported; "تجديدات هذا الشهر" tile shows the right count vs the Sheet.

---

## ~~T8 — WhatsApp integration~~ — **DROPPED from current scope**

Owner directive 2026-05-02: "for whatsapp ignore it for now". Moved to **Future Phase F1**. Original detail preserved below for when it returns.

## T8 — WhatsApp integration (DEFERRED) (5–8 days) ⚠ blocked on Q6 (account type)

**Goal:** close the Dual Operating Control loop — auto-create client + internal groups, route inbound, send templated outbound.

### Pre-req
- Owner must confirm: WhatsApp **Cloud API** (preferred — supports automation) or Business app (no automation; we'd be limited to deep links).

### Assuming Cloud API:

### Migrations
- `0022_whatsapp.sql`:
  - `whatsapp_groups(id, project_id, kind TEXT CHECK IN ('client','internal'), wa_group_id TEXT, name TEXT, created_at)`.
  - `whatsapp_messages(id, group_id, direction, from_user_id NULL, body TEXT, sent_at, raw JSONB)`.
  - `whatsapp_templates(id, key, body_ar, body_en, variables JSONB)`.

### Server actions / API routes
- `/api/whatsapp/webhook` — inbound message receiver, signature-verified.
- `createWhatsAppGroupsForProject(projectId)`:
  - Calls Cloud API: create group `إدارة نشاط | <client_name>` (kind=client), add AM as admin.
  - Calls Cloud API: create group `📍 <client_name>` (kind=internal), add AM + Specialist + Manager.
- Templated send actions: `notifyClientTaskSent(taskId)`, `notifyClientChangesRequested(taskId)`, etc.

### UI
- Project detail: WhatsApp panel showing group links + recent messages.
- Settings: `/settings/whatsapp` — enter Cloud API credentials, test webhook.

### Tests
- Mocked webhook integration test.
- E2E: create project → both groups exist within 30s.

### Acceptance
- AM creates a project → client + internal groups appear, named per convention; an inbound client message shows up as a notification on the AM's dashboard.

---

## T7.5 — Commercial Layer (8–10 days) ⚠ NEW PHASE — discovered via Acc Sheet

**Goal:** port the entire AM commercial operating system from `docs/data/acc-sheet.xlsx` into Supabase. The sheet has **~5,000 rows of live data** across 7 tabs and represents revenue, contracts, and AM performance — currently 100% in Excel.

### Schema additions (`0021b_commercial_layer.sql`)
- `services_catalog(id, key, name_ar, price, price_type ENUM('Monthly','OneTime','Quarterly'), extra_days INT, active BOOL)`
  - Seed: نوفا, ذهبية, حملات, etc. from `CEO_Dashboard` tab.
- `contract_types(id, key)` — seed: New, Renew, Lost, Hold, UPSELL, Win-Back, Switch.
- `packages(id, name_ar, included_services_ids[])` — seed from Clients Contracts.Package column (حملات, سوشيال, نوفا+حملات...).
- `contracts(id, client_id, account_manager_id, contract_type_id, package_id, start_date, target ENUM('On-Target','Overdue','Lost','Renewed'), duration_months, total_value, paid_value, status, total_days_computed)`.
- `installments(id, contract_id, sequence INT, expected_date, expected_amount, actual_date, actual_amount, status)`.
- `monthly_cycles(id, contract_id, cycle_no INT, month DATE, state, start_date, grace_days INT, expected_meeting_date, actual_meeting_date, meeting_status, meeting_delay_days, expected_cycle_add_date, actual_cycle_add_date)`.
- `am_targets(id, account_manager_id, month DATE, expected_total, achieved_total, achievement_pct, breakdown_json JSONB)`.
- `contract_events(id, contract_id, event_type, occurred_at, actor_id, payload JSONB)` — replaces `Edits Updates log` tab.

### Importer
- `scripts/import-acc-sheet.ts`:
  - Reads `docs/data/acc-sheet.xlsx` via the `xlsx` Bun package.
  - Tab-by-tab: clients → contracts → installments → cycles → events → targets.
  - Idempotent on `(Client ID, contract.start_date)`.
  - Dry-run produces a CSV diff first.
  - Maps AM names from sheet → Supabase users (fuzzy match + manual override file `tmp/am-name-map.csv`).

### UI
- `/contracts` — master list with filters (type, status, AM, target, date range).
- `/contracts/[id]` — full contract page: installments timeline, cycles list, events log, related project.
- `/am/[id]/dashboard` — per-AM monthly view: target, achieved, achievement %, contracts breakdown, overdue installments, cycles needing meeting.
- `/dashboard` (CEO view): monthly KPI tiles from `CEO_Dashboard` tab — New / Renewed / Hold / UPSELL / Win-Back counts + revenue.

### Server actions
- `recordContractEvent(contractId, type, payload)` — also writes audit_log.
- `recordInstallmentReceived(installmentId, actualDate, actualAmount)`.
- `recordMonthlyMeeting(cycleId, actualDate, status, delayDays)`.
- `addCycle(contractId, monthlyData)`.

### Edge function
- `monthly-cycle-roller` (cron 1st of month 06:00 Asia/Riyadh):
  - For each active contract → create next `monthly_cycles` row with expected dates per package + grace_days.
  - Notify AM.

### Permissions
- `contract.view` → AM (own clients) + Heads + CEO + Admin.
- `contract.manage` → AM (own clients) + Account Management Head + Admin.
- `target.view_all` → Heads + CEO + Admin.

### Tests
- Importer: 5,000 rows imported with zero data loss; round-trip CSV matches input.
- E2E: AM marks an installment received → contract balance updates → CEO dashboard tile re-renders.

### Acceptance
- Owner opens `/dashboard` → sees the same New/Renewed/Hold/Total numbers as the Excel `CEO_Dashboard` tab for the current month.
- AM آيه opens `/am/aya/dashboard` → sees her achievement % matching the `Acc_Target_Breakdown` tab.

---

## T9 — Reporting + KPIs (5 days)

**Goal:** the Monday-morning view from MASTER_PLAN §2.1.

### Migrations
- `0023_reporting_views.sql` — Postgres views for:
  - `v_rework_per_task` (count of `task_message` entries during `Client Changes`).
  - `v_on_time_delivery` (`done` tasks on/before deadline as %).
  - `v_agent_productivity` (closed tasks/week per agent).
  - `v_review_backlog` (count of tasks in Manager/Specialist Review > 2 days).

### Server actions / API
- `getCEOWeeklyDigest()` — composes JSON for the Monday email.
- Edge function `weekly-digest` (cron Sunday 7am Asia/Riyadh) — sends email + WhatsApp template.

### UI
- `/dashboard` — add four new stat tiles.
- `/reports` — promote from placeholder to:
  - Per-department SLA compliance.
  - Rework heat-map by service.
  - Agent leaderboard with utilization %.
  - Renewal forecast next 90 days.

### Tests
- View correctness vs hand-computed sample.
- Digest email rendering (HTML + Arabic RTL).

### Acceptance
- CEO opens dashboard Monday → sees all four KPIs + receives the digest.

---

## T10 — Cutover from Odoo (5–8 days)

**Goal:** dashboard becomes primary; Odoo becomes archive.

### Importer
- `scripts/cutover-import.ts`:
  - Read `project.task` (1,918) + `mail.message` (78k filtered to project-task) + `ir.attachment` (6,341 same filter) from Odoo.
  - Upsert into `tasks`, `task_messages`, `task_attachments`.
  - Map Odoo user IDs → Supabase user IDs via `external_source='odoo'` lookup (already in migration `0011`).
  - Idempotent: re-runnable.
  - Streams in batches of 200; logs progress; resumable.

### Cutover plan
1. Day −7 to Day 0: parallel run — staff use both systems on a small subset.
2. Day 0: announce freeze on Odoo writes for the technical track.
3. Day 1: full import.
4. Day 2–7: run only on dashboard with Odoo read-only fallback.
5. Day 8: Odoo set to read-only globally for technical models.
6. Day 14: decommission `rwasem_*` modules in Odoo (not the install — just disable menus).

### Tests
- Import dry-run on staging twice.
- Spot-check 50 random tasks: same fields, same comments, same attachments.
- Permission spot-check after import.

### Acceptance
- Two consecutive weeks operating on the dashboard with no need to open Odoo for technical work.

---

## Sales Track parking lot (S-phases)

Owner explicitly deprioritized. **Do not start until T10 is in production.**

- **S1** — Telesales pipeline (Inbound + Outbound `lead_sources`, activity log, qualification scoring).
- **S2** — Sales pipeline (Discovery / Follow-up / Negotiation / Closed-won / Closed-lost).
- **S3** — Deal-won → triggers existing handover engine (already exists from Phase 5).
- **S4** — Sales reporting (conversion %, time-to-close, source attribution).
- **S5** — Sheet importer for historical pipeline data.

We will keep `kind='sales'` department records seeded in T1 so they exist when the time comes; UI is hidden behind `sales_track_enabled` flag.

---

## Cross-cutting engineering tracks (run continuously)

| Track | What |
|---|---|
| **Design system** | Each phase contributes ≥1 reusable primitive to `/dev/design-system`. |
| **AI affordances** | Each phase ships ≥1 AI tool: T1 = "summarize org load," T3 = "explain why this task is delayed," T4 = "preview which tasks will be generated," T5 = "suggest who to escalate to," T9 = "draft Monday digest." |
| **Testing** | Playwright suite grows per phase; RLS-attack suite re-run before every release. |
| **Observability** | Sentry + Supabase logs reviewed weekly. Edge-function execution metrics dashboarded. |
| **Performance** | Every list ≥1k rows uses cursor pagination + virtualization (Tanstack Virtual). |

---

## Definition of Done — applies to every T-phase

(Same as `MASTER_PLAN.md` Part 8 — duplicated here for engineer convenience.)

1. Migration applied to Supabase + types regenerated (`bun run gen:types`).
2. RLS policies + server-action gates in place.
3. Skeleton + empty + error states on every new page.
4. Mobile responsive verified at 375px.
5. Arabic copy in `lib/copy.ts`.
6. `audit_log` + `ai_event` on every mutation.
7. ≥1 AI affordance using the new data.
8. Phase report at `docs/phase-NN-report.md` with screenshots + smoke result.
9. Behind a `feature_flags` row.
10. PR includes a Playwright test that exercises the new gate.

---

## Sequencing diagram (Gantt-ish)

```
Week:    1   2   3   4   5   6   7   8   9   10  11  12  13  14
T0:      ██
T1:        ████
T2:           ████
T3:              █████
T4:                  ███████
T5:                        ███████  (start when SLA values arrive)
T6:                              ████
T7:                                  █████  (start when Sheet arrives)
T8:                                       ████████  (start when WA account confirmed)
T9:                                              █████
T10:                                                  ████████
```

If owner answers Q5/Q6/Q7 quickly, we collapse the gaps. If not, T6 fills the wait.

---

## What I do tomorrow morning

1. Send the **two follow-up asks** (Sheet + org-chart names) — already noted in `DECISIONS_LOG.md`.
2. Ship **T0** end-of-day (it's small).
3. Start **T1** — schema first, then importer dry-run.

Open `DECISIONS_LOG.md` weekly and clear the pending list.
