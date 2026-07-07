# Satisfaction 2.0 — Accountability-Aware Client Audit (Design Spec)

> Goal: turn `/satisfaction` from a "chat sentiment reader" into the company's
> **centralized client audit**: every complaint is connected to the real tasks,
> the real people who worked (or didn't work) on them, the contract state, and
> the team's activity — so the CEO reads *"the client says the campaign brought
> no traffic"* and immediately sees **which media-buying tasks, owned by whom,
> in which stage, with what activity** sit behind that complaint.

## 0. Design principles (non-negotiable)

1. **Code computes facts, AI writes words.** All names, counts, task codes,
   stage durations, and activity numbers are computed in SQL/TS and passed to
   the model as a roster. The model may only *select and cite* from that
   roster — it never invents a name, count, or task code. (Same rule already
   validated on the CEO brief generative-UI work.)
2. **Ownership, not blame.** Attribution follows the accountability engine's
   verified semantics: stuck-in-review → the **stage owner** (per migration
   0222 template stage-ownership), execution delay → the **executing
   assignee**, missing brief/late approvals → the **account manager**,
   no-specialist-assigned → **department/slot gap**. Language in the prompt is
   "المسؤولية التشغيلية" (operational ownership), evidence-based, never
   accusatory.
3. **Degrade honestly.** Odoo-synced tasks have sparse `due_date`/assignment
   data. When person-level data is missing we attribute to the *slot* (e.g.
   "لا يوجد أخصائي ميديا معيّن على المشروع") — that absence is itself a
   finding, not something to paper over.
4. **Fix PM data at the source.** If attribution looks wrong because a
   position/assignment is wrong, fix the org data — don't bend this feature to
   compensate (established working rule).

## 1. What exists today (verified against schema + code)

| Building block | Where | Status |
|---|---|---|
| Client + technical chat transcripts (merged .txt + live WA, link-graph resolved) | `buildClientTranscripts` | ✅ in prompt |
| Execution snapshot (overdue tasks, stages, bottlenecks, days-stuck) | `getClientExecutionSnapshot` | ✅ in prompt — **but has zero people data** |
| Contract portfolio + activity log (merge-twin bridge) | `getClientContractContext/Activity` | ✅ in prompt |
| Brief doc + adherence scoring | `getClientBrief` | ✅ in prompt |
| Task → people chain | `task_assignees` (employee_id, `role_type`, `team_manager_employee_id`, `head_of_dept_employee_id`) | ❌ not used |
| Project → service specialists | `projects.social_specialist_id / media_specialist_id / seo_specialist_id` (0049) | ❌ not used |
| Per-person actions (comments, stage moves, authored activity) | `task_comments.actor_employee_id + action_kind` (0229, Team-Pulse-verified) | ❌ not used |
| Stage ownership (who owns a stuck stage) | `tasks.stage_owner_positions` + 0222 template ownership | ❌ not used |
| Task service classification | `tasks.service_id`, `projects` service | ❌ not used |
| Stage history / re-entry folds | `task_stage_history` (+ `task_stage_dwell` cache) | ❌ not used |

**Conclusion:** the accountability layer already exists for `/accountability`
and Team Pulse — Satisfaction just never received it. We reuse, not rebuild.

## 2. New data layer — `getClientTeamActivitySnapshot`

`src/lib/data/satisfaction-team.ts` (new file; keeps satisfaction.ts from
growing further). Cached with `react.cache` like its siblings.

```ts
export interface TeamMemberActivity {
  employeeId: string;
  name: string;               // employee_profiles display name
  role: string;               // live from position (org-hierarchy rule: 3 distinct leader levels)
  department: string | null;
  basis: "assignee" | "stage_owner" | "specialist_slot" | "account_manager" | "team_manager" | "head_of_dept";
  assignedOpenTasks: number;
  overdueTasks: number;
  actions30d: number;         // authored comments + stage moves (task_comments by actor, 0229 semantics)
  lastActionAt: string | null; // Riyadh-day formatted (src/lib/tz.ts)
}

export interface ServiceLine {
  service: string;                    // "Media Buying" | "Social Media" | "SEO" | "أخرى"
  specialistSlot: { name: string | null; filled: boolean }; // from projects.*_specialist_id
  totalTasks: number;
  overdueTasks: number;
  stuckTasks: Array<{
    taskCode: string | null;
    title: string;
    stage: string;
    daysStuck: number | null;
    assignee: string | null;          // executing assignee (task_assignees role_type=executor)
    stageOwner: string | null;        // who owns the CURRENT stage (stage_owner_positions → position → people)
    lastActionBy: string | null;
    lastActionAt: string | null;
    comments30d: number;
    stageMoves30d: number;
  }>;                                 // worst-stuck first, max 5 per service
}

export interface ClientTeamActivitySnapshot {
  accountManager: { name: string | null; source: "handover" | "contract_log" | null };
  services: ServiceLine[];            // grouped by tasks.service_id → services.name, fallback project service
  people: TeamMemberActivity[];       // deduped roster across services, max ~15
  gaps: string[];                     // code-detected structural findings, e.g.
                                      // "لا يوجد أخصائي ميديا معيّن", "لا توجد مهام Media Buying رغم وجود عقد ميديا"
}
```

Query plan (all org-scoped, one round of `Promise.all`):
1. Client's non-archived projects (existing pattern) → project ids + the 3
   specialist slot ids.
2. `tasks` for those projects: id, code, title, stage, service_id,
   stage_entered_at, is_overdue, stage_owner_positions.
3. `task_assignees` for those task ids, embedding
   `employee_profiles(display name)` + position (pin FKs — PGRST201 gotcha).
4. `task_comments` for those task ids, last 30 days, `actor_employee_id not
   null`: count by (actor, kind ∈ comment|stage_change), max(created_at).
   **Author-attributed only** — the 0229 lesson: never count activity *on*
   someone's task as *their* action.
5. `services` name map + employee/position/department name maps.
6. Account manager: `sales_handover_forms.assigned_account_manager_employee_id`
   → fallback latest `contract_sheet_logs.account_manager` string.

Cross-service correctness notes:
- **Contract ⇄ service cross-check** powers the killer feature: client has a
  Media Buying contract + complains about traffic + `services` shows the media
  slot empty or its tasks stuck in `manager_review` → the gap line names the
  exact hole. Contract service names need the **Renewal-merge normalization**
  (strip leading emoji + "Renewal " prefix) already fixed in service-health.
- Riyadh calendar days for "lastActionAt/actions30d" boundaries (tz.ts).
- Two review stages are distinct: `manager_review` → team_manager;
  `specialist_review` → executing assignee (review-rigor rule).

## 3. Schema additions — `SatisfactionSchema`

New top-level field (zod, in `satisfaction-schema.ts`):

```ts
accountability: z.array(z.object({
  complaint: z.string(),              // the client's actual complaint (quote/faithful summary)
  service: z.string().nullable(),     // which service line it maps to
  finding: z.string(),                // where the problem actually sits, 1-2 sentences
  responsible: z.array(z.object({
    name: z.string(),                 // MUST be from the provided roster
    role: z.string(),
    basis: z.enum(["assignee","stage_owner","specialist_slot","account_manager","team_manager","head_of_dept","process_gap"]),
  })).max(3),
  taskCodes: z.array(z.string()).max(5),  // MUST be from provided task codes
  evidence: z.string(),               // the factual chain: task X stuck in stage Y for Z days, last action by W
  confidence: z.enum(["high","medium","low"]),
})).max(6)
```

And extend the existing `causes` items with `ownerName: z.string().nullable()`.

**Post-generation validation in `persistSatisfaction`** (hard guardrail):
drop any `responsible.name` not in the snapshot roster and any `taskCode` not
in the snapshot task list; if a row loses all its people AND codes, drop the
row. The model cannot leak invented names into the DB even if it hallucinates.

Persistence: migration `0238_satisfaction_team_context.sql` adds to
`client_satisfaction_analyses`:
- `team_context jsonb` — the frozen `ClientTeamActivitySnapshot` input (same
  pattern as `contract_context`; the UI renders from the frozen snapshot so
  history stays truthful).
- `accountability jsonb` — the validated AI output.
Idempotent `alter table ... add column if not exists`, mirrored to file after
applying via Management API.

## 4. Prompt changes — the 5th source

`buildSatisfactionInput` gains:

```
=== الفريق والمسؤوليات (بيانات نظام — أسماء وأرقام حقيقية) ===
مدير الحساب: {name}
[لكل خدمة] الخدمة: Media Buying — الأخصائي: {name أو "غير معيّن ⚠️"} — مهام: N (متأخرة M)
  أسوأ المهام: [PRJ-007-014] {title} — مرحلة {stage} منذ {d} يوم — المنفّذ: {name} — مالك المرحلة: {name} — آخر إجراء: {name} في {date} — نشاط ٣٠ يوم: {c} تعليق/{s} نقلة
[الروستر] {name} — {role} — {dept} — مهام مفتوحة N — إجراءات ٣٠ يوم: K — آخر إجراء {date}
[فجوات مكتشفة آليًا] ...
```

Prompt instruction block (added to the numbered outputs):

```
— accountability (اربط الشكوى بالمسؤول) —
لكل شكوى جوهرية من مجموعة العميل: حدد الخدمة، ثم اربطها بالمهام والأشخاص من
قسم "الفريق والمسؤوليات" حصراً. قواعد الإسناد:
- مهمة عالقة في manager_review → مالك المرحلة/مدير الفريق هو نقطة التوقف.
- مهمة عالقة في التنفيذ → المنفّذ المعيّن.
- لا يوجد أخصائي معيّن للخدمة المشكو منها → المسؤولية فجوة إسناد (process_gap) لا شخص.
- تأخر اعتمادات/بريف ناقص → مدير الحساب.
استخدم الأسماء وأكواد المهام كما وردت حرفياً — لا تخترع اسماً أو كوداً أو رقماً.
صِغ finding كتشخيص مهني محايد (أين تتركز المشكلة) لا اتهاماً شخصياً.
إن لم يوجد دليل كافٍ اربط بالخدمة فقط واجعل confidence=low.
```

Budget: the block is capped at ~5,000 chars (5 tasks × service, 15-person
roster). It rides *outside* the transcript `trim()` budget, same as the
contract/execution blocks, so the retry-shrink loop never amputates it.

Both entry points get it for free (blocking `analyzeClientSatisfaction`,
streaming route, daily cron) since all flow through
`buildSatisfactionInput → persistSatisfaction`.

## 5. UI — the audit view

### 5.1 New card in the detail view: "المسؤولية والفريق"
Placed after المؤشرات, before مجموعة العميل signals:
- One row per `accountability` item: complaint quote → arrow → finding, with
  **person chips** (name + role + basis icon) and **task-code chips**.
- Task chips deep-link to `/tasks/[id]` (resolve code→id server-side);
  person chips link to `/accountability?employee=...`; service line links to
  the project. (Drill-down rule: land on exactly the cited set.)
- Confidence rendered as subtle badge; `process_gap` rows get the ⚠️ slot-gap
  styling, visually distinct from person attribution.

### 5.2 Team activity strip (from `team_context`, pure facts)
Collapsible table under the card: the roster (person, role, open/overdue
tasks, 30-day actions, last action). Renders even when the AI produced no
accountability rows — the CEO still sees who's on the account and who's been
silent. Empty/skeleton/RTL states per house rules.

### 5.3 Board (unchanged except)
At-risk cards show up to 2 tiny person chips from the top accountability row —
the "who do I call" answer at board level.

## 6. Rollout plan

| # | Step | Deliverable |
|---|---|---|
| 1 | Migration 0238 (`team_context`, `accountability` columns) | applied + mirrored file |
| 2 | `satisfaction-team.ts` data layer + unit-sanity via a script against 2-3 real clients (incl. the traffic-complaint client from the screenshot) | snapshot JSON eyeballed for name/attribution correctness |
| 3 | Schema + prompt + roster validation in `persistSatisfaction` | one manual re-analyze, verify no invented names |
| 4 | Detail-view card + roster strip + board chips | visual check via preview |
| 5 | **Batch re-analyze**: run the deferred "analyze all pending in parallel" job — now producing accountability-aware analyses in one pass (concurrency ~4, flagship model, reuse cron path) | board fully scored |
| 6 | Knowledge-staleness stamp bump so old analyses show the "stale" flag and refresh through the cron | old analyses converge |

Step 5 deliberately comes *after* 1-4: analyzing ~dozens of pending clients
twice (once now, once after the upgrade) would double the Gemini spend for
nothing.

## 7. Risks / open questions

- **Assignment sparsity:** if `task_assignees` turns out mostly empty for
  Odoo-synced tasks, person attribution degrades to specialist slots + stage
  owners. The step-2 sanity script measures coverage first; if <30% of tasks
  have assignees we lean the prompt toward slot/stage attribution and say so.
- **Sensitivity:** analyses now put employee names next to client complaints,
  visible to anyone with `clients.manage`. Mitigated by neutral-language rules
  + roster validation; flag to the client (Sky Light) that this is by design.
- **Prompt growth:** +~5k chars per analysis. Well within the 45k budget, but
  monitor the schema-retry rate; the accountability field is the most complex
  structured output yet.
- **AM identity:** `contract_sheet_logs.account_manager` is a free-form sheet
  string, not an employee FK — fallback only, displayed as-is.
