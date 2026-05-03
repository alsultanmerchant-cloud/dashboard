# Handoff — Sky Light dashboard, mid-execution

**As of commit `59fa3ca` on `main` · 18 commits ahead of `origin/main` · not pushed**

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
✅ T7     Renewal cycles                              (006a9cf)
🟡 T7.5   Commercial layer — partial                  (a1bc76b)  see §6
⬜ T3.5   Head-of-department task filters             see docs/phase-T3.5-filters.md
⬜ T6     Governance enforcement                      see docs/AGENT_DISPATCH.md T6
⬜ T9     Reporting + KPIs                            blocked on T6 + T7.5-finish
⬜ T10    Cutover from Odoo                           blocked on everything above
```

**Migrations applied to remote DB** (`vghokairfpzxcciwpokp`): up through 0026b. Verify with `mcp__supabase__list_tables` if you doubt it. Files in `supabase/migrations/` are the source of truth — every applied migration has a matching file.

**Build/tests last-green:** `bun run build` clean (33 routes); 9/9 `tests/*.test.mjs` files passing.

---

## 2. Hard rules — these cost real time when violated

### 2.1 Supabase MCP

- Use `mcp__supabase__*` for inspection (`list_tables`, `list_migrations`, `execute_sql`).
- The orchestrator (this file's caller) applies migrations via `mcp__supabase__apply_migration`. **You should not call `apply_migration` from inside an engineering agent** — write the SQL to `supabase/migrations/NNNN_name.sql` and let the orchestrator apply it.
- **Never** use `mcp__supabase-bookitfly__*`. Different project. Listed only because the harness ships both — ignore.

### 2.2 RLS — the FOR-ALL trap (cost us two extra migrations in Wave 2/3)

> **Never declare a permissive RLS policy `FOR ALL` if its `USING` or `WITH CHECK` references another RLS-protected table.**

Postgres OR's permissive policies of the same command. A `FOR ALL` policy applies to SELECT too, OR'd with the table's `*_select` policy. Two failure modes we've seen:

1. **Visibility leak** (T2): `tasks_write FOR ALL USING (has_org_access(...))` re-opened SELECT to every org member, defeating the tightened `tasks_select`. Fix: migration `0022b`.
2. **Infinite recursion** (T3): `task_followers_write FOR ALL USING (EXISTS SELECT FROM tasks ...)` cycled with `tasks_select`'s follower branch. Fix: migration `0023b`.

**Always split into separate `INSERT` / `UPDATE` / `DELETE` policies** when the predicate joins another protected table. See `0022b_split_write_policies.sql`, `0023b_followers_split_write.sql`, `0026_renewals.sql`, `0026b_commercial_layer.sql` for the canonical pattern.

### 2.3 STORED generated columns must be IMMUTABLE

> **A bare `timestamptz::date` cast is NOT immutable** — it depends on session `TimeZone`. Postgres rejects it for `generated always as (...) stored`.

Anchor with `(col at time zone 'UTC')::date`. Literal timezone constants are immutable. See `0023_task_pdf_gaps.sql` line 65 for the canonical fix.

### 2.4 `has_permission` overloads

There are two: `has_permission(target_org uuid, perm_key text)` and `has_permission(perm_key text)`.

- **Use the 1-arg overload** for global-scope policies (no per-org filter inside the policy expression).
- Use the 2-arg overload when you're already filtering by org and want the explicit scope.

T1's `0021_org_realignment` originally used the wrong one and had to be patched in `906e986`. Don't repeat.

### 2.5 Branch hygiene

- Work directly on `main`. No feature branches, no PRs.
- Commit once per phase with the message specified in the dispatch.
- **Never push** unless the user explicitly asks. The user pushes.
- If you find changes you didn't make in your working tree, do **not** clean or stash them — another agent or a previous session may have left them. Stop and ask.

### 2.6 Other invariants

- Arabic-only UI, RTL, mobile-responsive at 375px.
- Every mutation: zod validate → check user → check org scope → write `audit_log` if material → write `ai_event` if business-relevant.
- Never run `bun run build` inside an engineering agent. The orchestrator runs it after migrations apply.
- Never regenerate `src/lib/supabase/types.ts`. The orchestrator does it once after the migrations land.
- Never commit secrets. `.env.local` is real, `.env.example` is the template.

---

## 3. Repo orientation (just the parts you'll touch)

```
docs/
  CLAUDE.md                       agency context (also at /CLAUDE.md root)
  ENGINEER_ONBOARDING.md          read me first
  ENGINEERING_PLAN.md             phase specs (T0–T10) — your bible for what to build
  AGENT_DISPATCH.md               per-phase prompt + file ownership
  SPEC_FROM_OWNER.md              owner's verbatim spec (Arabic + English)
  SPEC_FROM_PDF.md                PDF-derived workflow rules — §13 = T3's checklist
  DECISIONS_LOG.md                owner-confirmed decisions
  MASTER_PLAN.md                  product-level plan above ENGINEERING_PLAN
  HANDOFF.md                      ← this file
  phase-T{N}-report.md            what each phase shipped
  phase-T3.5-filters.md           queued owner feedback (head-of-dept filters)
  phase-T7-5-followups.md         what's left of T7.5 — read before starting Wave 4

src/
  app/(dashboard)/                routed pages
    tasks/                        T2/T3 own _actions.ts; T3 owns [id]
    projects/                     T7 owns [id]/renewals/; T4 owns new/
    service-categories/           T4
    escalations/                  T5
    contracts/                    T7.5
    am/[id]/dashboard/            T7.5 (not yet built)
  lib/
    supabase/types.ts             GENERATED — never edit by hand
    nav.ts                        sidebar items + PAGE_TITLES
    projects/                     T4's category/offset engine — READ-ONLY for downstream phases
    data/                         server-side data loaders
    schemas.ts                    zod schemas
    copy.ts                       Arabic strings

supabase/
  migrations/                     0001 … 0026b — applied via Mgmt API, not Supabase CLI
  functions/                      Edge functions (sla-watcher, renewal-scheduler)
                                  — NOT YET DEPLOYED; spec'd in code, run by hand for now

tests/
  *.test.mjs                      pure-Bun, runnable; gold standard for new tests
  playwright/*.spec.ts            committed as contracts; runner not wired (T0 carry-over waiver)
  feature-flags.test.mjs          style template for new MJS tests
```

---

## 4. The single-tenant facts that bite

- **Org slug:** `rawasm-demo`
- **Org id (hardcoded in seed migrations only):** `11111111-1111-1111-1111-111111111111`
- **Owner test account:** `alsultain@agency.com` / `alsultain22` / role `owner`
- **Roles seeded:** `owner`, `admin`, `manager` (= head), `account_manager`, `team_lead`, `specialist`, `agent`. Schema keeps `organization_id` everywhere for multi-tenant later.
- **Sky Light hierarchy (PDF-derived):** 5 tiers. Owner / Admin → Department Head → Team Lead → Specialist → Agent. Account Manager is a parallel role under Head, not in the execution chain.
- **Working hours (SLA-relevant):** Sun–Thu, 09:00–17:00 Asia/Riyadh. Fri/Sat closed. Encoded in `business_hours` table by 0025.

---

## 5. Lessons from the road so far (don't relearn)

1. **Agent scope creep** — T4-v1 drifted into `theme-provider`, `sidebar`, `topbar`, `globals.css`. Cost a 24h dispatch + a stash. **Stay inside your file-ownership block.** When in doubt, write a question to `docs/phase-T{N}-questions.md` and stop.
2. **`git commit` without an explicit pathspec sweeps the whole index.** If your goal is to commit one file, use `git add <path> && git commit` *while no other files are staged*. Run `git status --short` first.
3. **Concurrent dashboard edits** — when 3 agents all add a tile to `dashboard/page.tsx`, they'll interleave. Insert your tile additively in the existing grid; do NOT rewrite the layout. We've gotten away with it twice; don't push the luck.
4. **Time-box partial commits.** T7.5 was 8–10 days of work; we shipped a usable schema + one UI surface in 90 min as `feat(T7.5-partial)` and documented the rest in `docs/phase-T7-5-followups.md`. Better than nothing, much better than spinning.
5. **The Acc Sheet importer** can't verify column headers from inside a sandbox that blocks `bun -e`/`python3 -c`. The next T7.5 agent must run the dry-run on a real machine first to confirm header names before wiring `--commit`.

---

## 6. T7.5 partial state — what's pending

Read `docs/phase-T7-5-followups.md` for full detail. Quick summary:

- ✅ Schema (8 tables, RLS split-write, perms seeded, `commercial_layer` feature flag)
- ✅ `/contracts` master list (with filters, summary metrics)
- ✅ Importer scaffold (`scripts/import-acc-sheet.ts`) — dry-run only; `--commit` branch is `TODO` and intentional
- ✅ Nav entry under "تجاري"
- ⬜ `/contracts/[id]` detail (installments timeline, cycles list, events log)
- ⬜ `/am/[id]/dashboard` per-AM page
- ⬜ `/dashboard` CEO tile group
- ⬜ Server actions (`recordContractEvent`, `recordInstallmentReceived`, `recordMonthlyMeeting`, `addCycle`)
- ⬜ Edge function `monthly-cycle-roller`
- ⬜ Importer `--commit` branch + per-tab column mapping verification
- ⬜ Tests (`tests/import-acc-sheet.test.mjs`, Playwright)
- ⬜ Per-AM RLS scoping decision — Option A or B documented in followups

**Open RLS question:** `contracts_select` currently grants on `contract.view`. The followups doc proposes either (A) restrict to AM-owned contracts via `account_manager_id = (select id from employee_profiles where user_id = auth.uid())`, or (B) keep org-wide read for heads/CEO/admin and add a separate "my contracts" filter at the data layer. The owner hasn't picked. **Don't unilaterally decide — ask via `docs/phase-T7-5-questions.md`.**

---

## 7. Wave 4 — what to dispatch next

Two phases unblocked, no file conflicts:

### T6 — Governance Enforcement (4 days nominal)

Spec: `docs/AGENT_DISPATCH.md` — search "## T6 — Governance Enforcement". Highlights:
- Migration `0027_governance.sql` — `governance_violations` table.
- Server-action change: `transitionStage` rejects without a fresh comment in last 5 min ("يجب إضافة ملاحظة قبل نقل المرحلة").
- Edge function `governance-watcher` (daily 06:00 Asia/Riyadh) — finds stale tasks + unowned tasks, inserts violations.
- `/governance` admin/head page; dashboard tile.
- Permissions: `governance.view` (head + admin), `governance.resolve` (admin).
- **WILL touch `tasks/_actions.ts`** — coordinate or sequence carefully if running concurrent with anything else that touches that file.

### T7.5-finish — finish the commercial layer

Spec: `docs/phase-T7-5-followups.md`. The owner-decision callout above is the gating question. Surface it before the agent starts coding.

### Don't dispatch yet

- **T9 (Reporting)** — depends on T6 + T7.5-finish. Wait.
- **T10 (Cutover)** — depends on everything. Wait.
- **T3.5 (Head filters)** — owner-driven, can ship anytime, but no rush. Spec at `docs/phase-T3.5-filters.md`. Note: forward-looking delay (#3) and recurring-without-deadline (#5) are real schema gaps the existing `delay_days` column does not solve.

### Dispatch shape

Look at the prompts in `docs/wave-2-redispatch.md` for the boilerplate format. Each agent prompt:
1. Standard preamble (read CLAUDE.md, ENGINEER_ONBOARDING, ENGINEERING_PLAN, SPEC_FROM_OWNER, SPEC_FROM_PDF, DECISIONS_LOG, AGENT_DISPATCH, prior phase reports, this file).
2. Hard-rules block (the §2 stuff above).
3. Lessons from waves 2/3 explicitly called out (FOR-ALL trap, immutable generated columns).
4. Explicit file ownership + MUST NOT TOUCH list.
5. Time budget (60–90 min, partial-commit on blockers).
6. Final commit message.

---

## 8. Cleanup before Wave 4

- `git stash list` — there's a `T4 v1 abandoned attempt` stash from a prior cycle. Drop it: `git stash drop stash@{0}`.
- `.claude/worktrees/` — untracked dir leaked from a sandbox isolation. Safe to delete or leave alone.
- 18 commits unpushed. Push first if the user wants the work off the laptop before more agents fire.

---

## 9. The user's standing instructions

- Owner gave verbatim Arabic feedback on head-of-department filters; captured in `docs/phase-T3.5-filters.md`. Don't lose it.
- Owner expects you to ship and ask, not ship and hope. Surface every unclear decision via `docs/phase-T{N}-questions.md`.
- Smoke the UI manually each wave (login, click, screenshot). The Playwright suite is committed-as-contract but not running yet.

---

## 10. Pre-flight before the next dispatch

1. ✅ `git status --short` — empty (modulo `.claude/worktrees/`)
2. ✅ `git log --oneline -3` shows `59fa3ca chore: regen Supabase types after Wave 3 migrations` on top
3. ✅ `mcp__supabase__list_tables` returns `decision_rights`, `escalation_paths`, `sla_rules`, `business_hours`, `exceptions`, `escalations`, `renewal_cycles`, `service_categories`, `task_followers`, `contracts`, `installments`, `monthly_cycles`, `am_targets`, `contract_events`, etc.
4. ✅ `bun run build` was green at last orchestrator pass (don't actually run it from inside an agent — trust the last-green at the top of this file)
5. ✅ `bun tests/<latest>.test.mjs` green for the phase you're picking up

If any of these fail, **stop and read backwards** from the most recent commit. Don't paper over.

Good luck. Stay in scope. Ask early.
