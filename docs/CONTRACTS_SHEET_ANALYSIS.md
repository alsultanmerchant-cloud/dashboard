# Contracts Sheet — Reverse-Engineering & Dashboard Spec

Source: Google Sheet «نسخة شيت الحسابات-سكاي لايت» (6 tabs). Analyzed 2026-06: all data, all formulas, and the bound Apps Script (4 files, ~55KB).

---

## 1. How the system actually works

### The architecture (the most important insight)

```
Client's Contracts  = CURRENT STATE  (one row per contract; rows get OVERWRITTEN on renewal)
Edits / Updates log = HISTORY        (append-only, written by Apps Script on every event)
CEO_Dashboared      = AGGREGATION    (formulas UNION current state + log for a selected month)
💲Installments      = PAYMENT PLAN   (one row per installment contract, max 4 payments; upserted by script)
TARGET_CONTRACTS    = monthly target working lists (contract keys per bucket)
Acc_Target_Breakdown= per-account-manager target table
```

A contract's identity is the **Key = `ClientID|StartDate(yyyymmdd)`** (e.g. `C164|20260429`). This is how all cross-sheet joins work, and why monthly numbers survive even after a row is overwritten by a renewal — the log keeps the old Key.

### Client IDs (duplicates explained)

- IDs are auto-generated **incremental** (`C01…C182`) by Apps Script when a client *name* is typed in a row with empty ID. Counter lives in Document Properties + document lock (no race).
- **Duplicate IDs = same client, multiple contracts (services).** 14 clients have 2–3 rows (e.g. C164 has 3: سوشيال+حملات, انشاء متجر ووردبريس upsell, سيو on hold). The Key disambiguates.

### Contract Type (column F) — dropdown + script state machine

Values: `New, Renewal, #Renewal#, Hold, Edit, Upsell - Sales, Upsell - Acc, Win-Back, Lost`

The Apps Script (`handleContractEdit`, installed onEdit trigger) implements:

- **Field locking**: once Start Date / Actual Paid / Contract Value / Actual End are first entered, they are locked (script reverts edits + toast warning). Stored as `LOCKVAL_<sheet>_<row>_<col>` in Document Properties.
- **Hold / Edit = unlock modes**: switching type to `Hold` or `Edit` snapshots the row (type, package, duration, values, dates, renewed) into `HOLD_SNAP_*`, unlocks the row, and logs `ON HOLD` / `EDIT MODE ON` (note auto-appended: `Entered HOLD — Contract Type was: "New" — <timestamp>`).
- **Leaving Hold/Edit**: computes a **field-by-field diff vs the snapshot**, re-locks with current values, logs `HOLD LIFTED` / `EDIT MODE OFF` with `Changes:\n- field: old → new`. The pre-hold type is preserved in log flag columns (`NewBeforeHold`, `Upsell-salesBeforeHold`, `Upsell-AccBeforeHold`, `Win-BackBeforeHold`) so dashboard counts don't lose the real type while a contract sits in Hold.
- **Lost**: requires Actual End Date + Actual Paid (0 allowed) else reverts. Logs `Contract Close (Lost)`, unlocks row, sets `CLOSEKEY_<id>__<start>`.
- **Renewed? (col T)**: `Yes` requires Actual Paid > 0 and Actual End Date (validated, else revert + toast). Logs `Contract Close (Renew)` and marks the contract closed.
- **Row reuse for renewal**: editing Start Date on a *closed* row triggers `startNewContractReset_` — clears type/package/duration/values/notes/renewed, prefills Actual Paid with the renewal payment if renewed=Yes, unlocks. That's the renewal flow: same row, new Key.
- **There is NO hold-end-date popup today** (no `getUi()/prompt` anywhere) — the team's request is a new feature, not parity.

### Computed columns (Client's Contracts, ARRAYFORMULA in row 3)

| Col | Field | Logic |
|---|---|---|
| L | Total Days | m=12 → 365; type matches `RENEW\|WIN-BACK` → m×30; **else 37 + (m−1)×30** (new client gets +7 free days in month 1). Plus per-service **Extra Days** from `CEO_Dashboared!A:C` services table (one-time services like store build = +15/+30, added in full; monthly extras capped at 15 total). Plus Extension period (U). |
| M | Expected End Date | `D + L − 1` |
| N | Contract Status | `Closed` (renewed?=Closed or Actual End set) → `Expired` (today > M) → `SOON TO Be Renewed` (M − today ≤ 10) → `Active` |
| E | Target (today) | `Closed`; M < start of current month → `Overdue`; M within current month → `On Target`; else `Sales Deposit` |
| R | Delays | Working days from Expected End to Actual End (or today), **Fri+Sat weekend** (`NETWORKDAYS.INTL "0000110"`); if end lands on weekend, count from next working day; floor 0 |
| V | Target_ByMonth | Same buckets as E but for the **dashboard-selected** month window (`CEO_Dashboared!X1:Y1`, hidden cells driven by Month/Year dropdowns) |
| W | Key | `TRIM(A) & "\|" & TEXT(D,"yyyymmdd")` |

Services table (`CEO_Dashboared!A2:C`): service name, Price Type (`Monthly`/`One-Time`), Extra Days. Packages on a contract = comma-separated service list (this is why Package strings like `نوفا, انشاء متجر سلة/زد` matter — they're parsed by SPLIT).

### 💲Installments Tracker

- Created/updated by script when contract `payment status (K)` is set to `Installments`. Validates 6 required fields (ID, name, manager, type, start date, actual paid) else clears K and warns. **Upserts by Key** (updates existing row on renewal re-flag).
- Structure: full contract value (no tax) • payment 1 (date = contract start, amount = Actual Paid) • payments 2–4 each have: expected date, amount, **actual collection date** (presence of actual date = collected) • notes • **lost date** (client lost before completing payments → excluded from expectations) • Key.
- **Max 4 installments** (confirmed: fixed columns, team rule).
- Collection responsibility: **new client → Sales collects; renewal on installments → Account Manager collects** (team note; mirrored by dashboard's split below).

### CEO_Dashboared

- **Month/Year dropdowns** → hidden `X1/Y1` = month window. Everything below recomputes for that window.
- **Client Status Overview (today)**: New 60 / Ongoing-Renewed 17 / Hold 12 / Total 97; Upsell 7, Win-Back 1.
- **Contracts Movement (selected month)**: New / Renewed / Lost / Upsell / Win-Back / Closed-not-lost counts. Formula pattern: `UNIQUE` of Keys from Contracts **∪** Keys from the log (so renewals that overwrote rows still count).
- **Company INCOME (selected month)** = Account section total + Sales section total:
  - *Account Dept*: Expected from Installments (types Renewal/#Renewal#/Win-Back/Upsell-Acc: sum payments 2–4 whose expected date ∈ month and not collected before month start) + On Target clients (Next Contract Value) + Overdue clients. Actual Achieved mirrors with actual dates. Upsell-Acc, Win-Back, Revenue Achievement %, Revenue Gap.
  - *Sales section*: same for type New/Upsell-Sales (new-client installments) + actual income from new clients.
- Per-manager split lives in **Acc_Target_Breakdown** (Expected: installments / on-target / overdue; Achieved; %; team target). **TARGET_CONTRACTS** lists the actual contract Keys behind each bucket (movement, lost, installments, overdue, paid ✅).

### Row colors (current sheet UX)

Conditional formatting encodes state: dark red = closed/lost, white = active, yellow = Hold, green/blue chips for type. The team finds this noisy → they want a **status filter (default: Active)** instead of colored rows.

---

## 2. What the team asked for (meeting notes, consolidated)

1. Replace slow Sheets UX, keep the calculation/connection logic exactly.
2. Contract list: **default filter = Active**, no full-table colored backgrounds; filter pills for status.
3. Inline edit of Contract Type; selecting **Hold → popup asking for hold end date** (new feature) → drives end-date/notes logic + notification when hold expires.
4. **Contract detail page** with tab navigation mirroring the sheet tabs, showing: client details, sibling contracts of the same client (duplicate-ID case), notes/edit-log timeline, and a **"was on hold this month" highlight**.
5. Notes are critical — the Edits/Updates log timeline per contract Key.
6. Incremental human-readable IDs like the sheet (C01, C02…).
7. Creating a contract with payment status = Installments → **popup collecting installment plan** (amounts + number of payments, max 4, payment 1 = signing payment).
8. New rules: month-1 of a new contract = 37 days; one-time services add days; next-payment feeds CEO dashboard; new client → sales collects, renewal → account manager.

---

## 3. Mapping to mr-dashboard (proposed schema + features)

### New tables

```
contracts
  id uuid PK, organization_id, client_id FK clients,
  contract_code text          -- "C164-2" style or keep sheet Key "C164|20260429"
  account_manager uuid FK employee_profiles,
  start_date date, duration_months int, extension_days int default 0,
  contract_type contract_type_enum,        -- new|renewal|hold|edit|upsell_sales|upsell_acc|win_back|lost
  type_before_hold contract_type_enum,     -- restores on hold lift (script's *BeforeHold)
  hold_started_at date, hold_expected_end date,   -- ← the requested popup fields
  actual_paid numeric, repeated_value numeric, next_contract_value numeric,
  payment_status text check (complete|installments),
  expected_end_date date,     -- GENERATED: start + total_days(...) - 1
  actual_end_date date, renewed renewed_enum,  -- yes|no|null
  status contract_status_enum GENERATED,    -- closed|expired|soon_to_renew|active
  notes text

contract_services (join: contract_id, service_id, qty)  -- replaces Package CSV string
services: add price_type (monthly|one_time), extra_days int   -- the "Our Services" table

contract_installments
  contract_id FK, seq int check (1..4), expected_date date, amount numeric,
  collected_at date, collected_by uuid     -- responsibility: sales vs account manager

contract_events            -- the Edits/Updates log, but proper
  contract_id FK, event_type enum (created|on_hold|hold_lifted|edit_on|edit_off|
       closed_renew|closed_lost|field_change|note),
  payload jsonb (diff old→new, snapshot), note text, created_by, created_at
```

Reuse existing `audit_log`/`ai_event` plumbing; `contract_events` is the user-facing timeline (the sheet's most valued feature).

### Business rules to port (server-side, RPCs + triggers)

- `total_days(type, months, services, extension)`: 365 if 12m; renewal/win-back = 30×m; else 37+30×(m−1); + Σ extra_days (one-time full, monthly capped at 15) + extension. Working-days delay calc already exists (`working_days_between`, migration 0055 — Saudi Fri/Sat ✔).
- Status + target-bucket (Sales Deposit / On Target / Overdue) as SQL functions over any month window — powers both list badges and the CEO dashboard.
- Field-locking → not needed as "locks"; use **role permissions + immutable-after-set columns** enforced in the mutation RPC, with Hold/Edit mode as an explicit `unlock_reason` that's logged.
- Hold flow: type→Hold opens **modal: hold end date (required) + note** → writes `hold_started_at/hold_expected_end`, snapshots row into `contract_events.payload`, sets `type_before_hold`. Cron (like 0053) notifies when `hold_expected_end` arrives. Lifting hold diffs vs snapshot → `hold_lifted` event with changes list.
- Renewal flow: "Renew" action on a closed/expiring contract **creates a new contract row** (never overwrite — we keep history relationally, the sheet only overwrote because it's a spreadsheet) linked via `renewed_from contract_id`.
- Installments popup on create/edit when payment_status=installments: payment count (2–4), amounts + expected dates; payment 1 auto = signing payment (start date, actual_paid). Validate Σ amounts = contract value.
- Lost: require actual_end_date + actual_paid (0 ok); installment expectations stop at lost date.

### UI surfaces

- `/contracts` — list with **filter pills: Active (default) · Soon to renew · Expired · On Hold · Closed · All**; columns ≈ sheet; inline type dropdown (Hold triggers modal); search; per-AM filter. No row-painting — small status chips.
- `/contracts/[id]` — tabs: **نظرة عامة · الأقساط · سجل الأحداث/الملاحظات · عقود العميل الأخرى**. Header: client, code, AM, dates, status, **"⏸ كان موقوفًا هذا الشهر" banner** if any hold interval intersects current month, sibling-contract pills (C164 ×3).
- `/contracts/dashboard` — CEO view: month/year picker, movement counters, expected vs actual income (account vs sales split), per-AM breakdown table, target lists. All from the SQL functions, drill-down to contract lists.
- Installments view (the 💲 tab): upcoming payments this month, owner (sales/AM), overdue collections highlighted.

### Migration of sheet data

Importer order: clients (dedupe by ID) → services dictionary → contracts (parse Package CSV → contract_services; parse dates dd/mm/yyyy & "02 Dec 2025") → installments → log rows → contract_events keyed by `ClientID|StartDate`. Keep the sheet Key in `external_id` (pattern already exists from Odoo importer, migration 0011).

---

## 4. Open questions for the team

1. `#Renewal#` vs `Renewal` — #Renewal# appears 18× (contracts) and in installments; looks like "renewal pending/auto-marked". Confirm exact meaning before import.
2. Tax: installments tracker stores values **without VAT** — which value should the dashboard display?
3. Should hold days extend `expected_end_date` automatically (sheet does it manually via Extension period U)? Recommended: auto-add hold duration on hold-lift, editable.
4. Who may lift locks (Edit mode) in the dashboard — owner only, or AM too?
