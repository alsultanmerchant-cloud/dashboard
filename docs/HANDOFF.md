# Handoff — Sky Light dashboard, mid-execution

**As of commit `b678073` on `main` · pushed to `origin/main`**

You are picking up the Sky Light dashboard build (codename Rwasem / Rawasm), the operator + AI layer that gradually replaces a customized Odoo 17 deployment. Read this whole file before doing anything. Then read the docs it points at.

---

## 1. Where we are

```
✅ T0     Feature flags foundation                    (commits 9aa425b, 6e2dfc7)
✅ T1     Org realignment                             (cb0ab20, 906e986)
✅ T2     Tasks RLS hardening + action gates          (fff4bff, a4f3b28; fix in 0022b)
✅ T3     Task workflow PDF gaps                      (3dff9b1, d675bc5, 3ec821d)
✅ T4     Categories engine                            (e17394e)
✅ T5     Decisions + SLA + Escalation engine         (96114b7)
✅ T6     Governance enforcement                      (3047e37)
✅ T7     Renewal cycles                              (006a9cf)
✅ T7.5   Commercial layer                            (a1bc76b + 3047e37)
✅ Op-UX  Operator-experience pass (off-plan)        (a718654 + b678073)

⬜ T3.5   Head-of-department task filters             see docs/phase-T3.5-filters.md
⬜ T9     Reporting + KPIs                            unblocked, ready to dispatch
⬜ T10    Cutover from Odoo                           blocked on T9 + edge-fn deploy
```

**Cross-cutting work outside the T-phases:**

```
⬜ Edge-fn deploy + cron        4 functions written, 0 deployed (highest urgency)
⬜ Acc-Sheet importer finish    1 of 7 tabs wired (Clients Contracts only)
⬜ Notification delivery        in-app only; no email / WhatsApp transport
⬜ Playwright runner            specs committed-as-contract; runner not wired
🟡 Owner decisions open         see §4
```

**Migrations applied to remote DB** (`vghokairfpzxcciwpokp`): up through `0028`. Verify with `mcp__supabase__list_migrations` if you doubt it. Files in `supabase/migrations/` are the source of truth — every applied migration has a matching file.

**Build/tests last-green:** `bun run build` clean (35 routes); 11/11 `tests/*.test.mjs` files passing.

---

## 2. Hard rules — these have cost real time when violated

### 2.1 Supabase MCP

- Use `mcp__supabase__*` for inspection (`list_tables`, `list_migrations`, `execute_sql`).
- The orchestrator (this file's caller) applies migrations via `mcp__supabase__apply_migration`. **You should not call `apply_migration` from inside an engineering agent** — write the SQL to `supabase/migrations/NNNN_name.sql` and let the orchestrator apply it.
- **Never** use `mcp__supabase-bookitfly__*`. Different project. Listed only because the harness ships both — ignore.

### 2.2 RLS — the FOR-ALL trap

> **Never declare a permissive RLS policy `FOR ALL` if its `USING` or `WITH CHECK` references another RLS-protected table.**

Postgres OR's permissive policies of the same command. A `FOR ALL` policy applies to SELECT too, OR'd with the table's `*_select` policy. Two failure modes we've seen:

1. **Visibility leak** (T2): `tasks_write FOR ALL USING (has_org_access(...))` re-opened SELECT. Fix: `0022b`.
2. **Infinite recursion** (T3): `task_followers_write FOR ALL USING (EXISTS SELECT FROM tasks ...)` cycled with `tasks_select`. Fix: `0023b`.

**Always split into separate `INSERT` / `UPDATE` / `DELETE` policies** when the predicate joins another protected table. Canonical examples: `0022b_split_write_policies.sql`, `0023b_followers_split_write.sql`, `0026_renewals.sql`, `0026b_commercial_layer.sql`, `0028_contracts_am_scoping.sql`.

### 2.3 STORED generated columns must be IMMUTABLE

> **A bare `timestamptz::date` cast is NOT immutable** — it depends on session `TimeZone`. Postgres rejects it for `generated always as (...) stored`.

Anchor with `(col at time zone 'UTC')::date`. See `0023_task_pdf_gaps.sql` line 65.

### 2.4 `has_permission` overloads

There are two: `has_permission(target_org uuid, perm_key text)` and `has_permission(perm_key text)`.

- **Use the 1-arg overload** for global-scope policies (no per-org filter inside the policy expression).
- Use the 2-arg overload when you're already filtering by org and want the explicit scope.

### 2.5 Branch hygiene

- Work directly on `main`. No feature branches, no PRs.
- Commit once per phase with the message specified in the dispatch.
- **Never push** unless the user explicitly asks. The user pushes.
- If you find changes you didn't make in your working tree, do **not** clean or stash them — another agent may have left them. Stop and ask.

### 2.6 Single-tenant facts

- **This project will only ever serve Sky Light.** Multi-tenant is NOT a future requirement (owner confirmed 2026-05-04). The `organization_id` columns can stay (rip-out is more risk than reward), but don't add new multi-tenant ceremony.
- **Org slug:** `rawasm-demo` · **Org id (seed only):** `11111111-1111-1111-1111-111111111111`
- **Owner test account:** `alsultain@agency.com` / `alsultain22` / role `owner`
- **Roles:** `owner`, `admin`, `manager` (= head), `account_manager`, `team_lead`, `specialist`, `agent`.
- **Sky Light hierarchy (PDF-derived):** 5 tiers. Owner / Admin → Department Head → Team Lead → Specialist → Agent. Account Manager is parallel to Head, not in the execution chain.
- **Working hours (SLA-relevant):** Sun–Thu, 09:00–17:00 Asia/Riyadh. Encoded in `business_hours` table by 0025.

### 2.7 Other invariants

- Arabic-only UI, RTL, mobile-responsive at 375px.
- Every mutation: zod validate → check user → check org scope → write `audit_log` if material → write `ai_event` if business-relevant.
- Never run `bun run build` inside an engineering agent. The orchestrator runs it after migrations apply.
- Never regenerate `src/lib/supabase/types.ts`. The orchestrator does it once after the migrations land.
- Never commit secrets. `.env.local` is real, `.env.example` is the template.

---

## 3. Repo orientation

```
docs/
  CLAUDE.md                       agency context (also at /CLAUDE.md root)
  ENGINEER_ONBOARDING.md          read me first
  ENGINEERING_PLAN.md             phase specs (T0–T10) — your bible for what to build
  AGENT_DISPATCH.md               per-phase prompt + file ownership
  SPEC_FROM_OWNER.md              owner's verbatim spec
  SPEC_FROM_PDF.md                PDF-derived workflow rules
  DECISIONS_LOG.md                owner-confirmed decisions
  MASTER_PLAN.md                  product-level plan above ENGINEERING_PLAN
  HANDOFF.md                      ← this file
  phase-T{N}-report.md            what each phase shipped
  phase-operator-ux-report.md     off-plan UX pass (2026-05-04)
  phase-T3.5-filters.md           queued owner feedback
  phase-T7-5-followups.md         what the original T7.5 commit deferred (now done)
  phase-T7-5-questions.md         open owner-decision callouts

src/
  app/(dashboard)/                routed pages
    tasks/                        T2/T3 own _actions.ts; default filter = "مهامي"
    projects/                     T7 owns [id]/renewals/; T4 owns new/
    service-categories/           T4
    escalations/                  T5
    governance/                   T6
    contracts/                    T7.5 (master + [id] detail)
    am/[id]/dashboard/            T7.5 (per-AM monthly view)
    organization/roles/           working role-permission editor (Op-UX pass)
  lib/
    supabase/types.ts             GENERATED — never edit by hand
    auth-server.ts                getServerSession, requirePermission, landingPathFor
    nav.ts                        sidebar items + PAGE_TITLES
    data/                         server-side data loaders
    schemas.ts                    zod schemas
    copy.ts                       Arabic strings
  components/
    command-palette.tsx           Cmd-K + QuickCreateTrigger (Op-UX pass)
    layout/                       sidebar + topbar

supabase/
  migrations/                     0001 … 0028 — applied via Mgmt API
  functions/                      4 edge functions written, NONE deployed:
                                    sla-watcher, renewal-scheduler,
                                    governance-watcher, monthly-cycle-roller

tests/
  *.test.mjs                      pure-Bun, 11 files passing
  playwright/*.spec.ts            committed as contracts; runner not wired
```

---

## 4. Open owner decisions

These are blocking nothing right now (everything is implemented with a sane default), but each needs a "yes/change-it" from the owner before T10 cutover.

| Q | Topic | Default we shipped | Source |
|---|---|---|---|
| Q1 | Per-AM RLS scoping | Option B: `contracts.account_manager_id` is the authority. Heads/CEO/admin keep org-wide via `target.view_all` or `contract.manage`. | `docs/phase-T7-5-questions.md` |
| Q2 | Importer column mapping for the other 6 Acc-Sheet tabs | Not done; intentional `TODO(T7.5-followup-#2)` | `docs/phase-T7-5-followups.md` §2 |
| Q3 | `/am/[id]/dashboard` placement | No top-level nav entry; reachable via "لوحتي" routing for AMs | `docs/phase-T7-5-questions.md` |

---

## 5. Lessons from the road (don't relearn)

1. **Agent scope creep** — T4-v1 drifted into `theme-provider`, `sidebar`, `topbar`, `globals.css`. Cost a 24h dispatch + a stash. **Stay inside your file-ownership block.** When in doubt, write a question to `docs/phase-T{N}-questions.md` and stop.
2. **`git commit` without an explicit pathspec sweeps the whole index.** If your goal is to commit one file, use `git add <path> && git commit` *while no other files are staged*. Run `git status --short` first.
3. **Concurrent dashboard edits** — when 3 agents all add a tile to `dashboard/page.tsx`, they'll interleave. Insert your tile additively in the existing grid; do NOT rewrite the layout. Rewrites are the orchestrator's job (Op-UX pass did one).
4. **Time-box partial commits.** T7.5 was 8–10 days nominal; we shipped a usable schema + one UI surface in 90 min as `feat(T7.5-partial)` and documented the rest in `docs/phase-T7-5-followups.md`. Better than spinning.
5. **`preview_click` doesn't reliably trigger React `onClick` handlers.** Synthetic mouse events from the test tool sometimes fail to dispatch through React's event system. Verify behavior via direct DOM `.click()` (`preview_eval`) when the click test fails — the implementation may be correct.
6. **HMR (Turbopack) accumulates duplicate listeners.** Custom-event APIs (`window.dispatchEvent` + `window.addEventListener`) survive HMR cleanly; synthesized `KeyboardEvent` dispatches do not. Prefer custom events for cross-component open/close coordination.
7. **Reading generated Supabase types from MCP exceeds context.** When `mcp__supabase__generate_typescript_types` returns "Output saved to file", extract via `jq -r '.[0].text | fromjson | .types' <file> > src/lib/supabase/types.ts` — single shell line, no interleaved reads.

---

## 6. The shortest path to "primary system"

The goal is "Sky Light operates from the dashboard, not Odoo." In order:

| # | Phase | Effort | Why |
|---|---|---|---|
| 1 | **Deploy 4 edge functions + cron** | ½ day | The system is reactive only when these run. SLA breaches don't escalate, renewals don't notify, governance violations aren't detected, monthly cycles don't roll. **Highest urgency.** |
| 2 | **T9 — Reporting + KPIs** | 5 days | CEO Monday view + weekly digest. Unblocks T10. |
| 3 | **T3.5 — Head per-employee filters** | 3 days | The 5 owner-asked filters; heads have their daily-driver. |
| 4 | **Acc-Sheet importer finish** | 2 days | Other 6 tabs (`Installments`, `Cycles`, `Events log`, etc). Without these the historical commercial data can't migrate. |
| 5 | **T10 — Cutover from Odoo** | 5–8 days | Importer for `project.task` (1,918) + `mail.message` (78k filtered) + `ir.attachment` (6,341). Parallel-run → freeze → import → 2 weeks dashboard-only. |

**Total: ~16 days of focused work to cutover**, assuming no schema surprises.

After cutover (parking lot, do not start before): **T8 WhatsApp**, **S1–S5 Sales Track**.

---

## 7. Wave 5 — what to dispatch next

### Wave 5a — Deploy edge functions + cron (no engineering agent needed)

Orchestrator does this directly. The 4 functions live at:

```
supabase/functions/sla-watcher/index.ts             (T5)
supabase/functions/renewal-scheduler/index.ts       (T7)
supabase/functions/governance-watcher/index.ts      (T6)
supabase/functions/monthly-cycle-roller/index.ts    (T7.5-finish)
```

Steps:
1. `mcp__supabase__deploy_edge_function` for each.
2. Set the Vercel cron schedule (or Supabase scheduled-trigger, if migrating off Vercel) per the comment header in each file's source. All four are daily 06:00 Asia/Riyadh except `monthly-cycle-roller` (1st of month 06:00 Asia/Riyadh).
3. Smoke each: invoke once via dashboard's manual trigger or curl with service-role key. Verify expected rows appear in `escalations` / `notifications` / `governance_violations` / `monthly_cycles`.
4. Add a section to `docs/phase-edge-deploy-report.md` documenting what was deployed and any cron config.

### Wave 5b — T9 (Reporting + KPIs)

Spec: `docs/AGENT_DISPATCH.md` — search `## T9 — Reporting + KPIs`. Highlights:

- Migration `0029_reporting_views.sql` — 4 Postgres views: `v_rework_per_task`, `v_on_time_delivery`, `v_agent_productivity`, `v_review_backlog`.
- Server actions: `getCEOWeeklyDigest()` JSON composition.
- Edge function `weekly-digest` (cron Sunday 07:00 Asia/Riyadh) — sends email + WhatsApp template.
- UI: 4 new dashboard KPI tiles (additively on the new hero grid); `/reports` promoted from placeholder to:
  - Per-department SLA compliance
  - Rework heat-map by service
  - Agent leaderboard with utilization %
  - Renewal forecast next 90 days
- Tests: view correctness vs hand-computed sample, digest HTML+RTL render.
- **Notification delivery layer is a prerequisite** — currently in-app only. Either build a minimal email side (Resend / Postmark) inside this phase, or wire the digest as in-app notification only and defer email to T8.

File ownership for the dispatched agent:
- NEW: `supabase/migrations/0029_reporting_views.sql`
- NEW: `supabase/functions/weekly-digest/index.ts`
- NEW: `src/app/(dashboard)/reports/_actions.ts` (if needed)
- NEW: `src/lib/data/reports.ts`
- EDIT: `src/app/(dashboard)/reports/page.tsx` (promote from placeholder)
- EDIT: `src/app/(dashboard)/dashboard/page.tsx` (additively add 4 KPI tiles to the hero grid — DO NOT rewrite the layout, the Op-UX pass redesigned it)
- NEW: `tests/reporting-views.test.mjs`
- NEW: `docs/phase-T9-report.md`

MUST NOT TOUCH: T6/T7/T7.5 modules, types.ts, theming.

### Wave 5c — T3.5 (Head per-employee filters)

Spec: `docs/phase-T3.5-filters.md`. 5 filters; recommended sequence: ship #1 + #2 + #3a (no schema) first, defer #4 + #5 to a later cycle.

File ownership:
- EDIT: `src/lib/data/tasks.ts` (extend `listTasks` filters)
- EDIT: `src/app/(dashboard)/tasks/page.tsx` (add per-employee chips visible only to heads)
- NEW: `src/lib/data/team.ts` if needed for "direct reports" lookup
- NEW: `tests/head-filters.test.mjs`
- NEW: `docs/phase-T3.5-report.md`

### Wave 5d — Acc-Sheet importer finish

Mapping in `docs/phase-T7-5-followups.md` §2 table. Implement remaining 6 tabs against fixtures under `tests/fixtures/acc-sheet/`. Idempotent inserts; round-trip test.

### Wave 5e — T10 (Cutover from Odoo)

Spec: `docs/AGENT_DISPATCH.md` — `## T10 — Cutover from Odoo`. **Do not start until 5a–5d are green and notification delivery works.**

### Dispatch shape (template for any wave-5 sub-phase)

Standard preamble for the engineering agent prompt:

```
You are implementing **<phase>** for the Sky Light / Rwasem dashboard.

## Required reading (in order)
1. /Users/mahmoudmac/Documents/projects/mr-dashboard/CLAUDE.md
2. /Users/mahmoudmac/Documents/projects/mr-dashboard/docs/HANDOFF.md (especially §2 Hard rules)
3. /Users/mahmoudmac/Documents/projects/mr-dashboard/docs/AGENT_DISPATCH.md → search for the phase header
4. /Users/mahmoudmac/Documents/projects/mr-dashboard/docs/SPEC_FROM_OWNER.md
5. /Users/mahmoudmac/Documents/projects/mr-dashboard/docs/SPEC_FROM_PDF.md
6. Prior phase report(s) the new work depends on
7. Any *_followups.md or *_questions.md doc the new work touches

## Hard rules — copy from HANDOFF §2 verbatim
   - RLS FOR-ALL trap → split-write
   - STORED generated must be IMMUTABLE
   - 1-arg has_permission(text) in policies
   - Single-tenant: don't justify with "multi-tenant later"
   - DO NOT apply migrations (orchestrator does it)
   - DO NOT regen src/lib/supabase/types.ts (orchestrator does it)
   - DO NOT run bun run build
   - DO NOT touch outside file-ownership block; write a question and stop

## File ownership (NEW: …, EDIT: …, MUST NOT TOUCH: …)

## Time budget: 90 min. Partial-commit on blockers + write blocker file.

## Final step: do NOT commit. Leave files unstaged. Orchestrator handles git.
```

---

## 8. The user's standing instructions

- **Ship and ask, not ship and hope.** Surface every unclear decision via `docs/phase-T{N}-questions.md`.
- Owner gave verbatim Arabic feedback on head-of-department filters; preserved in `docs/phase-T3.5-filters.md`.
- Smoke the UI manually each wave (login, click, screenshot). Playwright suite committed-as-contract but not running yet.
- Single-tenant: never justify code with "for tenants later."
- The user pushes; you don't push unless explicitly asked.

---

## 9. Pre-flight before the next dispatch

1. ✅ `git status --short` → empty
2. ✅ `git log --oneline -3` → top is `b678073 feat(operator-ux): functional command palette + topbar quick-create + /contracts عقودي filter`
3. ✅ `mcp__supabase__list_migrations` → most recent is `0028_contracts_am_scoping`
4. ✅ Build was green at last orchestrator pass (35 routes); don't run from inside an agent — trust the last-green at top of this file
5. ✅ 11/11 `tests/*.test.mjs` files passing

If any of these fail, **stop and read backwards** from the most recent commit. Don't paper over.

Good luck. Stay in scope. Ask early.
