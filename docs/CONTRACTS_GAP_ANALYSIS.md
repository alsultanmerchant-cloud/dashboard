# Contracts: Sheet vs Dashboard — Gap Analysis

Companion to `CONTRACTS_SHEET_ANALYSIS.md`. Compares the reverse-engineered sheet behavior + team requests against what's already built in mr-dashboard (verified in code, June 2026).

## Team decisions (from Saad)

- VAT: store/display values **without VAT**, same as the sheet.
- Hold: type → Hold opens a **popup asking for hold end date**; when ~5 days remain, **notify the AM + owner + dashboard users**.
- Locked-field editing (Edit mode): **owner and AM** only.
- `#Renewal#` semantics: still pending with the team (affects import of 18 rows).

---

## ✅ Already built (do NOT rebuild)

| Area | Where |
|---|---|
| Tables: `contracts`, `installments`, `contract_events`, `contract_types`, `contract_packages`, `packages`, `services_catalog`, `am_targets`, `monthly_cycles` | `0026b_commercial_layer.sql` |
| Sheet-parity grid: search, filter chips (Target/Status/Type), mine/all scope, inline cell editing (zod discriminated union → audit_log + ai_event), totals footer, sheet color palette | `/contracts/contracts-grid.tsx`, `_actions.ts → updateContractFieldAction` |
| New contract dialog (client, AM, type, package, start, duration, value, payment status) | `new-contract-dialog.tsx`, `createContractAction` |
| Contract detail: metrics, installments editor (add/edit/delete/receive → recomputes `paid_value`), monthly cycles, event log + manual event form | `/contracts/[id]/` |
| Derived fields trigger: `total_days_computed`, `delay_days` (working days, Saudi Fri/Sat ✔), `extension_days` vs `original_end_date` baseline | `0139_contracts_computed_fields_trigger.sql` |
| CEO monthly dashboard: month picker, movement, expected/actual income, per-AM targets, bucket lists; **frozen month snapshots** + month-end freeze cron + frozen guard | `ceo-dashboard.tsx`, `0142_monthly_target_engine.sql`, `0143`, `0144` |
| Excel importer (the sheet → DB bridge), Key convention `C##|yyyymmdd` kept in `external_id` | `/contracts/import/` |
| Working calendar (`is_working_day`, `working_days_between`, `add_working_days`, holidays + admin UI) | `0055`, `0063`, `/settings/holidays` |
| Cron-notification pattern (CTE bulk insert + throttle column) | `0053_overdue_notifications_cron.sql`, `0060` |
| Permissions: `contract.view` / `contract.manage` / `target.view_all`, AM-scoped RLS | `0026b`, `0028` |

The sheet's **Edits/Updates log** ≈ `contract_events` (+ `audit_logs` already captures every inline-edit old→new). The sheet's **monthly meeting columns** ≈ `monthly_cycles`. The CEO tab ≈ `monthly_dashboard_totals` engine — verified against the sheet at 97–99.4% (May 2026).

---

## ❌ Gaps (sheet behavior / team requests not in the dashboard)

### G1 — Duration engine wrong vs sheet
`createContractAction` computes `end_date = start + duration_months` (calendar). The sheet computes:
new = **37 + (m−1)×30** (free first week) · renewal/win-back = m×30 · 12m = 365 · **+ per-service Extra Days** (one-time builds +15/+30 full; monthly extras capped at 15 total) · + extension.
→ Add `extra_days` to `services_catalog` (seed from sheet's services table), implement `contract_total_days()` SQL fn, use it on create and in the 0139 trigger. *This is the team's #1 calculation they trust the sheet for.*

### G2 — Hold flow (the requested feature)
Exists: `status='hold'`, Hold contract type. Missing everything else:
- no `hold_started_at` / `hold_end_date` columns; no `type_before_hold`
- no popup on selecting Hold (grid dropdown just saves)
- no snapshot/diff on enter/leave hold (sheet logs `ON HOLD` / `HOLD LIFTED` with `Changes: old → new`)
- no restore of pre-hold type on lift
- no cron `notify_hold_expiring()` (5 days before `hold_end_date` → notify AM + owner + dashboard users; clone 0053 pattern)
- no "كان موقوفًا هذا الشهر" highlight on detail page (hold interval ∩ current month)

### G3 — Contract-type state machine
Sheet's Apps Script validates transitions; dashboard's inline edit accepts anything. Port:
- `Lost` requires `actual_end_date` + `paid_value` (0 allowed)
- `renewed_status=YES` requires renewal payment > 0 and actual end date
- every type transition auto-inserts a `contract_events` row (today only manual events exist)

### G4 — Field locking / Edit mode
Sheet locks start date, paid values, actual end after first entry; Hold/Edit unlock. Dashboard has no immutability. → enforce in `updateContractFieldAction` (or BEFORE UPDATE trigger): once set, these fields editable only by **owner/AM roles** with a required reason → logged as `EDIT` event with diff.

### G5 — Renewal action
`previous_contract_id` exists but nothing uses it. Sheet flow = overwrite row (history saved to log). Dashboard flow should be: **"تجديد" button** on expiring/closed contract → creates new contract (type Renewal, prefilled, linked via `previous_contract_id`), closes the old one. No UI for this today.

### G6 — Installments UX + rules
- No **max-4** enforcement (CHECK on `sequence <= 4` or action guard)
- New-contract dialog: choosing `Installments` does **not** open the installment-plan step (team's requested popup: number of payments, amounts, expected dates; payment 1 = signing payment = paid_value; validate Σ = total)
- No company-wide **💲 collections view** (upcoming expected payments this month, overdue collections, owner = sales for new / AM for renewals). `installments` has no `collected_by`/responsibility field.
- No overdue/upcoming installment notification cron.

### G7 — List defaults & coloring
Grid intentionally replicates full sheet coloring; team now wants: **default filter = Active**, neutral row backgrounds, status as small chips. Keep the palette only for chips. Also persist per-user contract filters (clone `user_task_filters`, 0052).

### G8 — Contract detail page misses
- No **sibling contracts** of the same client ("this client has 3 contracts" — the duplicate-ID insight)
- No client contact details block
- Sections are stacked, not the requested **tab navigation** (reuse the `/tasks/[id]` smart-buttons + tabs pattern)
- Timeline should merge `contract_events` + contract `audit_logs` rows into one feed (the sheet's notes/log is the team's most-used feature)

### G9 — Notifications plumbing
`notification-panel.tsx → notificationHref` has no `entity_type='contract'` case; no contract notifications exist at all yet (needed for G2 hold expiry + G6 collections + renewal reminders).

### G10 — Human-readable contract code
Clients keep their `C##` (sheet ID) but contracts have no code. Add `contract_code` (`C164-2` per-client seq, or global `CON-001`) using the 0050 atomic-counter pattern. Team explicitly asked for incremental IDs.

### G11 — Renewal forecast points at the wrong table
`/reports → getRenewalForecast90d` reads `projects.next_renewal_date`; should read `contracts.end_date` + status (SOON TO Be Renewed ≤ 10 days, per sheet rule). Also `/clients` detail (Odoo live) shows no contracts tab.

---

## Suggested build order

1. **G1 + G10** (duration engine + codes) — pure DB, makes data trustworthy. 
2. **G2** (hold popup + columns + events + cron + banner) — the explicit ask. 
3. **G3 + G4** (state machine + locks) — protects data like the sheet did. 
4. **G6** (installments popup, max 4, collections view + responsibility) — the money flow. 
5. **G7 + G8 + G9** (list defaults, detail tabs/siblings, notification routing) — UX parity+. 
6. **G5 + G11** (renew action, forecast rewire) — closes the renewal loop.
