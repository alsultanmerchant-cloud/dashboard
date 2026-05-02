# Sky Light Operating System — Master Plan

> **Canonical roadmap.** This document supersedes `ODOO_REPLACEMENT_PLAN.md` and absorbs the build-plan sections of `ODOO_AUDIT.md` and `SPEC_FROM_OWNER.md`. When this conflicts with another doc, **this wins**.

---

## Part 1 — The Full View

### 1.1 What we are building

**Not** a marketing-agency dashboard. **Not** an Odoo replacement.

We are building Sky Light's **Service Delivery Operating System (SDOS)** — a single, modern, AI-native dashboard that runs the company end-to-end across 8 operating layers:

```
1. Organization        → who works here, in what tier, under whom
2. Sales Engine        → how prospects become signed clients
3. Delivery Engine     → how signed clients become projects with auto-generated tasks
4. Task Workflow       → the 8-stage execution pipeline (already partly built)
5. Permissions         → who can see, edit, transition what
6. Decision Hierarchy  → who decides what, who escalates to whom
7. Governance Rules    → 5 enforced operating rules
8. Escalation/Exception→ how the abnormal is handled
```

Today these 8 layers are split across **Odoo (Rawasem) + Sheets + WhatsApp + people's heads**. We collapse them into one dashboard.

### 1.2 What "modern + enhanced" means in practice

Vs. their current Odoo:

| Dimension | Today (Odoo) | The clone |
|---|---|---|
| **UI** | Generic Odoo forms, English-default, slow | Arabic-first RTL, dark command-center, mobile-responsive, sub-second navigation |
| **Sales** | Lives in Sheets + WhatsApp, not in any system | Native pipeline (Telesales → Sales → Handover) inside the dashboard |
| **Renewal cycles** | Implicit; tracked manually | First-class object — renewals are visible, scheduled, at-risk-flagged |
| **Org structure** | 110 flat users in 2 security groups; 1 stub department | Real 4-tier hierarchy (Head / Team Lead / Specialist / Agent), per-department |
| **SLA** | A field; no enforcement | Live engine — breach auto-escalates and surfaces in dashboards |
| **Decisions / escalation** | Tribal knowledge | Decision Rights Matrix + Escalation paths as data, enforced by code |
| **Exceptions** | Handled in WhatsApp | Typed (Client/Deadline/Quality/Resource), tracked, resolvable |
| **AI** | None | Native Gemini assistant grounded on the live schema; surfaces blockers, drafts replies, summarizes status |
| **Visibility** | Permissive | Agent sees only own tasks; Followers = soft governance layer |
| **WhatsApp** | Manual, parallel system | Integrated — client groups & internal groups auto-created with naming conventions |

---

## Part 2 — The Target

### 2.1 North-star outcome

> **"On any given Monday morning, the CEO opens one tab and sees the entire state of Sky Light — every active client, every at-risk deadline, every blocked task, every renewal due this month, every escalation in flight — and can act on each item without leaving the dashboard."**

### 2.2 Success criteria — by audience

| Role | "It works" looks like |
|---|---|
| **CEO** | Sees company health (active projects, revenue at risk, capacity utilization, escalations) on one screen; gets weekly auto-digest |
| **Head of Technical** | Sees per-department load, SLA breaches, review backlog, agent capacity |
| **CSO / Sales** | Pipeline by stage, conversion rates, deals to close this month, telesales activity |
| **Account Manager** | One screen per client: tasks status, what's with the client, what needs review, renewal date |
| **Specialist** | Their inbox of tasks awaiting review, brief-writing queue, client-changes loop |
| **Team Lead** | Their team's load, blocked tasks, distribution decisions to make |
| **Agent** | Only their own tasks, today's queue, log-note replies needed |
| **QC** | Cross-cutting read view of quality issues, rework patterns, governance breaches |
| **Client** *(future)* | Read-only portal: project status, deliverables awaiting approval, invoice history |

### 2.3 Hard non-functional targets

- **Arabic-first, RTL** — every screen, every email, every PDF
- **Mobile-responsive** — Heads and AMs work from phones
- **<300ms p95** for all dashboard reads
- **Zero data loss** during the Odoo cutover
- **Audit trail on every mutation** (`audit_log` + `ai_event` already wired)
- **Skeleton / empty / error states** on every page

### 2.4 Out of scope (explicit)

- POS, retail, ZATCA Phase-2 e-invoicing crypto, manufacturing, inventory, leave/payroll/attendance modules. (Owner doc never mentions; Odoo audit confirmed empty.)
- Generic CRM features unrelated to the agency model.
- Multi-tenant. (Schema keeps `organization_id`; UI is single-org.)

---

## Part 3 — The Context

### 3.1 The four source-of-truth documents

| Doc | Source | Purpose |
|---|---|---|
| `SPEC_FROM_OWNER.md` | Owner-authored | Operating-system intent — governance, decisions, escalation. **Wins all conflicts.** |
| `SPEC_FROM_PDF.md` | Trainee onboarding PDF | Mechanical workflow — stages, roles, upload offsets |
| `ODOO_AUDIT.md` | Live Odoo probe | As-built reality — which models exist, which have data, what's dead |
| `MVP_PLAN.md` | Original Phase 0–9 plan | What's already built |

### 3.2 What's already in the dashboard (don't rebuild)

From `MVP_PLAN.md` Phase 0–9 (mostly complete):
- Auth, RBAC, employee profiles, permissions
- Departments, employees, roles
- Clients, projects, tasks, task templates (basic CRUD)
- Sales handover form + handover engine
- Comments + @mentions + notifications
- Dashboard with stat cards, recent handovers, overdue tasks, activity feed
- AI assistant (Gemini) wired to the schema
- Audit log + AI event tables on every mutation
- Arabic RTL design system

### 3.3 What the Odoo audit confirmed

- Live Odoo runs on **7 active modules** out of 165 installed.
- Real footprint: **1,918 tasks · 78,154 log-note messages · 6,341 attachments · 33,837 stage-duration logs · 279 task templates across 13 service categories**.
- 8-stage workflow is implemented byte-for-byte — no drift from the PDF.
- HR/Payroll/Accounting are empty — the company doesn't use them.
- WhatsApp integration in Odoo is **not installed** — done manually today.

### 3.4 The 13 things the owner doc added

Sales engine · Inbound vs Outbound clients · Categories engine · **Renewal Cycles** · Team Lead tier · 4-level Decision Hierarchy · 5 Governance Rules · Exception Handling Model · Escalation Model · Decision Rights Matrix · SLA as control mechanism · Followers as soft governance · Dual Operating Control. (Detail in `SPEC_FROM_OWNER.md`.)

### 3.5 Open questions blocking commit

Listed in `SPEC_FROM_OWNER.md` §21 — must be answered by the owner before the relevant phases:

1. Renewal trigger: monthly date / per-contract cycle / manual?
2. Telesales: always required for inbound, or sometimes?
3. Team Leads: how many per dept, formally appointed?
4. Exception types: auto-action vs notification per type?
5. SLA values per stage?
6. WhatsApp: Cloud API account or Business app?
7. Renewal: new project row or continuation?
8. QC: write access or read-only?
9. Decision Rights Matrix: more rows than the 6 listed?
10. Sales replacement: in MVP or later?

---

## Part 4 — Strategic Principles

These bind every implementation decision. When in doubt, walk back to these.

1. **Governance is a feature, not a sidebar.** Every Governance Rule from §10 of the owner spec is enforced in code, not in docs.
2. **The schema mirrors the org.** If the owner says "Team Lead is a tier," the schema has a `team_lead` position. If the owner says "Followers are soft governance," followers are a separate table from assignees.
3. **The PDF wins on workflow mechanics.** The owner wins on intent. Odoo wins on "what data must we be able to import."
4. **Cutover before completeness.** Each phase ships to production behind a feature flag, used by 1 user, then expanded. We never plan a 6-month dark build.
5. **Read from Odoo, write to Supabase.** Until the company switches each module off in Odoo, we treat Odoo as a read-only legacy source. No two-way sync — that path leads to split-brain.
6. **Arabic-first means Arabic-first.** No "we'll translate later." UI text, audit-log messages, AI assistant replies, PDF exports — all Arabic by default, English only for technical labels (role keys, status enums).
7. **AI is a copilot for every role, not a feature.** Each phase ships at least one AI affordance grounded on that phase's data.

---

## Part 5 — Architecture View (8 layers → schema + UI)

| Layer | Schema artifacts | Primary UI |
|---|---|---|
| 1. Organization | `departments` (+ head_id, team_lead_ids) · `employee_profiles` (+ position enum: Head/TeamLead/Specialist/Agent) · `roles` · `permissions` | `/organization/{departments,employees,roles}` |
| 2. Sales Engine | `leads` · `lead_sources` (Inbound/Outbound) · `telesales_activities` · `sales_meetings` · `deals` · `handovers` (exists) | `/sales/{pipeline,leads,deals}` |
| 3. Delivery Engine | `service_categories` · `task_templates` (with offsets) · `projects` · `project_categories` · `renewal_cycles` (new) | `/clients`, `/projects/{id}` |
| 4. Task Workflow | `tasks` · `task_stages` · `task_messages` (Log Notes) · `task_attachments` · `task_followers` · `task_stage_history` | `/projects/{id}/tasks`, `/tasks/{id}` |
| 5. Permissions | `roles` · `permissions` · `user_roles` · RLS policies | `/organization/roles` |
| 6. Decision Hierarchy | `decision_rights` · `escalation_paths` | `/organization/decisions` (new admin page) |
| 7. Governance Rules | Enforced by server actions + RLS; surfaced via `governance_violations` table | Surfaced inside relevant modules |
| 8. Escalation/Exception | `exceptions` (typed: client/deadline/quality/resource) · `escalations` · SLA engine (edge function) | `/escalations`, badges everywhere |

Cross-cutting: `audit_log`, `ai_event`, `notifications` — already exist.

---

## Part 6 — The Steps (phased execution)

Each phase = 1–2 weeks of focused work. Each ends in a demoable vertical behind a feature flag. **Order is dependency-driven** — don't reorder casually.

> Numbering continues from `MVP_PLAN.md` (which ended at Phase 9).

### Phase 10 — Org structure realignment (Layer 1)
**Why first:** every later phase references positions and tiers.
- Add `position` enum to `employee_profiles` (Head, TeamLead, Specialist, Agent, Admin)
- Add `head_id` + `team_lead_ids[]` to `departments`
- Seed missing departments per owner doc: Account Management, Media Buying, SEO, Social Media, Designing, Programming, SEO Content, Social Content, Sales, Telesales, HR, QC
- Org-chart visualization page
- Migration script to map current Odoo `manager-group` (28) + `member-group` (39) members onto new positions
**Gate:** owner can open `/organization/chart` and see the full hierarchy with real names.

### Phase 11 — Permissions hardening (Layer 5)
**Why second:** every later phase relies on permission gating.
- Tighten RLS: Agents see only `tasks WHERE owner_user_id = auth.uid() OR auth.uid() = ANY(follower_ids)`
- Three permission tiers: Administrator / Manager / Agent (per owner §10)
- Permission matrix UI for Admin to assign
- Stage-owner gate strengthened (already exists in `STAGE_EXIT_ROLE`); add automated test suite
**Gate:** logging in as a seeded Agent shows ONLY their assigned tasks; an Agent cannot move stages they don't own.

### Phase 12 — Task workflow gaps (Layer 4) — PDF deltas
**Why third:** these are the small items the PDF requires that we don't yet do.
- `Delay (Days)` computed field on tasks (after Done)
- `Task Stage History` tab on task detail (we have `audit_log` — surface it)
- `task_followers` table separate from assignees
- Log Note attachments to Supabase Storage with thumbnails
- HOLD project state with reason
- Verify upload-deadline offsets in migration `0013` match PDF §11 exactly
**Gate:** every checkbox in `SPEC_FROM_PDF.md` §13 turns ✅.

### Phase 13 — Categories engine (Layer 3)
**Why fourth:** Stage-0 of the workflow depends on this; nothing else can be auto-generated without it.
- Port Odoo's `project.category.task` (279 templates across 13 services) into Supabase
- `service_categories` table + `task_templates` (with offset_days, default_owner_role, default_followers)
- "Import Categories" UX on project creation: pick services → see preview of generated tasks → confirm
- One-time importer from Odoo for the 279 templates (read-only Odoo, write to Supabase)
**Gate:** AM creates a new project, picks Social Media + SEO, sees ~30 tasks pre-generated with correct deadlines and assignees.

### Phase 14 — Sales Engine (Layer 2)
**Biggest greenfield.** Owner needs to confirm this is in MVP scope.
- `lead_sources` (Inbound/Outbound) · `leads` · `telesales_activities` · `sales_meetings` · `deals`
- Telesales pipeline kanban
- Sales pipeline kanban (Discovery / Follow-up / Negotiation / Closed)
- Deal-won → triggers existing handover engine
- Sales activity log + reporting (calls made, meetings booked, conversion rates)
**Gate:** Telesales user can log a cold call → qualify → book a meeting → Sales user can pick up from the meeting → close → handover form pre-fills from the deal.

### Phase 15 — Decision Hierarchy + Escalation engine (Layers 6 + 8)
- `decision_rights` reference table (seeded from owner §13 matrix)
- `escalation_paths` reference table (4 types from owner §12)
- `exceptions` table — typed (Client/Deadline/Quality/Resource), with reason + resolver
- SLA engine (Supabase Edge Function on cron) — checks per-stage SLA, creates escalation + notification on breach
- Escalation inbox per Head / Executive
**Gate:** an Agent's task sits in In Progress past its SLA → automatic exception created → Lead notified → resolves → exception closed; visible end-to-end.

### Phase 16 — Governance enforcement (Layer 7)
- Mandatory Log Note on stage transitions (server-action validator)
- "Invisible Work" detector: tasks with no Log Note in last N days → flag
- QC observer dashboard — read-only cross-cutting view of all departments + governance violations
- `governance_violations` table feeding a dashboard tile
**Gate:** QC user logs in, sees a single page listing today's governance issues by type and severity.

### Phase 17 — Renewal Cycles
**Owner-confirmed scope before building.** Depends on Q1 + Q7 in §3.5.
- `renewal_cycles` table linked to projects (or new project rows — TBD)
- Auto-generate renewal-category tasks per cycle
- "Renewals due this month" dashboard tile
- Renewal-at-risk flag (no AM activity in last X days)
- Cycle-based billing handle (not full invoicing — just the data model)
**Gate:** a project entering renewal month auto-generates its renewal tasks, surfaces on AM and CEO dashboards.

### Phase 18 — WhatsApp integration (closes the Dual Operating Control loop)
**Depends on Q6 in §3.5** — Cloud API vs Business app determines architecture.
- WhatsApp Cloud API integration
- Auto-create Client Group on first project: name `إدارة نشاط | <client_name>`
- Auto-create Internal Group: name `📍 <client_name>`
- AM = group admin in both
- Inbound message routing → assigned AM
- Templated outbound: task-sent-to-client, approval-needed, edit-requested
**Gate:** AM creates a project → both WhatsApp groups exist seconds later, named per convention; inbound client message appears as a notification.

### Phase 19 — Reporting + KPIs (closes Layer 4 metrics)
- Rework metrics (count of tasks that hit Client Changes more than once)
- On-time delivery rate (Done before Deadline)
- Productivity per agent (tasks closed / week, with median Duration per stage)
- Review backlog (tasks stuck in Manager/Specialist Review > N days)
- CEO weekly auto-digest (email + WhatsApp)
**Gate:** CEO opens Monday-morning view, gets a single page with the metrics described in 2.2.

### Phase 20 — Cutover from Odoo
- One-shot import: tasks (1,918), log notes (78k), attachments (6,341)
- Per-module cutover plan: parallel run for one cycle → freeze Odoo writes → switch primary
- Decommission rwasem_* modules in Odoo one by one
**Gate:** full week of operations runs on the dashboard with Odoo in read-only fallback mode; second week, Odoo dark.

### (Future) Phase 21 — Client portal
- Read-only client view: project status, deliverables awaiting approval, invoice history (when accounting added later)
- Likely after Phase 20 stabilizes

---

## Part 7 — Risks & open questions

### Risks

| Risk | Mitigation |
|---|---|
| Owner doesn't answer the 10 open questions → phases stall | Send Arabic message with the 10 questions before starting Phase 14 |
| Sales replacement underestimated (Phase 14 is the biggest greenfield) | Time-box Phase 14 to 3 weeks; if it overruns, ship pipeline-only and defer telesales |
| Renewal model wrong → bad data | Don't build Phase 17 until Q1 + Q7 answered |
| WhatsApp account mismatch (Cloud API rules require official) | Get owner to start the Cloud API approval process during Phase 11 |
| Cutover data integrity (78k log notes is non-trivial) | Build the importer in Phase 13 against a sandbox; dry-run twice before Phase 20 |
| RLS tightening breaks existing pages | Phase 11 ships behind a flag; full regression suite before promotion |

### Decisions parked for owner

The 10 questions in §3.5 / `SPEC_FROM_OWNER.md` §21. Most urgent (block the next 2 phases): #5 (SLA values) and #10 (Sales scope in MVP).

---

## Part 8 — Definition of done — for every phase

Before any phase is called done:

1. **Migration applied** to Supabase + types regenerated.
2. **RLS policies + server-action gates** in place — verified by Playwright permission test.
3. **Skeleton, empty, and error states** rendered on every new page.
4. **Mobile responsive** verified at 375px width.
5. **Arabic copy** sourced from `lib/copy.ts` — no hardcoded strings.
6. **Audit log + AI event** wired on every mutation.
7. **At least one AI affordance** added that uses the new data.
8. **Phase report** at `docs/phase-NN-report.md` with screenshots + smoke-test result.
9. **Behind a feature flag** until owner sign-off.

---

## Part 9 — How to start

Tomorrow:

1. Send the **10 owner questions** as one Arabic WhatsApp message. Block Phase 14 + 17 + 18 until answered.
2. Begin **Phase 10 (Org Structure)** — it depends on no answers, only on the org chart in `SPEC_FROM_OWNER.md` §2, which we already have.
3. Stand up a `feature_flags` table so every subsequent phase ships dark by default.
4. Sketch the SLA engine architecture (cron-driven Supabase Edge Function) so it's ready when Phase 15 starts.

That's the full view, the target, the context, and the steps.
