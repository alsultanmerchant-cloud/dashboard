# Sky Light Operating System — Owner-authored Spec

Source: `docs/skylight-owner-system.md` (provided directly by the company owner — supersedes the trainee PDF where they disagree).

This document re-frames Sky Light from "marketing agency" → **"Service Delivery Operating System"**. It adds **8 layers** the trainee PDF (`SPEC_FROM_PDF.md`) and the Odoo audit (`ODOO_AUDIT.md`) did not capture. Read this **in addition to** those, not instead of them.

Line refs in `[L#]` point to `skylight-owner-system.md`.

---

## What's new in this document (not in PDF or Odoo audit)

The 13 net-new concepts the owner introduces — these reshape the build plan:

| # | New concept | Section | Why it matters for the clone |
|---|---|---|---|
| 1 | **Sales engine** (Telesales → Sales → Handover) | §3, §22 | Currently lives in Sheets + WhatsApp, not Rawasem — biggest greenfield opportunity |
| 2 | **Inbound vs Outbound clients** | §3 | Different intake flows, different attribution |
| 3 | **Categories engine** generates tasks (Onboarding / MB / SM / SEO / **Renewal Cycles**) | §3, §4 | Confirms `project.category.task` from audit; adds Renewal as a category |
| 4 | **Renewal Cycles** as recurring delivery (not one-time) | §19 | Core insight — every project is recurring; pricing/billing is monthly |
| 5 | **Team Lead** as explicit middle layer | §16 | Three-tier per dept: Head → Team Leaders → Agents (PDF jumped Head → Agent) |
| 6 | **4-tier Decision Hierarchy** (Agent / Lead / Head / Executive) | §24 | Escalation rules: never skip a tier |
| 7 | **5 Governance Rules** (ownership, stage-owners, log-note-as-truth, permissions, reviews=gates) | §25 | These are hard rules to enforce in code |
| 8 | **Exception Handling Model** — 4 types | §26 | Client / Deadline / Quality / Resource — each with a flow |
| 9 | **Escalation Model** — 4 types | §27 | Operational / Functional / Client / Critical |
| 10 | **Decision Rights Matrix** | §28 | Explicit "who decides what" table |
| 11 | **SLA as control mechanism** (not just KPI) | §29 | Breach → admin trigger, not just a number |
| 12 | **Followers as soft governance** | §30 | AM as follower = oversight without ownership |
| 13 | **Dual Operating Control** (System + Human) | §31 | Rawasem alone isn't the system; WhatsApp + handoffs are part of it |

---

## 1. Identity (re-framing) [L4–17]

> Sky Light is **not** "a marketing agency" — it is a **Service Delivery Operating System** built on Client management + Execution + Reviews + Delivery.

**Core Services** (revenue-bearing): Social Media Management · Media Buying · SEO

**Supporting Services** (execution arm, never standalone): Designing · Programming · SEO Content · Social Content

> "Supporting services do not work as a standalone line — they are an execution arm supporting the core services."

---

## 2. Org chart — leadership tier [L20–53]

```
CEO
├── Head of Technical
│   ├── Account Management
│   ├── Media Buying
│   ├── SEO
│   └── Social Media
│
├── CSO (Head of Sales)
│   ├── Sales
│   └── Telesales
│
└── Administrative Functions
    ├── HR
    ├── Accountant
    ├── Assistants
    └── Quality Control
```

**Inside each technical/sales department, a 3-tier:**

```
Head → Team Leaders → Agents
```

> ⚠ The trainee PDF flattened this to 5 sections. The owner adds **CEO + CSO + Head of Technical + Team Leaders** as explicit positions. The Supabase schema currently models neither. Departments table needs `head_id`, `team_lead_ids`, plus an enum for tier.

---

## 3. Client Lifecycle — full picture [L57–113, L115–148]

### 3.1 Lead acquisition — two sources
- **Inbound (Lead Clients)** — paid ads, inbound leads
- **Outbound (Data Clients)** — cold calls, cold messaging, prospecting

### 3.2 Telesales role [L75–86]
Entry point for **all** clients (even inbound).
- Qualification
- Convince to attend a meeting
- Book the meeting with Sales
- **Role ends** when client enters the Sales meeting.

### 3.3 Sales role [L89–97]
1. Discovery meeting
2. Understand client need
3. Follow-up (may be long)
4. Close deal
5. Sign contract
6. Onboarding handover

### 3.4 Sales → Account Management handover [L100–112]
Formal handover from **Sales Manager → Account Management Head**, including:
- Client data
- Scope
- Sold services
- Agreement details

> **Important:** Sales pipeline is **NOT** managed inside Rawasem today — it lives in Sheets + WhatsApp + external tools. **This is the biggest greenfield opportunity for the clone.**

### 3.5 Project Setup (AM) [L115–147]
On client receipt, AM creates a Project in Rawasem with:
- Client Information
- Services sold
- **Import Categories** → triggers task generation

**Categories are the engine.** They auto-generate: Tasks · Deadlines · Planned Dates · Initial assignments.

Example categories: `Onboarding`, `Media Buying`, `Social Media`, `SEO`, `Renewal Cycles`.

---

## 4. Task lifecycle [L163–189]

Main path:
```
New → In Progress → Manager Review → Specialist Review → Ready To Send → Sent To Client → Done
```

Edit loop:
```
Sent To Client → Client Changes → (back to flow)
```

> Confirms PDF §2 + Odoo audit (8 stages, byte-for-byte).

---

## 5. Execution chain inside Technical [L193–210]

When a task needs a Supporting Department, a **mini supply chain** runs inside the task:

```
Specialist
↓ (writes Requirement in Log Note + Assign)
Supporting Department Lead
↓ (assigns Agent)
Agent
↓ (executes, returns)
Lead/Flow
```

Real example for a Social post:
```
Social Specialist → Content brief → Design Lead → Designer Agent → Manager Review → Specialist Review → Ready To Send
```

> ⚠ This is **not** the same as the PDF's flat "Specialist → Manager → Agent". The owner adds the **Supporting Lead** node between Specialist and Agent. Schema impact: tasks may have multiple owner roles per supporting dept involved.

---

## 6. Permissions model [L260–269]

Three permission tiers:
- **Administrator** — top-level
- **Manager** — team & review management
- **Agent** — sees only tasks **assigned to them**, nothing else

> Agent visibility restriction is critical. Currently our RLS is permissive (`has_org_access`) — must tighten before rolling out to agents.

---

## 7. Followers system [L273–280]

Followers ≠ assignees. A follower (e.g. AM) is **informed of all activity** without owning execution.

> Per §30: this is **soft governance** — visibility without ownership. Schema needs a separate `task_followers` table beyond `task.assignees`.

---

## 8. Current KPIs vs missing KPIs [L283–298]

**Currently measured:**
- SLA per stage
- Task aging

**Not yet measured (future state):**
- Rework metrics
- On-time delivery
- Productivity dashboards
- Review backlog dashboards

---

## 9. Decision Hierarchy — 4 levels [L599–657]

| Level | Owner | Examples |
|---|---|---|
| 1 | **Agent** | Execute task · choose technical method · request clarification · raise blockers. Does NOT change scope. |
| 2 | **Team Lead** | Distribute work · rebalance load · handle stuck agent · primary review · solve simple execution issues |
| 3 | **Head / Specialist** | Adjust approach · quality calls · resolve conflicting priorities · escalated client issues · deadline exceptions |
| 4 | **Executive (CSO / Head of Technical / CEO)** | Strategic priority change · resource allocation · escalate sensitive client · abnormal exceptions |

> **Hard rule:** Escalation goes **upward, never skipping**. `Agent → Lead → Head → Executive`.

---

## 10. Governance Rules [L661–695]

Five hard rules — must be enforced in code:

| # | Rule | Enforcement in clone |
|---|---|---|
| 1 | Every task has a clear owner | NOT NULL on `tasks.owner_user_id` |
| 2 | Stages don't move randomly — each stage has a designated owner who moves it | Server-action gate (already exists in `STAGE_EXIT_ROLE`) |
| 3 | Log Notes are the source of truth | All requirements UI must write to `task_messages` table |
| 4 | Permissions control visibility AND execution (not just IT, it's governance) | Tighten RLS, gate server actions |
| 5 | Reviews = Control Gates (not just stages) | Manager Review + Specialist Review must be skip-proof |

---

## 11. Exception Handling Model — 4 types [L698–737]

| Type | Trigger | Decision owner |
|---|---|---|
| **A) Client Exception** | Client requested out-of-scope | AM + Specialist (± Head) |
| **B) Deadline Exception** | Abnormal delay | Escalation |
| **C) Quality Exception** | Substandard output | Returns to flow |
| **D) Resource Exception** | Capacity / resource shortage | Lead / Head |

Flow: `Normal Flow → Exception detected → Escalation → Decision → Return to flow`

> Schema impact: tasks need an `exception_state` (none / client / deadline / quality / resource) with a reason and resolver.

---

## 12. Escalation Model — 4 types [L742–765]

| Type | Path |
|---|---|
| **Operational** (task blocked) | Agent → Lead |
| **Functional** (specialty issue) | Lead → Head |
| **Client** (issue with client) | AM → Head / Executive |
| **Critical** (client at risk / crisis) | Direct jump upward (only exception to no-skip rule) |

---

## 13. Decision Rights Matrix [L769–782]

| Decision | Owner |
|---|---|
| Execute task | Agent |
| Distribute work | Lead |
| Approve quality | Manager / Specialist |
| Change scope | Head |
| Client exception | Executive |
| Change resource priorities | Executive |

> Build directly into a `permissions` taxonomy plus a `decision_rights` reference table.

---

## 14. SLA as a control mechanism [L786–793]

SLA is **not** just a metric — when breached:
- It becomes an **administrative trigger**.
- Auto-escalation should fire.
- Should change UI state (visible flag) on the affected record.

> Need an SLA engine: per-stage SLA → cron/edge-function check → exception record + escalation notification.

---

## 15. Dual Operating Control [L805–826]

The system **isn't** Rawasem alone. It's:

```
Structured Control (inside Rawasem)
        +
Human Control Layer (WhatsApp · handoffs · Heads oversight · escalations)
```

> Implication for the clone: WhatsApp integration is **not optional** — it's part of the operating model. The PDF §10 rules (client group, internal group, naming conventions) become a build requirement, not a nice-to-have.

---

## 16. Multi-layer Quality Model [L830–845]

Quality is distributed across 5 layers, not concentrated in QC:

```
Agent execution quality
+ Lead review
+ Manager review
+ Specialist review
+ Client approval
```

QC is **outside** the daily flow but **observes** all of them.

---

## 17. Governance Risks (owner's own diagnosis) [L849–871]

| Risk | Description |
|---|---|
| **Invisible Work** | Things happening outside Log Notes |
| **Handoff Risk** | Information lost during handover |
| **Permission Blind Spots** | Permissions hide something important |
| **Escalation Delay** | Issue not raised quickly enough |

> Each of these maps to a feature opportunity in the clone:
> - Invisible Work → mandatory Log Note on stage transitions
> - Handoff Risk → structured handover form (we already have one for sales→AM)
> - Permission Blind Spots → audit-log read access for QC + Head
> - Escalation Delay → SLA timer + auto-escalation

---

## 18. Operating-system layers — final inventory [L875–887]

The owner consolidates Sky Light into **8 layers**:

```
1. Organization
2. Sales Engine
3. Delivery Engine
4. Task Workflow
5. Permissions
6. Decision Hierarchy
7. Governance Rules
8. Escalation & Exceptions
```

> Our build plan should be organized around these 8 layers, not around Odoo modules.

---

## 19. Synthesis — what changes in the build plan

### A. Net-new modules the clone must add (not in current dashboard, not in Odoo today)
1. **Sales engine** (Telesales → Sales → Pipeline → Handover) — replaces Sheets/WhatsApp ad-hoc
2. **Categories engine** (auto-generates tasks with deadlines/assignments per category) — replaces Odoo's `project.category.task`
3. **Renewal Cycles** as a first-class object (recurring delivery, not one-time)
4. **Team Lead** position in org schema
5. **Decision Rights** + **Escalation paths** as data, not just docs
6. **Exception engine** — typed, tracked, resolved
7. **SLA engine** with breach triggers and auto-escalation
8. **Followers** as a separate concept from Assignees
9. **WhatsApp integration** (client group + internal group conventions) — promoted from "future" to "core"
10. **QC observer dashboard** — read-only cross-cutting view

### B. Things the clone must enforce (not just display)
- Stage-owner gating (already partly done)
- Agent visibility restricted to own tasks
- Mandatory Log Note on stage transitions
- Escalation never skips a tier (except Critical)

### C. Things to drop from the prior plan
- Heavy HR/Payroll/Attendance/Leaves modules — owner doc never mentions them; Odoo audit confirmed they're empty. Build later, only if requested.

---

## 20. Updated build order (proposed v3)

Re-organized around the owner's 8 layers, sequenced by dependency:

| Sprint | Layer | What ships |
|---|---|---|
| 1 | Org Structure (Layer 1) | Add CEO/CSO/Head/TeamLead positions; departments get head_id + team_lead_ids; permission tiers (Admin/Manager/Agent) |
| 2 | Permissions (Layer 5) — **gating layer** | Tighten RLS so Agent sees only own tasks; enforce stage-owner gates fully |
| 3 | Task Workflow (Layer 4) — **fill PDF gaps** | Delay (Days) field, Stage History tab, Followers separate from Assignees, Log Note attachments |
| 4 | Delivery Engine (Layer 3) part 1 — **Categories engine** | Port `project.category.task` (279 templates) into Supabase; auto-task generation on project creation |
| 5 | Sales Engine (Layer 2) | Telesales pipeline → Sales pipeline → Handover form; Inbound vs Outbound source tracking |
| 6 | Decision Hierarchy + Escalation (Layers 6 + 8) | Decision Rights Matrix as data; Exception types; SLA engine with auto-escalation |
| 7 | Governance Rules (Layer 7) | Mandatory Log Note on transitions; QC observer dashboard; audit-log read access for Heads |
| 8 | Renewal Cycles | Recurring project model; renewal triggers; renewal-specific category |
| 9 | WhatsApp integration | Client group + Internal group automation; AM-as-bridge automation |
| 10 | Reporting + KPIs | Rework metrics, on-time delivery, productivity dashboards, review backlog |

---

## 21. Open questions for the owner (must answer before build)

1. **Renewal Cycles** — what triggers them? Date-based (monthly), service-based (per cycle defined in contract), or manual? Pricing per cycle?
2. **Telesales** — is it always-required even for inbound, or only sometimes? Are telesalespeople separate from Salespeople?
3. **Team Leads** — how many per department, on average? Are they currently formally appointed in Rawasem, or just informally known?
4. **Exception types** — for each (Client/Deadline/Quality/Resource), what's the desired auto-action vs notification only?
5. **SLA values** — what are the current per-stage SLA thresholds? (We need numbers to wire the engine.)
6. **WhatsApp** — official Cloud API account available? Or Business app on a phone? (Determines integration approach.)
7. **Renewal vs new project** — is a renewal a new `project` row, or a continuation of the same project?
8. **QC** — does QC need write access (block transitions) or strictly read-only oversight?
9. **Decision Rights** — the matrix in §13 has 6 rows. Are there more decision types we should bake into permissions?
10. **Scope of the "clone"** — do we replace Sales-in-Sheets in this MVP, or only Rawasem first and Sales later?

---

## 22. How to use these three documents together

| Document | Source | Use when |
|---|---|---|
| `SPEC_FROM_PDF.md` | Trainee onboarding PDF | You need the **mechanical workflow** — stage definitions, role responsibilities, upload offsets |
| `ODOO_AUDIT.md` | Live Odoo probe | You need the **as-built reality** — what models exist, what data lives where, what's actually used vs dead |
| **`SPEC_FROM_OWNER.md`** (this) | Owner's own writeup | You need the **operating-system intent** — governance, decisions, escalation, why things are designed the way they are |

The owner doc **wins** when there's a conflict.
