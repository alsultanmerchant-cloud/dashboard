# Contracts Lifecycle — Dashboard vs Sheet Gap Analysis

Verified 2026-06-15 by driving a synthetic contract through every transition and
reading `compute_monthly_dashboard` after each step (month = Jun 2026). Evidence
is reproducible; numbers below are live.

## TL;DR

- **Money / expected buckets are CORRECT** and match the sheet. Creating a
  contract, and closing / losing / renewing one, all flow to the income cells
  the way the sheet does.
- **Three gaps**, all in *non-money* areas (movement counts, hold treatment) or
  in *workflow* (how a renewal is registered).

---

## What is verified correct ✅

| Behavior | Result | Notes |
|---|---|---|
| Create new contract → income | exact | +3,000 expected-inst / +5,000 new-client income deltas matched the sheet to the riyal (separate test). Installments now captured inline at creation and stamped with `source_type_key` so they reach the engine. |
| Mark **Renewed** (`status='renewed'`) | drops from expected | acc_exp_ontarget 156,140 → 146,140 (−10k), on-target count 34 → 33. Contract correctly leaves the renewal pool. |
| Mark **Lost** (`status='lost'`) | drops from expected | same −10k / −1. Correct. |
| Mark **Closed** (`status='closed'`) | drops from expected | status filter `not in (closed,lost,renewed)`. Correct. |

The expected-renewal buckets (G27/H27 + their counts) are **status-driven**, so
any transition to closed/lost/renewed removes the contract immediately. This is
the core money behavior and it is right.

---

## Gap 1 — Movement count tiles use `start_date`, not the event date

**Severity: real correctness bug (counts only).**

The "Monthly Snapshot" movement tiles (New / Renewed / Lost / Upsell / Win-Back /
Closed / Hold) are all computed in `compute_monthly_dashboard` with
`where c.start_date between v_start and v_end`, plus a type / renewed_status
filter. That is right for **New / Upsell / Win-Back** (a row created this month),
but wrong for transitions of **existing** contracts:

- A contract that **started in May** and is marked **Lost / Closed** in **June**
  does **not** increment June's Lost/Closed tile (its `start_date` is May).
- Putting that contract **on Hold** in June does **not** increment June's Hold
  tile (`mov_hold` filters `ct.key='Hold'` AND start-in-month; the hold action
  changes the type but not the start date).

Evidence: after flipping the May-start contract to `renewed_status='NO'` and then
to Hold, `mov_lost` / `mov_hold` stayed **0** for June.

The sheet counts these by the **event month** (its *Edits / Updates log* records
`Contract Close (Lost)`, `Contract Close (Renew)`, `ON HOLD`, … with a date). We
already record `contract_events` (ON_HOLD etc. with timestamps) and
`hold_started_at`, but the compute does not use them for movement counts.
For Lost/Closed/Renewed via `updateContractFieldAction` there is only an
`audit_log` row — no stamped event date column — so a fix needs either
event-row stamping on those transitions or a `*_at` date column.

---

## Gap 2 — "Renew" is a bare status flip, not a new contract

**Severity: workflow / by-design, but causes under-registration if misused.**

In the sheet a renewal = **close the old row + create a NEW `Renew` contract
row** (new start date in the current month, carrying the renewal value). Our only
renew path is `updateContractFieldAction` setting `status='renewed'` on the
**same** row. That correctly removes it from the target, but:

- Registers **no renewal income** — `mov_renewed` counts `ct.key='Renew'` AND
  start-in-month, i.e. it expects a *new* Renew contract row, which the flip does
  not create. `mov_renewed` stayed 0 in the test.
- The renewal **collection** cells (E30 💵 S.D & Renewed, G30/H30 💵 collected)
  read `renewal_paid_value` + `actual_end_date`. A status flip leaves those null,
  so collected-from-renewals stays 0 until the team fills them by hand.

**Workflow rule for the team:** to register a renewal, **create a new contract**
of type Renew (with the renewal value + collection fields), don't just flip the
old one's status.

---

## Gap 3 — A contract on Hold still counts in the expected renewal bucket

**Severity: needs a sheet-behavior decision.**

After putting the June-renewal contract on Hold, `acc_exp_ontarget` stayed at
156,140 (did **not** drop). Because `status='hold'` is not in
`(closed,lost,renewed)`, a held contract whose `end_date` is in the month still
adds its `next_contract_value` to On-Target/Overdue expected, and still counts in
the On-Target tile. If the sheet treats Hold as "paused / not expected this
month," we are overstating expected by the held contracts' value. **Confirm the
sheet's Hold treatment of Target_ByMonth before changing.**

Note: held contracts' **installments** also keep counting by their frozen
`source_type_key` (set at creation), independent of the Hold type change.

---

## Suggested fixes (not yet applied)

| Gap | Fix | Cost |
|---|---|---|
| 1 | Count movement by event date: stamp a date on Lost/Closed/Renewed transitions (event row or `*_at` column) + count Hold from `hold_started_at` / `contract_events`; rewrite the `mov_*` block to use those. | schema + action + compute |
| 2 | Add a guided "Renew" action that creates the new Renew contract row (value + collection fields) instead of a status flip. | action + UI |
| 3 | Exclude `status='hold'` from the expected buckets — **only after** confirming the sheet does. | compute-only |
