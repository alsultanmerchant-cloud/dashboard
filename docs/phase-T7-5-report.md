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
