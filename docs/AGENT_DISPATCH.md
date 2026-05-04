# Agent Dispatch — Multi-agent execution map

> Every prompt below is **self-contained**. An agent given one of these prompts plus the project codebase + `.env.local` should be able to ship the phase end-to-end.
>
> Read [`ENGINEER_ONBOARDING.md`](ENGINEER_ONBOARDING.md) first to understand the conventions every prompt assumes.

---

## Wave plan (parallelism)

```
Wave 0  →  T0
Wave 1  →  T1                 (depends on T0)
Wave 2  →  T2  ‖  T3  ‖  T4   (depend on T1 — fully parallel, different schema areas)
Wave 3  →  T5  ‖  T7  ‖  T7.5 (depend on T1+T4 — parallel, distinct concerns)
Wave 4  →  T6                 (depends on T2 + T5)                  ✅ shipped
Wave 4b →  Op-UX pass         (off-plan, role landing + UX polish)  ✅ shipped
Wave 5a →  Edge-fn deploy     (orchestrator-only, no agent)          ⬜ next
Wave 5b →  T9                 (depends on T1, T4, T5, T7, T7.5)      ⬜
Wave 5c →  T3.5               (long-queued head filters)             ⬜
Wave 5d →  Acc-Sheet importer (finish 6 of 7 tabs)                   ⬜
Wave 6  →  T10                (depends on everything)                ⬜
```

**Concurrency tips:**
- Within a wave, agents must **not** modify the same files. Conflict-prone areas: `src/lib/supabase/types.ts` (regenerate after wave merge, not per agent), shared UI primitives.
- Each wave ends with a **merge + types-regen + smoke-test** step before the next wave dispatches.

---

## ⚠️ State-of-schema preamble (READ BEFORE WRITING ANY MIGRATION)

The original dispatch was drafted assuming the last applied migration was `0013`. The repo has since shipped phases 14–15, so migrations `0014_seed_pdf_task_templates` through `0019_project_hold_and_comment_kind` are already in `supabase/migrations/` and applied to the live project. **Migration filenames have been re-coordinated** (originals in this doc were `0014`–`0023`; corrected numbers below).

Re-coordinated migration filenames:

| Phase | Filename                          | Replaces (original draft) |
|-------|-----------------------------------|---------------------------|
| T0    | `0020_feature_flags.sql`          | 0014                      |
| T1    | `0021_org_realignment.sql`        | 0015                      |
| T2    | `0022_rls_tighten.sql`            | 0016                      |
| T3    | `0023_task_pdf_gaps.sql`          | 0017                      |
| T4    | `0024_categories_engine.sql`      | 0018                      |
| T5    | `0025_decisions_escalations.sql`  | 0019                      |
| T7    | `0026_renewals.sql`               | 0021                      |
| T7.5  | `0026b_commercial_layer.sql`      | 0021b                     |
| T6    | `0027_governance.sql`             | 0020                      |
| T9    | `0029_reporting_views.sql`        | 0028 (taken by T7.5 0028) |
| T10   | `0030_cutover_import.sql` (script wrapper, no schema change) |  |

**As of 2026-05-04, the latest applied migration is `0028_contracts_am_scoping`. T9 must use `0029`.**

**Tasks-schema reality (surfaced by T2's partial run, important for T2/T3/T5):**

The original prompts spoke of `tasks.assignee_ids uuid[]`, `tasks.owner_user_id`, and `tasks.follower_ids` — none of these columns exist. The live schema uses:
- `public.task_assignees (task_id, employee_id, role_type)` — join table for assignments. To gate by "is the calling user assigned to this task", join through `employee_profiles.user_id = auth.uid()`.
- `tasks.created_by` (uuid, references `auth.users.id`) — the owner-ish column. Treat this as `owner_user_id`.
- `task_followers` does not yet exist; T3's migration creates it.

Update RLS prompts and server-action prompts accordingly: the assignment check is a `NOT EXISTS` / `EXISTS` against `task_assignees` joined to `employee_profiles`, NOT `auth.uid() = ANY(assignee_ids)`.

**Existing-state delta agents must handle (inspect before writing CREATE TABLE / ALTER):**

- `departments.kind` enum **already exists** with values `group | account_management | main_section | supporting_section | quality_control | other` (migration 0018). T1's prompt originally proposed a 3-value `('technical','sales','admin')` check — **do NOT recreate the column**. Instead, T1 should treat the existing enum as canonical and add only what is missing (`parent_department_id` if absent, `head_user_id`, position column, `department_team_leads` table). Sales-track departments are already seeded (`sales`, `tele-sales`, `management`, `hr`, `finance` with `kind='other'`) — flag-gate them via T0 rather than reseeding.
- `departments` parent grouping (`main-sections`, `supporting-sections`, `quality-control`) and supporting leaves (`content-writing`, `video-editing`, `programming`) already seeded by 0018. T1's seed step should be idempotent `INSERT … ON CONFLICT DO NOTHING` and only fill what's missing.
- `projects.hold_reason` + `projects.held_at` already exist (migration 0019). T3 must NOT re-add these. T3's prompt called the timestamp `hold_since` — **use the existing `held_at`**. T3 still needs to verify that `project_status` accepts a `'hold'` value (or that HOLD is represented purely by `held_at IS NOT NULL`); inspect first, then either add the enum value or update T3's UI to key on `held_at`.
- `task_comments.kind` enum (`note | requirements | modification`) already exists (migration 0019). T3's "Log Note attachments" should attach to existing rows, not redefine the enum.
- `task_templates` and `project_services` tables already exist (pre-T4). T4's prompt already says "ALTER rather than DROP/CREATE" — keep that discipline.
- `external_source` / `external_id` columns are present on clients/projects/tasks/employee_profiles from migration `0011`. T10's importer should rely on those; do not add new linkage columns.

**Inspection workflow (every phase agent runs this first):**
```bash
set -a && source .env.local && set +a
curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d '{"query":"select column_name, data_type from information_schema.columns where table_schema='\''public'\'' and table_name=$1"}'
```
Use this to verify your CREATE/ALTER plan against reality before writing the migration.

---

## Boilerplate every agent must include in its working context

Add this to the system/setup of any agent before giving it a phase prompt:

```
You are an engineering agent on the Sky Light dashboard project at
/Users/mahmoudmac/Documents/projects/mr-dashboard.

Required reading before writing any code:
  - docs/ENGINEER_ONBOARDING.md   (conventions, access, schema)
  - docs/MASTER_PLAN.md           (strategic context)
  - docs/ENGINEERING_PLAN.md      (your phase scope is below)
  - docs/SPEC_FROM_OWNER.md       (intent — wins all conflicts)
  - docs/SPEC_FROM_PDF.md         (workflow mechanics)
  - docs/DECISIONS_LOG.md         (every owner answer to date)
  - CLAUDE.md                     (project rules)

Hard rules:
  - Apply migrations via Supabase Management API
    (POST https://api.supabase.com/v1/projects/{ref}/database/query
     with SUPABASE_ACCESS_TOKEN). DO NOT use the Supabase MCP.
  - Odoo access is READ-ONLY (use src/lib/odoo/client.ts; never call
    create/write/unlink). The live system has 110 users and 1,918 tasks.
  - Arabic-only UI. Tajawal font. RTL. Mobile responsive at 375px.
  - Every mutation: zod-validate → check user → check org scope → write
    audit_logs (if material) and ai_events (if business-relevant).
  - Skeleton + empty + error states on every new page.
  - Ship behind a feature_flags row.

When done:
  - Write docs/phase-T{N}-report.md with screenshots + smoke result.
  - Open one PR titled feat(T{N}): <title>.
  - If owner intent is unclear, STOP and surface a question. Do not invent.
```

---

## T0 — Feature Flags Foundation

**Wave 0** · ~1–2 days · no dependencies

### Prompt
```
Ship phase T0 (Feature Flags Foundation) as defined in
docs/ENGINEERING_PLAN.md.

Deliverables:
  1. Migration 0020_feature_flags.sql:
       CREATE TABLE feature_flags (
         key TEXT PRIMARY KEY,
         enabled BOOLEAN NOT NULL DEFAULT FALSE,
         rollout_roles TEXT[] DEFAULT '{}',
         description TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );
       Plus RLS: read for all authenticated, write for has_permission(uid,'feature_flag.manage').
       Seed rows: 'sales_track_enabled' (false), 'whatsapp_enabled' (false).

  2. src/lib/feature-flags.ts:
       isFlagOn(key: string, user: User): Promise<boolean>
       Cached per-request via React.cache.

  3. <FeatureFlag flag="..." fallback={...}> server component
     for declarative gating in JSX.

  4. /settings/feature-flags admin page:
       - List all flags
       - Toggle enabled
       - Edit rollout_roles (multi-select chips)
       - Permission gated to admin only

  5. Tests:
       - Unit: isFlagOn honors rollout_roles array
       - Playwright: non-admin cannot reach /settings/feature-flags

  6. Phase report at docs/phase-T0-report.md.

Acceptance: owner toggles a flag → effect visible in <1s on next request.
```

---

## T1 — Org Realignment

**Wave 1** · ~3–4 days · depends on T0

### Prompt
```
Ship phase T1 (Org Realignment) as defined in docs/ENGINEERING_PLAN.md.

Owner-confirmed seed data (from docs/DECISIONS_LOG.md):

  Department          | Head             | Team Leads | Notes
  --------------------|------------------|------------|------
  Account Management  | آيه خفاجي        | 3          | -
  Media Buying        | أشرف مختار       | 1          | -
  SEO                 | حسن شاهين        | 2          | -
  Social Media        | حسن ياسر         | 1          | also writes content
  Designing           | عمر الخيام       | 0          | -
  Programming         | -                | -          | زياد حجي only (single contributor)
  SEO Content         | محمد عادل        | 0          | -

  NOT seeded: Social Content (dissolved), QC (dropped from scope).
  Sales + Telesales: seeded but hidden behind feature flag 'sales_track_enabled'.

Deliverables:
  1. Migration 0021_org_realignment.sql:
       INSPECT FIRST. The schema already has:
         - departments.kind  (enum: group|account_management|main_section|
                              supporting_section|quality_control|other)
         - departments.parent_department_id  (verify; add if absent)
         - seeded leaf rows for the 7 technical departments
         - parent group rows (main-sections, supporting-sections, quality-control)
       What's MISSING and T1 must add:
         ALTER TABLE departments ADD COLUMN IF NOT EXISTS head_user_id UUID
           REFERENCES auth.users(id);
         ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS position TEXT
           CHECK (position IN ('head','team_lead','specialist','agent','admin'));
         CREATE TABLE IF NOT EXISTS department_team_leads (
           department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
           user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
           PRIMARY KEY (department_id, user_id)
         );
       DO NOT recreate the kind enum or reseed departments — keep all
       department inserts INSERT … ON CONFLICT (organization_id, slug) DO NOTHING.
       Sales / Telesales already seeded with kind='other'; T1 should NOT change
       them — visibility gating is the T0 feature flag's job.

  2. scripts/import-odoo-org.ts:
       Read 110 res.users from live Odoo (read-only).
       Map manager-group (28 members) → suggested position='team_lead'.
       Map member-group (39 members) → suggested position='agent'.
       Output tmp/org-import-review.csv for owner review (DO NOT auto-commit positions).

  3. Server actions:
       setDepartmentHead(deptId, userId)
       addTeamLead(deptId, userId) / removeTeamLead(...)
       setEmployeePosition(userId, position)
       All gated to permission 'org.manage_structure'.

  4. UI:
       /organization/chart   — visual recursive org chart (RTL-correct)
       /organization/departments/[id]  — header shows Head + Team Leads + members; admin can edit

  5. Tests:
       Migration round-trip on a fresh Supabase branch.
       Server-action: non-admin cannot setDepartmentHead.
       Playwright: owner sees full chart with seeded depts.

  6. Phase report at docs/phase-T1-report.md with org chart screenshot.

Acceptance: owner opens /organization/chart and sees the 7 technical depts +
Sales group (greyed/flag-off) + admin section, with placeholder Heads ready
for assignment.
```

---

## T2 — Permissions Hardening

**Wave 2 (parallel with T3, T4)** · ~3 days · depends on T1

### Prompt
```
Ship phase T2 (Permissions Hardening) as defined in docs/ENGINEERING_PLAN.md.

Owner rule (docs/SPEC_FROM_OWNER.md §10): Agents see ONLY their own tasks.

Deliverables:
  1. Migration 0022_rls_tighten.sql:
       Replace permissive tasks SELECT policy with:
         USING (
           has_permission(auth.uid(), 'task.view_all')
           OR auth.uid() = ANY(assignee_ids)
           OR auth.uid() = ANY(follower_ids)  -- column may not exist yet, see note
           OR auth.uid() = owner_user_id
         );
       Same shape for task_comments, task_mentions.
       New permission keys: 'task.view_all' (assigned to head, account_manager,
         admin) plus per-stage transition keys.

       NOTE: follower_ids belongs to T3. Coordinate: if T3 hasn't merged,
       use only assignee_ids + owner_user_id; T3 PR adds the followers branch.

  2. Audit & harden every action in src/app/(dashboard)/tasks/_actions.ts:
       transitionStage — re-verify STAGE_EXIT_ROLE against caller permission,
                         not just role-name string.
       addLogNote — verify caller is assignee/owner/has view_all.

  3. Tests (CRITICAL):
       tests/rls-attack.spec.ts — login as seeded Agent, attempt direct
         Supabase queries via the JS client, expect 0 rows for other people's
         tasks.
       Playwright: Agent can move own task In Progress → Manager Review;
         cannot move someone else's.

  4. Phase report at docs/phase-T2-report.md.

Acceptance: three test users (Owner, Manager, Agent) each see exactly the
right slices in /tasks. Attack test passes.

DO NOT touch: schema files owned by T3 (followers) or T4 (categories engine).
```

---

## T3 — Task Workflow PDF Gaps

**Wave 2 (parallel with T2, T4)** · ~4–5 days · depends on T1

### Prompt
```
Ship phase T3 (Task Workflow PDF Gaps) as defined in docs/ENGINEERING_PLAN.md.

Goal: close every row in docs/SPEC_FROM_PDF.md §13 ("Deltas vs current dashboard").

NOTE: task_stage_history table already exists in the schema (verified). T3
just needs to surface it as a UI tab.

Deliverables:
  1. Migration 0023_task_pdf_gaps.sql:
       INSPECT FIRST. Already in schema (do NOT re-add):
         - projects.hold_reason  (text)
         - projects.held_at      (timestamptz; T3 originally called this hold_since
                                  — use the existing held_at name)
         - task_comments.kind    (enum note|requirements|modification)
       What T3 still adds:
         ALTER TABLE tasks
           ADD COLUMN IF NOT EXISTS delay_days INTEGER GENERATED ALWAYS AS (
             CASE
               WHEN status='done' AND deadline IS NOT NULL
               THEN GREATEST(0, EXTRACT(DAY FROM completed_at - deadline)::INT)
             END
           ) STORED,
           ADD COLUMN IF NOT EXISTS hold_reason TEXT,
           ADD COLUMN IF NOT EXISTS hold_since TIMESTAMPTZ;

         CREATE TABLE IF NOT EXISTS task_followers (
           task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
           user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
           added_by UUID REFERENCES auth.users(id),
           added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           PRIMARY KEY (task_id, user_id)
         );

       Verify whether project_status enum has a 'hold' value. If absent and
       you choose to add one, do so in the same migration with
       ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'hold'.
       Otherwise treat HOLD as projects.held_at IS NOT NULL and key UI off that.

  2. Server actions:
       addFollower(taskId, userId), removeFollower(taskId, userId)
       setProjectHold(projectId, reason), resumeProject(projectId)
       All write audit_logs.

  3. UI on task detail page:
       Tab "تاريخ المراحل" (Stage History) — surface task_stage_history rows.
       Section "متابعون" (Followers) — distinct from Assignees.
       Banner "متأخر بـ N يوم" — when delay_days > 0, red severity.
       Log Note attachments via Supabase Storage (thumbnails for images).

  4. UI on Project Box:
       HOLD overlay (red ribbon) when status='hold', with reason on hover.

  5. Verification (no code change):
       Audit migration 0013 against docs/SPEC_FROM_PDF.md §11.
       Add a test that asserts every offset row exists.

  6. Tests:
       Playwright: AM puts project on HOLD with reason →
         project box shows ribbon → resume → ribbon clears.
       Playwright: Specialist adds Agent as follower →
         Agent sees task in own list (assignee-or-follower visibility).

  7. Phase report at docs/phase-T3-report.md.

Acceptance: every row in docs/SPEC_FROM_PDF.md §13 turns ✅. Update that
table in the same PR.

DO NOT touch: schema files owned by T2 (RLS) or T4 (categories).
Coordinate with T2 agent: T3 owns the followers column; T2 references it
in the SELECT policy.
```

---

## T4 — Categories Engine

**Wave 2 (parallel with T2, T3)** · ~5–7 days · depends on T1

### Prompt
```
Ship phase T4 (Categories Engine) as defined in docs/ENGINEERING_PLAN.md.

Goal: port Odoo's task-template engine. Creating a project + selecting
services auto-generates the right tasks with correct deadlines and assignees.

Reference data (read-only) in live Odoo:
  - 13 records in project.category
  - 279 records in project.category.task
  Connection: src/lib/odoo/client.ts (creds in .env.local).

Deliverables:
  1. Migration 0024_categories_engine.sql:
       CREATE TABLE service_categories (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         key TEXT UNIQUE NOT NULL,
         name_ar TEXT NOT NULL,
         name_en TEXT,
         color TEXT
       );
       CREATE TABLE task_templates (  -- replaces existing task_templates if needed; see note
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         category_id UUID REFERENCES service_categories(id),
         name_ar TEXT NOT NULL,
         name_en TEXT,
         default_owner_position TEXT,  -- references employee_profiles.position from T1
         deadline_offset_days INT,
         upload_offset_days INT,
         default_followers_positions TEXT[],
         depends_on_template_id UUID REFERENCES task_templates(id),
         sla_minutes_new INTEGER,
         sla_minutes_in_progress INTEGER  -- per-template SLA for variable stages (per T5 plan)
       );
       CREATE TABLE project_services (  -- may exist; alter rather than recreate
         project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
         category_id UUID REFERENCES service_categories(id),
         week_split BOOLEAN DEFAULT FALSE,
         weeks INT,
         PRIMARY KEY (project_id, category_id)
       );
       NOTE: task_templates and project_services already exist as tables —
       inspect and ALTER rather than DROP/CREATE. Preserve existing data.

  2. scripts/import-odoo-categories.ts:
       Read project.category (13) and project.category.task (279) from live
       Odoo via src/lib/odoo/client.ts (READ ONLY).
       Idempotent on (category_key, name_en).
       Dry-run mode dumps a CSV diff first to tmp/categories-diff.csv.

  3. Extend createProject server action:
       After project insert, expand selected project_services into tasks.
       For each template: deadline = project.start_date + offset
                          OR project.end_date − offset (match existing
                          handover engine's convention).
       For Social Media with week_split=true, weeks=3: generate 3 copies
         per weekly template using offsets in docs/SPEC_FROM_PDF.md §11.
       Default owner_user_id = department member with matching position
         and lowest current load.
       Followers seeded from default_followers_positions[].

  4. UI:
       /projects/new — multi-select chips for "Import Categories"
       Preview pane: show generated tasks (name + deadline + owner) BEFORE
         clicking Create. Allow editing offsets per task.
       Toggle "Split Social Media across N weeks" with N input.
       /service-categories — admin page: list + edit templates,
         drag-to-reorder, edit offsets.

  5. Permissions:
       'category.manage_templates' → admin + head only
       'project.create' → AM + head + admin

  6. Tests:
       Unit: offset computation matches docs/SPEC_FROM_PDF.md §11 table for
         every (service, week) combination.
       Playwright: AM creates project with Social + SEO → exactly the
         expected number of tasks generated with right deadlines.
       Importer dry-run on staging Odoo (read-only).

  7. Phase report at docs/phase-T4-report.md.

Acceptance: AM picks a real client + services → sees task list materialize
in preview, then commits → tasks land with correct deadlines, owners,
followers.

DO NOT touch: tasks RLS policies (T2's domain) or task UI changes from T3.
```

---

## T5 — Decisions + SLA + Escalation Engine

**Wave 3 (parallel with T7, T7.5)** · ~6–8 days · depends on T1 + T4

### Prompt
```
Ship phase T5 (Decisions + SLA + Escalation engine) as defined in
docs/ENGINEERING_PLAN.md.

SLA values (owner-confirmed in docs/DECISIONS_LOG.md):

  Stage              | Max time      | Source
  -------------------|---------------|------------------------
  New                | per-template  | task_templates.sla_minutes_new
  In Progress        | per-template  | task_templates.sla_minutes_in_progress
  Manager Review     | 30 min        | sla_rules global
  Specialist Review  | 30 min        | sla_rules global
  Ready to Send      | 15 min        | sla_rules global
  Sent to Client     | 4 hr (240)    | sla_rules global
  Client Changes     | 8 hr (480)    | sla_rules global — same/next workday max

Business hours: Sun–Thu, 09:00–17:00 Asia/Riyadh. SLA timer pauses outside.

Exceptions (owner-confirmed, closed list, notify-only default — NOT auto-action):
  Client / Deadline / Quality / Resource

Deliverables:
  1. Migration 0025_decisions_escalations.sql:
       CREATE TABLE decision_rights (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         decision_key TEXT UNIQUE NOT NULL,
         owner_position TEXT NOT NULL,  -- enum from employee_profiles.position
         scope_note TEXT
       );
       Seed rows from docs/SPEC_FROM_OWNER.md §13 (6 rows: execute, distribute,
         approve_quality, change_scope, client_exception, resource_priority).

       CREATE TABLE escalation_paths (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         kind TEXT CHECK (kind IN ('operational','functional','client','critical')),
         from_position TEXT NOT NULL,
         to_position TEXT NOT NULL,
         sla_minutes INTEGER
       );
       Seed from docs/SPEC_FROM_OWNER.md §12 (4 paths).

       CREATE TABLE sla_rules (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         stage_key TEXT UNIQUE NOT NULL,
         max_minutes INTEGER NOT NULL,
         severity TEXT NOT NULL DEFAULT 'high',
         business_hours_only BOOLEAN NOT NULL DEFAULT TRUE
       );
       Seed: 5 rows above (manager_review=30, specialist_review=30,
         ready_to_send=15, sent_to_client=240, client_changes=480).

       ALTER TABLE tasks ADD COLUMN sla_override_minutes INTEGER;

       CREATE TABLE business_hours (
         weekday INT PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
         open_time TIME, close_time TIME, tz TEXT DEFAULT 'Asia/Riyadh'
       );
       Seed Sun(0), Mon(1), Tue(2), Wed(3), Thu(4): 09:00 / 17:00.
       Fri(5)/Sat(6): NOT inserted (closed days).

       CREATE TABLE exceptions (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         task_id UUID REFERENCES tasks(id),
         kind TEXT CHECK (kind IN ('client','deadline','quality','resource')),
         reason TEXT NOT NULL,
         opened_by UUID, opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         resolved_by UUID, resolved_at TIMESTAMPTZ,
         resolution_note TEXT
       );

       CREATE TABLE escalations (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         exception_id UUID REFERENCES exceptions(id),
         task_id UUID REFERENCES tasks(id),
         level INT NOT NULL,
         raised_to_user_id UUID NOT NULL,
         raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         acknowledged_at TIMESTAMPTZ,
         status TEXT NOT NULL DEFAULT 'open'
       );

       Helper SQL function: business_minutes_between(start TIMESTAMPTZ, end TIMESTAMPTZ)
       returns INTEGER computing minutes only inside Sun–Thu 09:00–17:00.

  2. Edge function supabase/functions/sla-watcher/index.ts:
       Cron: every 5 minutes.
       For each task NOT in 'done':
         - Compute time-in-current-stage using business_minutes_between if
           sla_rules.business_hours_only.
         - Resolve max_minutes: tasks.sla_override → task_templates (for
           New/In Progress) → sla_rules global.
         - If exceeded AND no open exception for (task_id, current_stage_entered_at):
             INSERT exceptions (kind='deadline', reason='SLA exceeded by N min').
             INSERT escalations to team_lead of task's department.
             INSERT notifications to that team_lead.
             INSERT ai_events (kind='SLA_BREACHED', payload={...}).

  3. Server actions:
       openException(taskId, kind, reason)  -- manual exception
       resolveException(id, note)
       acknowledgeEscalation(id)

  4. UI:
       /escalations — inbox per logged-in user, filterable by kind.
       Task detail: red badge when has open exception; modal to open/resolve.
       Dashboard tile: "تصعيدات مفتوحة" count + breakdown by kind.

  5. Tests:
       Edge function unit: simulated stage entries → expected exception count.
       business_minutes_between: covers overnight, weekend, exact-edge cases.
       Playwright: force a task past SLA → exception appears in Lead's inbox
         within 5 min.

  6. Phase report at docs/phase-T5-report.md.

Acceptance: a task breaches SLA → escalation surfaces in Lead's /escalations
and on the dashboard tile.

DO NOT touch: T7's renewal_cycles or T7.5's commercial-layer tables.
```

---

## T6 — Governance Enforcement

**Wave 4** · ~4 days · depends on T2 + T5

### Prompt
```
Ship phase T6 (Governance Enforcement) as defined in docs/ENGINEERING_PLAN.md.

Owner's 5 governance rules (docs/SPEC_FROM_OWNER.md §10) — must be enforced,
not just documented.

NOTE: QC role and QC observer dashboard are DROPPED per owner directive
(2026-05-02 round 3). Build for Admin + Head only.

Deliverables:
  1. Migration 0027_governance.sql:
       CREATE TABLE governance_violations (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         kind TEXT CHECK (kind IN ('missing_log_note','stage_jump','unowned_task','permission_breach')),
         task_id UUID REFERENCES tasks(id),
         project_id UUID REFERENCES projects(id),
         detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         resolver_user_id UUID,
         resolved_at TIMESTAMPTZ,
         note TEXT
       );

  2. Server-action enforcement:
       Extend transitionStage: require a non-empty task_comment written by
         caller within last 5 min. If missing → reject with Arabic friendly
         message "يجب إضافة ملاحظة قبل نقل المرحلة".

  3. Edge function governance-watcher (daily, 06:00 Asia/Riyadh):
       Find tasks NOT in 'done' with no task_comment in last 7 days
         → INSERT governance_violations (kind='missing_log_note').
       Find tasks where owner_user_id IS NULL
         → INSERT governance_violations (kind='unowned_task').

  4. UI:
       /governance — admin/head dashboard:
         Counts by violation kind.
         List of open violations, click-through to record.
         Resolve button gated to 'governance.resolve' permission (admin only).
       Add "مخالفات حوكمة" tile on main dashboard for admins/heads.

  5. Permissions:
       'governance.view' → head + admin
       'governance.resolve' → admin

  6. Tests:
       Playwright: try to transition stage without a log note →
         blocked with Arabic friendly error.
       Cron simulation: stale task → violation row appears.

  7. Phase report at docs/phase-T6-report.md.

Acceptance: admin/head opens /governance, sees the day's issues at a glance.
```

---

## T7 — Renewal Cycles

**Wave 3 (parallel with T5, T7.5)** · ~5 days · depends on T4

### Prompt
```
Ship phase T7 (Renewal Cycles) as defined in docs/ENGINEERING_PLAN.md.

Owner-confirmed (docs/DECISIONS_LOG.md): renewal = SAME projects row + new
renewal_cycles row. Cycle length VARIES per client (some monthly, some
quarterly, some 6-monthly).

Deliverables:
  1. Migration 0026_renewals.sql:
       ALTER TABLE projects
         ADD COLUMN cycle_length_months INTEGER,  -- NULL = one-time
         ADD COLUMN next_renewal_date DATE;

       CREATE TABLE renewal_cycles (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         cycle_no INT NOT NULL,
         started_at DATE NOT NULL,
         ended_at DATE,
         status TEXT NOT NULL DEFAULT 'active',
         UNIQUE (project_id, cycle_no)
       );

  2. Server actions:
       startRenewalCycle(projectId)
         — INSERT renewal_cycles
         — Auto-generate renewal-category tasks via T4's engine
       setProjectCycle(projectId, lengthMonths, nextRenewalDate)

  3. Edge function renewal-scheduler (daily 06:00 Asia/Riyadh):
       For each project where next_renewal_date - today <= 14 days
         AND no current cycle for that period:
         → INSERT notifications to project's AM (kind='RENEWAL_DUE_SOON').

  4. UI:
       Project box: badge "تجديد خلال X يوم" if approaching.
       Project detail tab: "دورات التجديد" — table of cycles with
         start/end/status.
       Dashboard tile: "تجديدات هذا الشهر" with click-through.

  5. Tests:
       Playwright: set next_renewal_date 13 days out → notification fires.

  6. Phase report at docs/phase-T7-report.md.

Acceptance: a project entering renewal month auto-generates renewal tasks
and surfaces on AM + CEO dashboards.

NOTE: the Acc Sheet (docs/data/acc-sheet.xlsx) tab Cycle_tracker has 979
rows of real cycle data. T7.5 imports it. T7 just builds the schema +
behavior; T7.5 does the bulk import.
```

---

## T7.5 — Commercial Layer

**Wave 3 (parallel with T5, T7)** · ~8–10 days · depends on T1 + T4

### Prompt
```
Ship phase T7.5 (Commercial Layer) as defined in docs/ENGINEERING_PLAN.md.

This is the BIG one. Source data: docs/data/acc-sheet.xlsx — 7 tabs,
~5,000 rows of live commercial data.

Tabs to import:
  1. Cycle_tracker        (979) — per-client monthly cycles
  2. Installments Tracker (991) — payment plans (up to 5 installments)
  3. Edits Updates log    (869) — contract event history
  4. Clients Contracts    (1000) — master contracts
  5. CEO_Dashboard        — service catalog + monthly KPIs
  6. TARGET_CONTRACTS     — monthly target tracking
  7. Acc_Target_Breakdown — per-AM monthly performance

Deliverables:
  1. Migration 0026b_commercial_layer.sql (full schema in
     docs/ENGINEERING_PLAN.md "T7.5 — Commercial Layer" section):
       services_catalog, contract_types, packages, contracts, installments,
       monthly_cycles, am_targets, contract_events.

  2. scripts/import-acc-sheet.ts:
       Use Bun's xlsx reader.
       Tab-by-tab import: clients → contracts → installments → cycles →
         events → targets.
       Idempotent on natural keys (Client ID + start_date).
       Dry-run mode: dump CSV diff to tmp/acc-sheet-diff.csv FIRST.
       Manual override file tmp/am-name-map.csv for fuzzy AM-name matching.

  3. UI:
       /contracts — master list with filters (type, status, AM, target,
         date range, package).
       /contracts/[id] — installments timeline + cycles list + events log
         + linked project.
       /am/[id]/dashboard — per-AM monthly: target, achieved, achievement %,
         contracts breakdown, overdue installments, cycles needing meeting.
       /dashboard CEO view: monthly KPI tiles matching CEO_Dashboard tab
         (New / Renewed / Hold / UPSELL / Win-Back / Total).

  4. Server actions:
       recordContractEvent(contractId, type, payload)
       recordInstallmentReceived(installmentId, actualDate, actualAmount)
       recordMonthlyMeeting(cycleId, actualDate, status, delayDays)
       addCycle(contractId, monthlyData)

  5. Edge function monthly-cycle-roller (cron 1st of month 06:00 Asia/Riyadh):
       For each active contract → create next monthly_cycles row with expected
         dates per package + grace_days.
       Notify AM.

  6. Permissions:
       'contract.view' → AM (own clients) + heads + CEO + admin
       'contract.manage' → AM (own clients) + AM head + admin
       'target.view_all' → heads + CEO + admin

  7. Tests:
       Importer: 5,000 rows imported, zero data loss; round-trip CSV matches.
       Playwright: AM marks installment received → contract balance updates
         → CEO dashboard tile re-renders.

  8. Phase report at docs/phase-T7-5-report.md.

Acceptance:
  - Owner opens /dashboard → sees same New/Renewed/Hold/Total numbers as
    Excel CEO_Dashboard tab for the current month.
  - AM آيه opens /am/aya/dashboard → sees achievement % matching
    Excel Acc_Target_Breakdown tab.

DO NOT touch: T5's exceptions/sla tables or T7's renewal_cycles (your
monthly_cycles table is per-contract; T7's renewal_cycles is per-project
package renewal — they coexist).
```

---

## T9 — Reporting + KPIs

**Wave 5** · ~5 days · depends on T1, T4, T5, T7, T7.5

### Prompt
```
Ship phase T9 (Reporting + KPIs) as defined in docs/ENGINEERING_PLAN.md.

Goal: the Monday-morning view from docs/MASTER_PLAN.md §2.1.

Deliverables:
  1. Migration 0029_reporting_views.sql — Postgres views:
       v_rework_per_task    — count of task_comments during Client Changes stage
       v_on_time_delivery   — done tasks on/before deadline as %
       v_agent_productivity — closed tasks/week per agent + median Duration per stage
       v_review_backlog     — tasks stuck in Manager/Specialist Review > 2 days

     NOTE: 0028 is taken (contracts_am_scoping). Use 0029.

  2. Server actions / API:
       getCEOWeeklyDigest() — composes JSON for the Monday email
       Edge function weekly-digest (cron Sun 07:00 Asia/Riyadh)
         — sends email + (later) WhatsApp template

  3. UI:
       /dashboard — 4 new stat tiles ADDITIVELY in the existing hero grid
         (rework, on-time, productivity, review backlog).
         IMPORTANT: the dashboard was redesigned in the Operator-UX pass
         (commits a718654 + b678073) into 4 hero KPIs + commercial card +
         3 watch-lists. DO NOT rewrite the layout. Add tiles to the hero
         grid; if it overflows, restructure to 8 tiles in 2 rows of 4.
       /reports — promote from placeholder:
         - Per-department SLA compliance
         - Rework heat-map by service
         - Agent leaderboard with utilization %
         - Renewal forecast next 90 days

  4. AI affordance:
       /reports — "اختصر لي تقرير الأسبوع" button → Gemini summary grounded
         on the 4 views.

  5. Tests:
       View correctness vs hand-computed sample.
       Digest email rendering (HTML + Arabic RTL).

  6. Phase report at docs/phase-T9-report.md.

Acceptance: CEO opens dashboard Monday → sees all 4 KPIs + receives the
digest email.
```

---

## T10 — Cutover from Odoo

**Wave 6** · ~5–8 days · depends on EVERYTHING

### Prompt
```
Ship phase T10 (Cutover from Odoo) as defined in docs/ENGINEERING_PLAN.md.

Goal: dashboard becomes primary; Odoo becomes archive.

Source: live Odoo (READ-ONLY) — 1,918 project.task + 78,154 mail.message
(filtered to project-task) + 6,341 ir.attachment (same filter).

Deliverables:
  1. scripts/cutover-import.ts:
       Read project.task, mail.message (project-task only), ir.attachment
         (same) from live Odoo via src/lib/odoo/client.ts (READ ONLY).
       Upsert into tasks, task_comments, task_attachments.
       Map Odoo user IDs → Supabase user IDs via
         employee_profiles.external_source='odoo' lookup
         (column already in migration 0011).
       Idempotent: re-runnable.
       Stream in batches of 200; log progress; resumable.
       Dry-run mode mandatory: dump tmp/cutover-diff.csv.

  2. Cutover plan (docs/phase-T10-runbook.md):
       Day -7 to Day 0: parallel run on a small subset.
       Day 0: announce freeze on Odoo writes for technical track.
       Day 1: full import.
       Day 2-7: run only on dashboard with Odoo read-only fallback.
       Day 8: Odoo set to read-only globally for technical models.
       Day 14: decommission rwasem_* modules in Odoo (disable menus only).

  3. Tests:
       Importer dry-run on staging twice.
       Spot-check 50 random tasks: same fields, same comments, same
         attachments.
       Permission spot-check after import.

  4. Phase report at docs/phase-T10-report.md.

Acceptance: two consecutive weeks operating on the dashboard with zero
need to open Odoo for technical work.
```

---

## T3.5 — Head per-employee task filters

**Wave 5** · ~3 days · depends on T2, T4 (long-queued, owner-asked)

Spec: `docs/phase-T3.5-filters.md` (5 sub-filters from owner's verbatim Arabic feedback).

### Prompt
```
Ship phase T3.5 (Head-of-Department Task Filters) as defined in
docs/phase-T3.5-filters.md.

Implement filters #1, #2, #3a from the spec. Filters #4 and #5 are
deferred to a later cycle (they need new schema; ship them only if scope
allows in the time budget).

Deliverables:
  1. EDIT src/lib/data/tasks.ts — extend `listTasks` with:
       - `directReportsOfEmployeeId?: string` filter (joins task_assignees
         with employee_profiles WHERE manager_employee_id = X)
       - `notRedistributed?: boolean` (sole assignee = caller AND
         status != 'done')
       - `forwardDeadlineBy?: string` (compute on read:
         CASE WHEN status != 'done' AND deadline < <date> THEN
              <date> - deadline END)

  2. EDIT src/app/(dashboard)/tasks/page.tsx — when caller has role
     "manager" (head):
       - Show row of per-direct-report chips above the existing filter chips.
       - Each chip filters to that employee's tasks.
       - Add a "لم تُوزَّع بعد" chip for filter #2.
       - Add a date picker for filter #3 ("متأخرات حتى…").

  3. NEW src/lib/data/team.ts — `listDirectReports(headEmployeeId)`.

  4. NEW tests/head-filters.test.mjs — assert filter SQL composes correctly
     for each sub-filter.

  5. NEW docs/phase-T3.5-report.md.

Hard rules:
  - Only "manager" role gets the new chips. Other roles see /tasks unchanged.
  - DO NOT touch /tasks/_actions.ts (Op-UX pass redesigned the action layer).
  - DO NOT introduce new RLS policies. The existing tasks_select scope is
     correct; per-direct-report scoping is a UI-layer filter, not RLS.

File ownership:
  NEW: src/lib/data/team.ts, tests/head-filters.test.mjs, docs/phase-T3.5-report.md
  EDIT: src/lib/data/tasks.ts, src/app/(dashboard)/tasks/page.tsx
  MUST NOT TOUCH: any _actions.ts, types.ts, theming, T6/T7/T7.5 modules

Time budget: 90 min. If scope overflows, partial-commit with #1 + chips
working; defer the date picker to a follow-up.
```

---

## Wave 5a — Edge functions deploy + cron (orchestrator-only)

**No agent dispatch.** The orchestrator deploys the 4 functions and configures cron directly.

Functions:
- `supabase/functions/sla-watcher/index.ts` (T5) — daily 06:00 Asia/Riyadh
- `supabase/functions/renewal-scheduler/index.ts` (T7) — daily 06:00 Asia/Riyadh
- `supabase/functions/governance-watcher/index.ts` (T6) — daily 06:00 Asia/Riyadh
- `supabase/functions/monthly-cycle-roller/index.ts` (T7.5-finish) — 1st of month 06:00 Asia/Riyadh

Steps:
1. `mcp__supabase__deploy_edge_function` for each.
2. Configure cron (Vercel `cron.json` if Vercel-hosted, otherwise Supabase scheduled triggers).
3. Smoke each: invoke once via `curl -X POST <function-url> -H "Authorization: Bearer <service-role>"` and verify expected rows in `escalations` / `notifications` / `governance_violations` / `monthly_cycles`.
4. Document in `docs/phase-edge-deploy-report.md`: what was deployed, cron schedule, smoke result.

---

## QA dispatch (parallel sidecar)

A dedicated QA agent should run in parallel with each wave, watching for:
- New PRs touching shared files (`src/lib/supabase/types.ts`, design system)
- Failing migrations (Mgmt API errors)
- RLS-attack regressions
- Missing skeleton/empty/error states
- Missing Arabic copy entries

### QA agent prompt
```
You are the QA agent on the Sky Light dashboard project.

For each PR opened by phase agents (T0–T10):
  1. Read the phase report at docs/phase-T{N}-report.md.
  2. Run `bun install && bun run build && bun run lint`.
  3. Run the Playwright suite. Re-run rls-attack.spec.ts even for unrelated
     phases.
  4. Verify the Definition-of-Done checklist (10 items in
     docs/ENGINEER_ONBOARDING.md §3) — every box ticked.
  5. Cross-check the migration matches what the prompt promised
     (no unexpected DROPs, no new permissive RLS).
  6. Spot-check 3 UI screens at 375px width — skeleton/empty/error states present.
  7. Comment on the PR with PASS / FAIL list and request changes if needed.

Surface to a human:
  - any conflict between two open PRs touching the same file
  - any failed migration on Supabase (do NOT roll forward)
  - any feature flag default flipped to true without owner approval
```

---

## Merge protocol

1. Wave 0/1 ship serially, normal merge.
2. Within Waves 2–4 (parallel waves):
   - Each agent works on a distinct branch `feat/T{N}-{slug}`.
   - Migration filenames pre-coordinated (T2=0016, T3=0017, T4=0018, etc.).
   - Agents notify on shared-file touches via PR labels (`shared:types`, `shared:design-system`).
3. After all PRs in a wave merge:
   - Regenerate `src/lib/supabase/types.ts` once (`bun run gen:types`).
   - Run full Playwright suite.
   - Smoke test against staging.
4. Only then dispatch the next wave.
