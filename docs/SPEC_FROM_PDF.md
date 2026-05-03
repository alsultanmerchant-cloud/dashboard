# Sky Light Operating-System Spec — extracted from the client PDF

Source: `~/Downloads/النظام التشغيلي وإدارة سير العمل للمتدربين في شركة سكاي لايت.pdf` (23 pages).
Raw text preserved at [`docs/skylight-operations-pdf.txt`](skylight-operations-pdf.txt).

This file is the **authoritative spec** for what the dashboard must do. Every claim below is taken verbatim from the PDF — line numbers in `[brackets]` reference `skylight-operations-pdf.txt`.

---

## 1. What Rwasem is

A task & project management system that organizes work end-to-end so the team always knows: every task, who owns it, and where it is. [L7–13]

Why it matters: clarifies ownership, organizes teamwork, prevents lost tasks, surfaces delays, guarantees on-time client delivery. [L18–23]

---

## 2. Task workflow — 8 stages, fixed order [L29–38]

| # | Stage | Arabic | Owner of exit |
|---|---|---|---|
| 1 | New | المهمة جديدة | Specialist (writes brief), Manager, Agent (in their turn) |
| 2 | In Progress | جاري تنفيذها | Agent |
| 3 | Manager Review | مراجعة المدير المباشر | Manager |
| 4 | Specialist Review | مراجعة المتخصص | Specialist |
| 5 | Ready to Send | جاهزة للإرسال | Account Manager |
| 6 | Sent to Client | تم إرسالها للعميل | (await client) |
| 7 | Client Changes | العميل طلب تعديل | Account Manager + Agent (via Log Note only) |
| 8 | Done | انتهت المهمة بالكامل | — |

Already mostly encoded in `src/app/(dashboard)/tasks/_actions.ts` (`STAGE_EXIT_ROLE`).

---

## 3. Stage-by-stage detail (with role)

### Stage 0 — Project start (Account Manager) [L40–51]
**Trigger:** client signs contract AND payment received.
- AM creates the project in Rwasem.
- All tasks are auto-generated according to selected services.
- Specialist assigned per service.
- Deadline (Planned Date) auto-set per task.
- Project becomes "ready to execute".

### Stage 1 — Task start (Specialist) [L56–59]
- Receives task in `New`.
- Writes all details/requirements in **Log Note**.
- Assigns to the relevant department head (e.g. designers' manager).

### Stage 2 — Distribution (Manager) [L64–67]
- Manager reviews the brief.
- Picks the right Agent.
- Assigns the Agent.

### Stage 3 — Execution (Agent) [L72–76]
- Agent receives in `New`, moves it to `In Progress`.
- Executes.
- On finish → moves to `Manager Review`.

### Stage 4 — Manager Review [L77–80]
- Manager QAs the work. If OK → `Specialist Review`.

### Stage 5 — Specialist Review [L85–88]
- Specialist (who wrote the brief) verifies against requirements. If OK → `Ready to Send`.

### Stage 6 — Send to client (Account Manager) [L93–96]
- AM picks the task, sends to client, moves to `Sent to Client`.

### Stage 7 — Client response [L101–106]
- Approved → straight to `Done`.
- Edit requested → `Client Changes`.

### Stage 8 — Client Changes [L111–120]
- AM writes the requested edits in Log Note.
- AM @mentions the Agent.
- Agent executes the edit.
- Agent @mentions AM back.
- AM resends to client.

> **Hard rule:** the Agent **does not change the stage** during Client Changes. All communication stays inside Log Note. [L118–120]

### Done [L125–128]
Client approves → task is `Done`.

---

## 4. Roles [L133–153]

| Role | Color | Responsibilities |
|---|---|---|
| **Specialist** | 🟡 | Defines requirements · starts the task · reviews final work |
| **Manager (Head)** | 🔵 | Distributes tasks · reviews execution quality · accountable for team speed |
| **Agent** | 🟢 | Executes · accountable for speed AND accuracy |
| **Account Manager** | 🔴 | Talks to client · manages edits & sending |

---

## 5. Duration vs Deadline (critical) [L154–181]

- **Duration** = time the task spent inside the current stage. Used to detect **internal slowness** (ops issue).
- **Deadline (Planned Date)** = final delivery date for the whole task.
  - Set when the task is created.
  - Tied to client contract.
  - **100% must be respected.**

**The difference:**
- `Duration` measures stage-level lateness (operational problem).
- `Deadline (Planned Date)` measures whole-task success (client problem — severe).

---

## 6. Projects page (`Projects`) [L182–247]

The main board: each tile = one client/project. Each `Project Box` shows:

1. **Client / Project name** — e.g. `pets life`, `serbest`, `Fit Fuel`. [L202–206]
2. **Services** — colored badges: Social Media, Media Buying, SEO, Website. [L207–215]
3. **Duration (Start / End)** — contract dates. [L217–221]
4. **Tasks count** — total tasks in project. [L223–226]
5. **Account Manager** — owner of client communication. [L228–231]
6. **Project Manager** — overall PM (usually fixed across projects). [L233–234]
7. **Status** — e.g. `HOLD` overlay if paused. [L235–236]

Purpose: at-a-glance company-wide view of active work, clients, services, fast navigation. [L241–247]

---

## 7. Project Tasks page (`Project Tasks`) [L248–299]

Kanban — one column per stage:
`New · In Progress · Manager Review · Specialist Review · Ready to Send · Sent to Client · Client Changes (only when active) · Done`

Each card (Task) shows:
1. **Task name** — what is required (e.g. "design post", "write content"). [L282–283]
2. **Duration ⏱** — how long the task has been sitting in its current stage (delay indicator). [L288–291]
3. **Service / Category** — SEO · Social Media · Media Buying. [L293–299]

---

## 8. Task page (`Task detail`) [L300–425]

### 8.1 Header info [L317–352]
- **Task name** [L321–322]
- **Assignees**: Specialist, Manager, Agent [L327–331]
- **Project / Category** [L336–339]
- **⚠ Deadline / Planned Date** — final delivery, contract-bound, 100% must hit [L343–346]
- **Delay (Days)** — appears after task ends; shows how many days late [L351–352]

### 8.2 The big rule [L357–360]
> Late inside stages → operations problem.
> Past the Deadline → problem **with the client**.

### 8.3 Tabs [L365–366]
- `Task Stage History` — full audit trail of stage transitions.

### 8.4 Log Note (where the real work lives) [L371–425]
Formal communication channel inside the task. Everything happens here:
- Requirements
- Edits
- Notes
- Replies

How it's used:
1. **Requirements** — Specialist writes the brief clearly, attaches files / Google Drive links. [L387–389]
2. **@Mention** — `@name` calls a specific person ("@Mohamed → you must work on this"). [L390–395]
3. **Execution** — Agent reads Log Note, executes, replies inside Log Note. [L400–403]
4. **Client Changes** — AM writes edits, @mentions Agent, Agent edits & replies, AM sends to client. [L408–412]

Stage-history events recorded inside Log Note: stage changes · people added · links shared (e.g. Google Drive) · @mentions. Everything documented and visible. [L417–425]

---

## 9. Company structure — 5 tiers [L426–521]

| Tier | Section | Color | Responsibilities |
|---|---|---|---|
| 1 | **Account Management** (`إدارة العمالء`) | 🔴 | Create projects & tasks · talk to client · send/receive work · manage edits |
| 2 | **Main Sections (Specialists)** | 🟡 | `Social Media`, `Media Buying`, `SEO` — define what's required · write task details · review pre-send |
| 3 | **Supporting Sections (Execution)** | 🔵 | **Design · Content Writing · Video Editing · Programming** — execute the work |
| 4 | **Managers / Heads** | 🟣 | One per section — distribute tasks · review · enforce quality |
| 5 | **Quality Control** | ⚪ | Independent, **outside the daily flow** — monitors overall quality · improves the system |

### Cross-section flow [L495–500]
1. AM starts the project & creates tasks.
2. Specialist (Main Section) defines requirements.
3. Manager distributes the task.
4. Agent (Supporting Section) executes.
5. Work is reviewed.
6. AM sends to client.

> **Critical:** every section has a defined role, **never crossed**. Executor executes. Reviewer reviews. Client-owner talks to the client. [L505–510]

---

## 10. WhatsApp integration [L522–588]

WhatsApp is **communication only**, never the system of record. [L587]

### 10.1 Client Group (`Client Group`) [L533–555]
- Created by AM after they're assigned the client.
- **Naming convention:** `إدارة نشاط | اسم العميل` ("Activity management | Client name") [L542]
- Used for: official client communication · work delivery · approvals · requirements intake · access requests.
- AM is responsible for the group. Everything must be clear and documented.

### 10.2 Internal Group (`Internal Group`) [L560–574]
- Created by AM after the Client Group.
- **Naming convention:** `📍 اسم العميل` (pin emoji + client name) [L568]
- Used for: team coordination · AM/Specialist Q&A · task follow-up · Rwasem reminders.

### 10.3 How they connect [L575–578]
- Client → Client Group.
- Team → Internal Group.
- AM is the bridge between the two.

### 10.4 Hard rules [L583–587, L646–649]
**Required ✅:**
- Every client request → recorded as a task in Rwasem.
- All execution → inside Rwasem.
- WhatsApp = communication only.

**Forbidden ❌:**
- Executing work without recording it in Rwasem.
- Talking to the client without the AM.
- Approving anything without documentation.

---

## 11. Upload-deadline rules [L592–644]

> **"Upload" = the day the Specialist must enter all task data into Log Note and assign to the relevant department manager.**

> **Applies only to tasks tied to Supporting Sections.** [L599]

### 11.1 Content Writing ✍️ [L602–616]

**🟢 Media Buying** — upload **Deadline − 2 days**.

**🔵 Social Media** (work split across 3 weeks, all uploaded the day after the client meeting):
- Week 1 → Deadline − 2 days
- Week 2 → Deadline − 3 days
- Week 3 → Deadline − 4 days

**🟠 SEO** (3-stage product/article content):
- All product & article content uploaded **on the same day** as the deadlines for the keyword tasks (30 products / 10 articles).

### 11.2 Graphics / Design 🎨 [L621–641]
*(uploaded after writing is complete)*

**🟢 Media Buying** — Deadline − 3 days.

**🔵 Social Media** (3 weeks, after writing is done):
- Week 1 → Deadline − 3 days
- Week 2 → Deadline − 4 days
- Week 3 → Deadline − 5 days
- 📍 If stories/videos exist → Deadline − 4 days.

**🟠 SEO:**
- Landing page → Deadline − 4 days
- Article banners → Deadline − 5 days *(text in PDF is partially garbled; confirm with client)*

> Already partially seeded in migration `0013`. Need to verify migration matches every offset above.

---

## 12. Final summary [L654–659]
- **Rwasem** = task management & execution.
- **WhatsApp** = communication & coordination.
- **Account Manager** = the connecting link.
- Success depends on the three working together correctly.

---

## 13. Deltas vs current dashboard (initial pass)

What the PDF requires that the dashboard does **not yet** fully cover:

| PDF requirement | Status | Note |
|---|---|---|
| Stage 0 auto-task generation per service | ✅ partial | Handover engine does this; verify it covers all service combinations |
| `Project Box` fields (Project Manager field, HOLD overlay) | ✅ | T3: red HOLD ribbon on `/projects` list keys off `held_at IS NOT NULL`; reason on hover. Detail page banner already shipped pre-T3. |
| Task `Delay (Days)` field shown after Done | ✅ | T3 (migration 0023): `tasks.delay_days` is a STORED GENERATED column, populated when `stage='done'` AND planned_date+completed_at are set. Surfaced as a red banner "تأخر التسليم بـ N يوم" on task detail. |
| `Task Stage History` tab on task detail | ✅ | T3: task detail tab "تاريخ المراحل" surfaces real `task_stage_history` rows (populated by the 0007 trigger), via `src/lib/data/task-detail.ts`. Falls back to the activity feed for tasks predating the trigger. |
| Log Note with file/Drive-link attachments + @mentions | ⚠ partial | Comments + @mentions + Drive-link auto-recognition already exist. Storage attachments BLOCKED on bucket configuration — see `docs/phase-T3-questions.md` §1. |
| Supporting Sections as a separate org tier (Design, Content Writing, Video Editing, Programming) | ✅ | Shipped in T1 (migration 0021 + 0018 seed). |
| Quality Control as an independent watcher role outside daily flow | ❌ DROPPED | Owner directive 2026-05-02 round 3 (`docs/DECISIONS_LOG.md`) — out of scope. |
| Agent **cannot** change stage during `Client Changes` | ✅ | Trigger `assert_stage_transition_allowed` (migration 0015) gates by role_type; STAGE_EXIT_ROLE in `tasks/_actions.ts` mirrors it for friendly errors. Verified pre-T3. |
| Upload-deadline offsets (migration 0013) | ✅ seeded | Audit values against §11 above |
| WhatsApp Client Group + Internal Group (auto-naming, AM is owner) | ❌ missing | Future Phase — not built yet |
| HOLD project state with reason | ✅ | Shipped in 0019 + UI; T3 added the list-view ribbon and re-keyed the detail banner off `held_at IS NOT NULL` per dispatch. |
| Task followers (distinct from assignees) | ✅ NEW (T3) | Migration 0023 added `task_followers`; `tasks_select` re-created to grant followers visibility; UI section + server actions in `/tasks/[id]`. |

---

## 14. How to use this doc

When designing **any** feature touching tasks, projects, roles, deadlines, departments, or WhatsApp — open this file first. If a proposal contradicts a rule here, the rule wins (not the proposal). When in doubt, the raw PDF text in `skylight-operations-pdf.txt` is the ultimate source.

Step 2 of the plan is to walk the `rwasem_*` Odoo addons and map each one to a section above — that gives us the full feature inventory.
