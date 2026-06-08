# Contracts Module — Parallel-Run Plan (June 2026)

**Goal:** prove the dashboard can replace the Google Sheet ("نسخة شيت الحسابات-سكاي لايت")
for contract + revenue management, by running both side-by-side for one week and
confirming the numbers match, before switching the sheet off.

**Status going in:** all 6 sheet tabs are represented in the dashboard and the
CEO dashboard for May was verified identical to the sheet (Expected 197,143 /
Actual 95,816 / 48.6%, movement 17/2/14/4/2/12, clients 96/35/7/76).

---

## Where everything lives now (sheet tab → dashboard)

| Sheet tab | Dashboard location |
|---|---|
| Client's Contracts | `/contracts` → **جدول العقود** (editable grid, same colors) |
| 💲 Installments Tracker | Contract page → **جدول الدفعات** (add/edit/delete) + dashboard → **الدفعات المستحقّة** |
| Edits / Updates log | Contract page → **سجل الأحداث** (audit trail of every change) |
| CEO_Dashboard | `/contracts` → **لوحة الإيرادات** (month picker) |
| TARGET_CONTRACTS (services) | Service catalog (price-type Monthly/One-Time + grace) |
| Acc_Target_Breakdown | لوحة الإيرادات → per-client buckets (On-Target / Overdue / Renewed / Lost) |

---

## Roles for the run

- **3–5 account managers** — do their real daily contract work in the dashboard.
- **1 owner/admin** (alsultain@agency.com) — creates contracts, manages installments.
- **1 reviewer** — runs the daily diff (below) and logs mismatches.

---

## Daily routine (each working day, ~10 min)

1. The team does **all** contract edits in the dashboard for the day:
   - New contract → **+ عقد جديد**
   - Change target / status / package / dates / values → click the cell (inline edit)
   - Record/extend installments → contract page → **جدول الدفعات**
   - Mark renewed / lost → set **تجديد؟** = YES / NO / Closed
2. Keep the sheet open **read-only as a safety net** — do NOT edit it during the run.
3. Reviewer runs the diff at end of day and records any mismatch in the log table below.

---

## What to compare (the diff)

| Check | Dashboard | Sheet | Pass if |
|---|---|---|---|
| Contract count | `/contracts` header "عقد N" | Client's Contracts row count | equal |
| A spot-checked contract's fields | contract row/detail | matching sheet row | every cell matches |
| This month's **Total Expected** | لوحة الإيرادات | CEO_Dashboard "Total Expected income" | within rounding |
| This month's **Total Actual** | لوحة الإيرادات | CEO_Dashboard "Total Actual income" | within rounding |
| Movement (New/Renewed/Lost/Upsell) | لوحة الإيرادات tiles | CEO_Dashboard movement | equal |
| A given AM's expected/achieved | تارجت الأكونت table | Installments Tracker row | within rounding |
| Installments due this month | الدفعات المستحقّة | Installments Tracker | same clients + amounts |

> Note on the **current month**: the dashboard computes it **live**, so it can differ
> from the sheet by the moment-in-time each was looked at. That's expected — compare
> at the same time of day, and treat small renewal/installment-timing gaps as OK.
> **Past months are frozen** and must match exactly.

---

## Mismatch log

| Date | What | Dashboard value | Sheet value | Likely cause | Resolved? |
|---|---|---|---|---|---|
| | | | | | |

---

## Exit criteria (when to switch the sheet off)

- [ ] 5 consecutive working days with **no unexplained mismatch** on the diff table.
- [ ] Every AM in the pilot has created ≥1 contract and edited ≥1 installment in the dashboard.
- [ ] Month-end freeze verified: on **July 1**, June auto-locks (badge flips to
      "مُجمَّد") and its numbers stop moving. (cron `freeze-monthly-dashboard`, 02:00.)
- [ ] Owner sign-off.

When all four are checked: set the sheet to **read-only / archived** and announce the
dashboard as the system of record.

---

## Known limitations to watch (not blockers)

1. **Per-client breakdown on frozen months is a live estimate** (labeled in the UI).
   Org totals + per-AM are sheet-exact; the per-client drill-down recomputes from
   current state. Only matters when viewing *past* months' client lists.
2. **20 of 197 contracts are linked to delivery projects**; the other 177 have no
   project in the system (their clients were never in Odoo). New projects aren't
   auto-created from contracts — that's a deliberate, separate decision.
3. **One placeholder email** — مدى الجميري is `mada.aljimari@skylightad.com`; update
   from `/organization/employees` when known.

---

## Rollback

Nothing destructive was done to the sheet. If the run fails, keep using the sheet —
the dashboard data is additive and can be re-imported. Contract edits made in the
dashboard during the run are in `audit_log` and can be reconciled back if needed.
