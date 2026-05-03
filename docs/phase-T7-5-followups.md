# Phase T7.5 — Follow-ups (partial commit)

This phase shipped a **partial slice** of the Commercial Layer:

- `supabase/migrations/0026b_commercial_layer.sql` — full schema (8 tables, RLS, perms, seeds).
- `src/lib/nav.ts` — new "تجاري" nav group + `/contracts` entry gated by `contract.view`.
- `src/app/(dashboard)/contracts/page.tsx` — surface #1 (master list with summary cards + status/target filters via search params).
- `src/lib/data/contracts.ts` — `listContracts`, `listContractTypes`, `listPackages`, `getContractsSummary`.
- `scripts/import-acc-sheet.ts` — DRY-RUN scaffold (validates 7 tabs exist, writes `tmp/acc-sheet-diff.csv`); `--commit` branch is intentionally TODO.
- Permission seeds applied to `owner / admin / manager / account_manager` (per-AM scoping is enforced at policy level via `target.view_all` for `am_targets`; per-AM contract scoping is left to a follow-up because it requires joining `clients.account_manager` which doesn't exist yet — see #1 below).

What is NOT yet built and the next dispatch must finish:

## 1. Per-AM contract RLS scoping

Current `contracts_select` policy gates on `contract.view` only. The dispatch
asks for "AM (own clients)" — but `clients` has no `account_manager_id`
column. We have `projects.account_manager_employee_id`. Decide:

  **Option A.** Add `clients.account_manager_employee_id` (small migration `0026c`)
  and tighten `contracts_select` to `(has_permission('contract.view') AND
  (has_permission('target.view_all') OR client.am = current employee))`.

  **Option B.** Treat `contracts.account_manager_id` as the authority and tighten
  the policy to `account_manager_id = current employee OR has_permission('target.view_all')`.

Option B is simpler — `contracts` already carries the AM. Recommended.

## 2. Importer — `--commit` mapping

The 7-tab → 8-table mapping the next agent must implement:

| Sheet tab | → table | Natural key | Notes |
|---|---|---|---|
| `Clients Contracts` | `contracts` (+ upsert `clients`) | `(client_id_in_sheet, start_date)` | Look up `account_manager_id` via `tmp/am-name-map.csv`; map Package text → `packages.key` (create-on-miss). Type col → `contract_types.key`. |
| `Installments Tracker` | `installments` | `(contract_id, sequence)` | Sheet has up to 5 instalment columns per row → unpivot. Status: if `actual_date` non-null → `received`; else if expected past today → `overdue`; else `pending`. |
| `Cycle_tracker` | `monthly_cycles` | `(contract_id, cycle_no)` | One row per (client, month). meeting_status: derive from `actual_meeting_date - expected_meeting_date` (>0 → late, missing → missed). |
| `Edits Updates log` | `contract_events` | none (insert-only) | Free-text → `event_type` slug (e.g. "package_change", "hold", "resume", "lost"). Actor lookup via AM map. |
| `CEO_Dashboard` | `services_catalog` (services list portion) | `(org, key)` | Already partially seeded. Idempotent upsert on `key`. |
| `TARGET_CONTRACTS` | `am_targets` (expected_total per month) | `(am, month)` | |
| `Acc_Target_Breakdown` | `am_targets` (achieved_total + breakdown_json) | `(am, month)` | Merge with TARGET_CONTRACTS row to compute `achievement_pct`. |

Write a per-tab fixture file (10 rows each) under `tests/fixtures/acc-sheet/` and use it for `tests/import-acc-sheet.test.mjs` round-trip assertion.

## 3. Surface #2 — `/contracts/[id]`

Detail page with 4 sections:
- Header: client, AM, package, type, total / paid / outstanding.
- Installments timeline (vertical list, status pills).
- Monthly cycles list (table sorted by month desc).
- Events log (chrono feed from `contract_events`, last 50).
- Linked project link (`projects` row joined via `contract.project_id`).

## 4. Surface #3 — `/am/[id]/dashboard`

Per-AM monthly view. Inputs: `am_targets` row for current month + aggregated `contracts` + `installments` + `monthly_cycles`. Show: target, achieved, achievement %, contracts breakdown by type, overdue installments list, cycles needing meeting this week.

## 5. Surface #4 — CEO tile group on `/dashboard`

Insert ONE new tile group (don't rewrite layout). Tiles: New / Renewed / Hold / UPSELL / Win-Back / Total monthly counts and revenue, sourced from `contracts` filtered by `contract_types.key` and `start_date` in current month.

## 6. Server actions

`src/app/(dashboard)/contracts/_actions.ts` — to implement:

- `recordContractEvent(contractId, eventType, payload)` — zod, perm check `contract.manage`, insert into `contract_events`, write `audit_log` + `ai_event` (`CONTRACT_EVENT_RECORDED`).
- `recordInstallmentReceived(installmentId, actualDate, actualAmount)` — same shape; also bump `contracts.paid_value`.
- `recordMonthlyMeeting(cycleId, actualDate, status, delayDays)` — update cycle row.
- `addCycle(contractId, monthlyData)` — insert next cycle.

## 7. Edge function `monthly-cycle-roller`

Cron 1st of month 06:00 Asia/Riyadh. For each `contracts.status='active'`:
- Compute next `cycle_no = max+1`, `month = date_trunc('month', now_riyadh)`.
- `expected_meeting_date = month_start + packages.grace_days` (default 7).
- Insert into `monthly_cycles`; create a `notifications` row for the AM.

Skeleton path: `supabase/functions/monthly-cycle-roller/index.ts`. Deploy via `mcp__supabase__deploy_edge_function`.

## 8. Tests

- `tests/import-acc-sheet.test.mjs` — round-trip 100 sample rows (use fixtures from #2). Zero data loss.
- `tests/playwright/contracts.spec.ts` — AM marks installment received → contract balance updates → CEO dashboard tile re-renders.

## 9. Phase report

Promote `docs/phase-T7-5-followups.md` (this file) + add `docs/phase-T7-5-report.md` once everything above lands.

---

## What this commit guarantees

- Migration is **idempotent** (`if not exists`, `on conflict do nothing`).
- All RLS policies are split per-verb where they join contracts (Wave-2 lesson).
- No `FOR ALL` write policies. No stored generated columns with non-IMMUTABLE expressions.
- `permissions.key` values match existing convention; bound to existing roles.
- Nav entry is gated; `contract.view` was seeded for `owner/admin/manager/account_manager`.
- The contracts page reads through `supabaseAdmin` like the other modules — RLS is server-side and policy-layer enforced separately. (When the page later reads through the user-scoped client, the policies above already cover it.)
