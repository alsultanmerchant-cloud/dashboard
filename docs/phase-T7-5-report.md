# Phase T7.5 — Commercial Layer (PARTIAL)

**Status:** schema + 1 of 4 UI surfaces shipped. Time-boxed per dispatch.
**Commit:** `feat(T7.5-partial): commercial layer (schema + 1 of 4 surfaces)`

## What landed

| Area | File | Notes |
|---|---|---|
| Schema | `supabase/migrations/0026b_commercial_layer.sql` | 8 tables, RLS split per-verb on every contract-joining child, perm seeds, contract_types seed, feature flag. |
| Importer scaffold | `scripts/import-acc-sheet.ts` | Validates 7 tabs, writes `tmp/acc-sheet-diff.csv`. `--commit` deliberately TODO. |
| Data layer | `src/lib/data/contracts.ts` | `listContracts` (filterable), `listContractTypes`, `listPackages`, `getContractsSummary`. |
| UI #1 | `src/app/(dashboard)/contracts/page.tsx` | Master list — summary metric cards + status/target chip filters via search params. Empty + RTL + responsive. |
| Nav | `src/lib/nav.ts` | New "تجاري" group, gated by `contract.view`. PAGE_TITLES entry added. |
| Follow-ups | `docs/phase-T7-5-followups.md` | Detailed continuation spec for the next agent. |

## What was deferred (handed off)

Per the dispatch's explicit time-box authorization, the following are spec'd
in `docs/phase-T7-5-followups.md` rather than implemented here:

1. Importer `--commit` mapping (per-tab spec laid out as a table).
2. `/contracts/[id]` detail surface.
3. `/am/[id]/dashboard` per-AM surface.
4. CEO tile group on `/dashboard`.
5. Server actions in `_actions.ts`.
6. Edge function `monthly-cycle-roller`.
7. Tests (importer round-trip + Playwright e2e).
8. Per-AM RLS scoping decision (Option A vs B documented).

## Wave-2 lessons applied

- No `FOR ALL` write policies. Every child policy whose USING/WITH-CHECK
  joins `public.contracts` is split into separate INSERT/UPDATE/DELETE.
- No stored generated columns. `total_days_computed` is a plain int — the
  importer + server actions are responsible for keeping it in sync.

## Migration not applied

Per dispatch hard rule: I did NOT call `mcp__supabase__apply_migration`.
The orchestrator applies `0026b_commercial_layer.sql` later.

## Acceptance check (preview)

- `/contracts` will render its empty state until the importer runs.
- Permissions seeded correctly: I confirmed `permissions.key` is the schema
  via MCP query before authoring the migration.
- Nav item is gated by `contract.view` — owner/admin/manager/account_manager
  roles get the new perm.

---

## Wave 4 finish — what landed

**Commit (after orchestrator):** `feat(T7.5-finish): commercial layer (detail
+ AM dashboard + CEO tiles + edge function + actions)`

| Area | File | Notes |
|---|---|---|
| RLS scoping | `supabase/migrations/0028_contracts_am_scoping.sql` | Owner-confirmed Option B. Tightens SELECT for contracts/installments/monthly_cycles/contract_events to per-AM. No FOR ALL. 1-arg `has_permission`. Writes untouched. |
| Edge fn | `supabase/functions/monthly-cycle-roller/index.ts` | Cron 1st of month 06:00 Asia/Riyadh (UTC `0 3 1 * *`). For each active contract: insert next monthly_cycles row + notify AM. Mirrors `sla-watcher`. |
| Data layer | `src/lib/data/contracts.ts` | Added `getContractById`, `getContractInstallments`, `getContractCycles`, `getContractEvents`, `getAmDashboard`, `getCeoCommercialTiles`. |
| Server actions | `src/app/(dashboard)/contracts/_actions.ts` | `recordContractEventAction`, `recordInstallmentReceivedAction` (auto-recomputes `contracts.paid_value`), `recordMonthlyMeetingAction`, `addCycleAction`. Each: zod → `requirePermission('contract.manage')` → org-scope → `audit_log` + `ai_event`. |
| UI #2 (detail) | `src/app/(dashboard)/contracts/[id]/page.tsx` + `installment-receive-form.tsx` + `event-record-form.tsx` | Header card, 4 metric tiles, installments timeline w/ inline receive form, monthly cycles table, events feed w/ inline record form. RTL + responsive. |
| UI #3 (per-AM) | `src/app/(dashboard)/am/[id]/dashboard/page.tsx` | Target/achieved/% + month contracts grouped by type + overdue installments table + this-week meetings table. |
| UI #4 (CEO tile group) | `src/app/(dashboard)/dashboard/page.tsx` (additive edit only) | Added one new section "تجاري — هذا الشهر" with 5 type tiles + total. Imports `getCeoCommercialTiles`. Did NOT rewrite layout. |
| Importer | `scripts/import-acc-sheet.ts` | `--commit` wired for `Clients Contracts` tab only (idempotent on `(org, client_id, start_date)`, creates clients + packages on-miss, looks up AM via `tmp/am-name-map.csv`). Other 6 tabs marked `TODO(T7.5-followup-#2)`. |
| Tests | `tests/contracts.test.mjs` | 15/15 passing — verifies migration shape, action signatures, data loader exports, edge function presence. |
| Questions | `docs/phase-T7-5-questions.md` | Surfaces Option B decision + importer scope + nav-entry deferral for owner. |

## Followups #1–#9 status (after this finish)

1. ✅ Per-AM RLS scoping — Option B in `0028`.
2. 🟡 Importer `--commit` — `Clients Contracts` shipped, 6 tabs TODO.
3. ✅ Surface #2 (`/contracts/[id]`).
4. ✅ Surface #3 (`/am/[id]/dashboard`).
5. ✅ Surface #4 (CEO tile group).
6. ✅ Server actions.
7. ✅ Edge function `monthly-cycle-roller` (file shipped, deployment is
   orchestrator's job — not invoked from agent per HANDOFF rules).
8. 🟡 Tests — pure-Bun smoke shipped (`tests/contracts.test.mjs`).
   Importer round-trip + Playwright deferred (requires live xlsx/browser).
9. ✅ Phase report (this section).

## Hard-rules compliance

- No `FOR ALL` policies introduced. All 0028 policies are SELECT-only and
  drop-then-recreate the existing names.
- Migration NOT applied — orchestrator handles `apply_migration`.
- `src/lib/supabase/types.ts` NOT touched.
- `bun run build` NOT invoked.
- T6 files (`governance/`, `0027_governance.sql`, `governance-watcher`,
  `lib/data/governance.ts`) NOT touched.
- T7 files (`renewals.ts`, `projects/[id]/renewals/`) NOT touched.
- Existing T7.5 files (`/contracts/page.tsx`, nav.ts) NOT rewritten —
  only `/contracts/page.tsx` is unchanged; `nav.ts` was intentionally NOT
  edited (no good single-tenant slot for `/am/[id]/dashboard`; rationale in
  questions doc).
- Dashboard tile group inserted as ONE additive section (Card, not a tile
  in the existing metric grid) — preserves co-existing T5/T6/T7 edits.

