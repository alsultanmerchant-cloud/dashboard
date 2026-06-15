# Contracts Dashboard — Income Model Spec (decoded from the live sheet)

Source: `docs/data/acc-sheet.xlsx` → tab **CEO_Dashboared**, rows 18–38. Every
formula below was extracted verbatim from the bound Google-Sheets functions and
translated to plain logic. This is the authoritative spec the dashboard's two
income sections (Account / Sales) must reproduce.

The selected month is a window `[ms, me]` (sheet hidden cells `X1`/`Y1`, driven
by the Month/Year dropdowns). "Installment slots" = payments **2, 3, 4** only
(payment 1 = signing deposit, handled separately as new-client / SD income).

## Installments Tracker column map (one row per contract)
`D`=Contract Type · `G`=signing amount (pmt1) · pmt2 `(H exp, I amount, J actual)`
· pmt3 `(K, L, M)` · pmt4 `(N, O, P)` · `R`=lost date · `S`=Key.

## Clients Contracts column map
`D`=start · `E`=Target(today) · `F`=Contract Type · `I`=Actual paid value ·
`O`=Next Contract Value · `P`=Actual Paid for renewal · `Q`=Actual End Date ·
`T`=renewed? · `V`=Target_ByMonth (month-windowed bucket) · `W`=Key.

Account types = **Renewal, #Renewal#, Win-Back, Upsell-Acc**.
Sales types   = **New, Upsell-Sales**.

---

## 1. Account Department section (sheet rows 24–32)

> Note in sheet (J27): *"الدخل من الاكونت مبني على عملاء التجديد فقط"* — account income
> is renewals only; a brand-new client closed by an account manager is added manually.

### Expected (row 27) → `I27 = E27 + F27 + G27 + H27`
| Cell | Meaning | Logic |
|---|---|---|
| **E27** | Overdue Installments | For account-type contracts, sum pmt 2/3/4 amounts where **expected date < ms** (was due before this month), not lost before month (`R="" or R>=ms`), and still open or collected this month (`actual date empty, or within [ms,me]`). |
| **F27** | Installments (due this month) | account-type, **expected date ∈ [ms,me]**, not collected before month (`actual empty or >= ms`). |
| **G27** | On Target clients | SUM `Next Contract Value (O)` for contracts whose **Target_ByMonth = "On Target"** (union current rows + Edits log so renewed-overwritten rows still count). |
| **H27** | Overdue clients | same, **Target_ByMonth = "Overdue"**. |

### Actual achieved (row 30) → `I30 = E30 + F30 + G30 + H30 + F32 + G32`
| Cell | Meaning | Logic |
|---|---|---|
| **E30** | 💵 S.D & Renewed | Sales-Deposit contracts' actual paid (P, dated Q ∈ month) **+** `#Renewal#` repeated value (I, dated start D ∈ month). |
| **F30** | 💵 Installments collected | account-type pmt 2/3/4 where **actual date ∈ [ms,me]**. |
| **G30** | 💵 On Target collected | `Actual Paid for renewal (P)` for On-Target clients, dated by Actual End (Q) ∈ month. |
| **H30** | 💵 Overdue collected | same for Overdue clients. |
| **F32** | Upsell-Acc | Σ actual paid value (I) of Upsell-Acc contracts started in month (contracts ∪ log, deduped). |
| **G32** | Win-Back | Σ actual paid value (I) of Win-Back contracts started in month. |

### Derived
- **Revenue Achievement % (H32)** = `I30 / I27`
- **Revenue Gap (I32)** = `I27 − I30`

---

## 2. Sales section (sheet rows 34–38)

### Expected
| Cell | Meaning | Logic |
|---|---|---|
| **E36** | Overdue Installments | sales-type pmt 2/3/4, expected date < ms, open/collected-this-month, not lost before month. |
| **F36** | Expected Installments | sales-type pmt 2/3/4, expected date ∈ [ms,me], not collected before month. |
| **G36** | **Total Expected** | `E36 + F36`. |

### Actual
| Cell | Meaning | Logic |
|---|---|---|
| **H36** | Actual Installments | sales-type pmt 2/3/4 where actual date ∈ [ms,me]. |
| **G38** | Upsell-Sales | Σ actual paid value (I) of Upsell-Sales contracts started in month. |
| **H38** | Actual income from new clients | Σ actual paid value (I) of **New** contracts started in month (the signing deposit). |
| **I38** | **Total Income from Sales** | `H36 + G38 + H38`. |

### Derived
- **Gap (I36)** = `G36 − H36`
- **Installments Achievement % (F38)** = `H36 / G36`

---

## 3. Mapping to mr-dashboard schema + gaps

| Sheet | Our DB | Note |
|---|---|---|
| Clients Contracts | `contracts` | ✔ |
| Installments Tracker (pmts in columns) | `installments` (normalized, 1 row/seq) | seq 1 = signing → **exclude from installment income (use seq ≥ 2)**; treat seq 1 / `actual_paid` as new-client/SD income. |
| Contract Type | `contract_types.key` | **GAP**: sheet has `Upsell-Acc` + `Upsell-Sales`; we have one `UPSELL`. Also `#Renewal#` and `Renewal` → we have one `Renew`. |
| Target_ByMonth (V) | `contracts.target` (today) | Month-windowed in sheet via log-union; we only have "today". Acceptable for the **current** month (past months are frozen sheet imports). |
| Next Contract Value (O) | `contracts.next_contract_value` | ✔ |
| Actual Paid for renewal (P) / Actual End (Q) | `contracts.renewal_paid_value` / end fields | ✔ approx |
| Actual paid value (I) | `contracts.actual_paid` | ✔ |

### Open decision
- **UPSELL routing**: our single `UPSELL` key must be split into Account-upsell vs
  Sales-upsell to populate `F32` (account) and `G38` (sales) faithfully. Either add
  the distinction to the schema, or pick a default (all-Account / all-Sales).

### Current code divergence (why the cards were wrong)
`0142_monthly_target_engine.sql` computes a single `expected_installments` (ALL
types) and `total_actual = renewals + ALL installments` — it never splits by
department. The fix is to compute the Account and Sales blocks above as separate
columns and rewire the two card groups in `ceo-dashboard.tsx` to them.

---

## 4. The whole system — all 7 sheet tabs

> **The Account vs Sales split is a COMMISSION/TARGET attribution rule.** A
> contract's value counts toward either the *sales rep's* target or the *account
> manager's* target, decided by contract type:
> Account-credited = `Renewal`/`#Renewal#`/`Win-Back`/`Upsell-Acc`;
> Sales-credited = `New`/`Upsell-Sales`. This is why the dashboard keeps two
> income blocks and two per-person target tables.

| Sheet tab | Role | Our equivalent |
|---|---|---|
| **Clients Contracts** | Current state, 1 row/contract (overwritten on renewal) | `contracts` ✅ |
| **💲Installments Tracker** | Payment plan, ≤4 payments (pmt1 = signing) | `installments` ✅ (normalized, seq 1 = signing) |
| **Edits / Updates log** | Append-only event log + full field snapshot per event | `contract_events` ⚠️ (exists, simple) |
| **CEO_Dashboared** | Aggregation: income (Account/Sales), movement, client status | `monthly_dashboard_totals` + `compute_monthly_dashboard` ⚠️ (no dept split) |
| **TARGET_CONTRACTS** | Drill-down lists behind each bucket | `getMonthTargetBuckets` ⚠️ (no account/sales installment split) |
| **Acc_Target_Breakdown** | Per-AM income table + **team rollups** | `am_targets` + `compute_am_monthly_targets` ⚠️ (wrong breakdown shape, no team rollup) |
| **Cycle_tracker** | Monthly meeting + content-cycle delivery tracking per client | `monthly_cycles` ✅ |

### Acc_Target_Breakdown (per-AM + team rollup)
Each AM row reproduces the **Account** income block filtered by that AM
(`Installments Tracker.C = AM name`, same type filter):
- `B` Total Expected = Overdue Inst + Installments + On-Target clients + Overdue clients
- `G` Actual Achieved = 💵Installments + 💵On-Target + 💵Overdue + S.D&Renewed + Upsell-Acc + Win-Back
- `H` Achievement % = G/B

**Team rollup** (cols O/P/Q) follows the org hierarchy via starred (🌟) team-leader rows:
- Team leader row sums its members' B/G (e.g. `O4=SUM(B5:B8)`, `O14=B15`).
- Department head row (ايه خفاجي) = grand total `SUM(B4:B15)`.
- A separate block (rows 19-20: عمار / محمد السلطان) holds sales/management targets.
→ maps to `employee_profiles.manager_employee_id` / `team_leader_employee_id` / `departments.head_employee_id`.

### TARGET_CONTRACTS (drill-down lists)
Key+name+value lists per bucket: **on-target**, **overdue**, **RENEWED from
target ✅**, **LOST from target**, **Clients with Installments (FROM ACCOUNT)**
[Expected / Overdue / Paid ✅], **Clients with Installments (FROM SALES)** [same].
Built by UNION of current contract rows + the Edits log (so renewed-overwritten
rows still count).

### Edits / Updates log
Append-only. **Log types**: `Contract Close (Lost)`, `Contract Close (Renew)`,
`ON HOLD`, `HOLD LIFTED`, `EDIT MODE ON`, `EDIT MODE OFF`. Each row also stores a
full snapshot of the contract's fields at event time (Target, Type, value, dates,
Key) so historical months reconstruct correctly. This is the sheet's most-valued
feature — the team wants it surfaced in the dashboard, and wants to **add a log
entry** with the same UI/UX as task-detail notes (`comments-feed.tsx`).

### Cycle_tracker
Per client per month: meeting expected/actual date + status + delay days; content
cycle add-to-Rawasm expected/actual date + status + delay days + delay reason.

---

## 5. Build gap analysis (vs current codebase)

| # | Gap | Where |
|---|---|---|
| G1 | Income engine never splits Account vs Sales by type | `compute_monthly_dashboard` (0142) → new migration |
| G2 | `am_targets.breakdown_json` uses 4-field combined shape, not the sheet's 6-component Account model | `compute_am_monthly_targets` (0142) |
| G3 | No team rollup (leader sums members; head = grand total) | new RPC/view over org hierarchy |
| G4 | `UPSELL` not split into Upsell-Acc / Upsell-Sales; `#Renewal#` folded into `Renew` | `contract_types` + data migration **(open decision)** |
| G5 | `getMonthTargetBuckets` doesn't split installments into FROM-ACCOUNT / FROM-SALES | `contracts.ts` |
| G6 | Contract log is a simple list; team wants the rich task-notes feed + add-log | reuse `comments-feed.tsx` on `contracts/[id]` + dashboard |
| G7 | Sales section cards don't exist as 3 separate numbers (installments / upsell-sales / new-client income / total) | `ceo-dashboard.tsx` |
| G8 | Installment income must exclude seq 1 (signing) and count seq ≥ 2 | queries in new migration |

**Already correct / reusable:** contracts table + grid, contract detail page,
installments editor, monthly cycles, hold flow, bulk import, org-chart queries,
task activity-feed components (for G6).

---

## 6. Implementation progress (income engine — G1/G7/G8)

**Done:**
- `0168_contracts_income_dept_split.sql` — extends `monthly_dashboard_totals` with
  Account/Sales dept columns and rewrites `compute_monthly_dashboard()` to fill
  them, translated **verbatim** from the sheet formulas (E27/F27/G27/H27 + actuals
  E30/F30/G30/H30/F32/G32; sales E36/F36/H36/G38/H38). UPSELL→Account.
- `0169_installments_lost_date.sql` — adds `installments.lost_date` (sheet col R).
- Engine installment rules (exact formula match): this-month cells (F27/F36) =
  type + expected ∈ [ms,me] + not-collected-before; overdue cells (E27/E36) add
  `(lost_date is null or lost_date >= ms)`. Income uses seq ≥ 2 only.
- `scripts/seed-acc-sheet.ts` extended to map `next_contract_value`,
  `renewal_paid_value`, `repeated_services_value`, `actual_end_date`,
  `renewed_status`, and installment `lost_date`.

**Validated:** the installment/new-client formulas reproduce the sheet's logic
(account inst 8,990 & 0; new-client income 74,250; actual collected 11,000 all
matched exact in spot checks).

**Known limitation — data freshness:** the local `docs/data/acc-sheet.xlsx` is a
**May-2 export** whose cached dashboard values are from **April** while its data
rows are May-2 (inconsistent), so exact numeric validation against it is not
possible. The On-Target/Overdue **client** buckets read `contracts.target`
(point-in-time) and need **fresh current-state data** to be correct for the live
month. → Re-run `seed-acc-sheet.ts` against a fresh, consistent export of the live
Google Sheet (set dashboard month, let it calc, download xlsx) to finish G1.

**Not yet done (follow-ups):** G2 (per-AM breakdown shape), G3 (team rollup),
G5 (account/sales installment drill-downs), G6 (rich contract log UI), and the
`ceo-dashboard.tsx` card rewiring to the new dept columns.
