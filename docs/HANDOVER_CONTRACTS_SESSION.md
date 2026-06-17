# Handover — Contracts dashboard fixes (session 2026-06-17)

Audience: the next AI agent picking up this work. This documents everything fixed
in this session and hands off the next task. The team (Sky Light / Rawasm) reports
bugs in Arabic via WhatsApp screenshots comparing the dashboard against their live
Google sheet.

---

## 0. Environment essentials (read first)

- **Single-tenant.** Org slug `rawasm-demo`. All data is one org.
- **Querying Supabase / applying migrations:** use `.env.local` creds, NOT the
  Supabase MCP (team preference).
  - REST read: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
  - DDL / SQL: Management API
    `POST https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/database/query`
    with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`, body `{"query": "..."}`.
  - Bash gotcha: some `curl`+heredoc combos fail with "failed to change group ID";
    reading `.env.local` inside a `python3` heredoc and fetching there works
    reliably (and needs `dangerouslyDisableSandbox: true` for outbound network).
- **The live sheet is public-exportable** (no auth):
  `https://docs.google.com/spreadsheets/d/$CONTRACTS_GOOGLE_SHEET_ID/export?format=csv&gid=$GID`
  GIDs in `.env.local`: `CONTRACTS_GOOGLE_CONTRACTS_GID` (Client's Contracts tab),
  `CONTRACTS_GOOGLE_INSTALLMENTS_GID` (Installments Tracker). Use it to compare
  dashboard numbers against the team's source of truth.
- **Migrations:** apply via Management API, then mirror identical SQL into
  `supabase/migrations/NNNN_*.sql`. Idempotent style. Next free number: **0190**.
- **Preview testing:** `preview_start` (config `dev` in `.claude/launch.json`).
  The app is behind auth; log in with the documented test owner from `CLAUDE.md`
  (`alsultain@agency.com` / `alsultain22`). Navigate via
  `window.location.assign(...)` in `preview_eval`. NOTE: dashboard screenshots can
  come back blank (inner scroll container quirk) — `preview_eval` DOM queries are
  the reliable proof. UI default locale is **English** (intentional), so search for
  English labels.
- **Crons removed** (Hobby plan). Sheet sync is manual. The agent cannot trigger
  prod-write crons.

---

## 1. What was fixed this session

All five issues are DONE and verified live in preview. DB migrations are **applied**
to prod; code changes are **committed-pending** (uncommitted in the working tree as
of handover — see §3).

### Issue 1 — Grid "نشط + منتهي" undercounted (80 vs sheet 85) + no "SOON" filter
- **Root cause:** the contracts grid status filter ran on the derived DB `status`
  enum (`active`/`expired`), which (a) folds "SOON TO Be Renewed" into `active`
  with no chip, and (b) maps live-but-Hold contracts to `status='hold'`, hiding
  them — while the grid's Status COLUMN already displays `contract_status_label`.
- **Fix:** filter on `contract_status_label` instead. Added `statusBucket()` →
  Active / Expired / SOON / Closed; default preset = [Active, Expired, SOON]; new
  "Renewal Soon / قرب التجديد" chip. Files:
  `src/app/(dashboard)/contracts/contracts-grid.tsx`, `messages/{ar,en}.json`
  (`grid.statusLabels.soonRenew`).
- **Verified:** grid shows "85 contracts · of 199"; chips Active(47) Expired(22)
  Renewal Soon(16) Closed(114).

### Issue 2 — Dashboard count must equal the sheet (89 → 85), stale rows
- **Root cause:** the sheet sync UPSERTs by `external_id` (`ClientID|startdate`) and
  never removed rows that vanish from the sheet (e.g. a client renews → new key →
  old version lingers). DB had 214 contracts vs the sheet's 199.
- **Fix (migration 0186):** added `contracts.sheet_present boolean default true`.
  The importer (`src/lib/import/commit-contract-import.ts`) sets it `true` for every
  row in a pull and flips absent sheet-sourced rows (`external_source='excel-acc-sheet'`)
  to `false`. `listContractsGrid` filters `sheet_present=true`. Backfilled the 15
  stale rows. Result: grid = 199 rows / 85 live. Stale rows stay in the DB for the
  detail page. Types updated in `src/lib/supabase/types.ts`.

### Issue 3 — CEO roster strip didn't match the sheet (102 → 85)
- **Fix (migration 0187):** rewrote `get_contracts_roster` to define "current
  client" as `sheet_present AND contract_status_label NOT ILIKE 'Closed%'` (falls
  back to the status enum only when label is null). Live roster now = 85.

### Issue 4 — "Top clients" panel showed far-renewal clients + experience % mismatch
- **User decision:** make it an action list ("only show clients needing attention").
- **Root cause A:** panel ranked by revenue, surfaced far-future renewals as "risk".
- **Root cause B:** the "التجربة/Experience" pill showed a derived `health_score`
  (satisfaction minus penalties), disagreeing with the رضا العملاء page (e.g. روعة
  المنزل = 51/خطر here vs 60/watch there).
- **Fix (migration 0188 + ceo-dashboard.tsx):** RPC `get_ceo_client_insights`
  re-scoped to clients with a real signal (open AI risk, overdue installments,
  satisfaction <70 or negative, or renewal within month+45 days), ordered by
  severity. Panel renamed "عملاء يحتاجون انتباهك / Clients needing attention". New
  `ExperiencePill` reads raw `satisfaction_score`+`sentiment` and mirrors the
  satisfaction page tiers EXACTLY (`bucketOf`: negative/<55 = At risk; <70 = Needs
  attention; ≥70 = Healthy; null = Not analyzed). **Invariant:** if satisfaction
  tiers change in `satisfaction-workspace.tsx`, update `ExperiencePill` too.

### Issue 5 — "Installments due" department pill showed "—" for لغة الأرقام (C188)
- **Root cause:** `installments.source_type_key` (drives Sales vs Account, and the
  income totals in 0168/0172) was only set by the manual new-contract action — the
  **sheet importer never set it**, so sheet-synced contracts had `null` → no pill
  AND dropped from income totals.
- **Fix (migration 0189):** trigger `fill_installment_source_type` (before
  insert/update) fills `source_type_key` from the contract's revenue type when null
  (uses `type_before_hold` when current type is Hold/Lost, honoring 0170); only when
  null, preserving existing values. Plus a backfill. No app-code change. Verified:
  لغة الأرقام now shows "Sales · New · 6,000".

### Also confirmed already-correct (team screenshot was stale)
- Contract detail "القيمة الإجمالية" (Total Value): team saw 4,500 (the renewal
  value) on 6/16 11:22 AM; commit `9940040` (6/16 12:50 PM) had already fixed the
  importer to set `total_value` from the tracker's "قيمة العقد بالكامل (بدون ضرائب)"
  (Installments case) or actual-paid (Complete case). Live page now correctly shows
  C183 = Total 9,000 / Paid 3,478 / Outstanding 5,522. All 67 installment contracts
  verified against the tracker. No change needed.

---

## 2. Migrations applied this session (all on prod)

| # | File | What |
|---|---|---|
| 0185 | `contract_sheet_client_name.sql` | (pre-existing in tree) row-level sheet client name |
| 0186 | `contract_sheet_present.sql` | `sheet_present` flag + index + grid filter |
| 0187 | `contracts_roster_sheet_parity.sql` | roster RPC = sheet parity (85) |
| 0188 | `ceo_client_insights_attention.sql` | insights RPC = action list by severity |
| 0189 | `installments_source_type_autofill.sql` | trigger+backfill for `source_type_key` |

Code files touched: `contracts-grid.tsx`, `ceo-dashboard.tsx`,
`src/lib/data/contracts.ts`, `src/lib/import/commit-contract-import.ts`,
`src/lib/supabase/types.ts`, `messages/ar.json`, `messages/en.json`.

Relevant memories (already written): `project_contracts_type_status`,
`project_ceo_insights_panel`, `project_contracts_income_model`.

---

## 3. State at handover

- All 5 migrations **applied to prod DB**.
- Code changes **uncommitted** in the working tree (user has not yet asked to
  commit). Untracked migration files: 0185–0189. Modified: the 7 files above.
- Dev preview server may still be running (serverId from this session).

---

## 4. NEXT TASK — ✅ DONE (2026-06-17)

**Status:** Fixed. `getMonthTargetBuckets()` installments query widened to include
still-owed overdue carryover. Verified: server-rendered `/contracts?view=dashboard`
now shows "34 installments" (was 10). Change is in `src/lib/data/contracts.ts`
(~line 488), code-only — no migration. Predicate now:
`sequence>=2 AND contract.sheet_present AND expected_date<=month-end AND
(expected_date>=month-start OR status NOT IN (received,waived))`. Sorted by
expected_date asc so overdue carryover (status='overdue', red badge) lists first.
Original report below for reference.

**Team report (Arabic):** "وعدد الدفعات اللي المفروض تكون الشهر دا المتوقعه +
المتاخرة اكتر من ال10 اللي ظاهرين عالسيستم"

**Translation:** The "الدفعات المستحقة هذا الشهر" (Installments due this month)
section on the Contracts CEO dashboard shows only **10** rows, but the real count —
**expected-this-month + overdue (carryover)** — is more than 10.

**Confirmed root cause:** `getMonthTargetBuckets()` in
`src/lib/data/contracts.ts` (lines ~492–504) builds `installments_due` with:
```
.gte("sequence", 2)
.gte("expected_date", start)     // month start
.lte("expected_date", endDate)   // month end
```
This returns ONLY installments whose `expected_date` falls within the selected
month. It EXCLUDES overdue installments from prior months that are still unpaid.

**Verified numbers (current month, org rawasm-demo):**
- this-month (seq ≥ 2): **10**  ← what's shown now
- overdue carryover (seq ≥ 2, `expected_date < month_start`, status NOT in
  received/waived): **24**  ← missing
- So the list should show ~34, not 10.

**Suggested fix direction:**
- Widen the query to also include overdue carryover: keep this-month rows, AND add
  rows where `expected_date < start` and `status NOT IN ('received','waived')`
  (i.e. still owed). PostgREST: a single `.lte("expected_date", endDate)` plus an
  `.or(...)` on status, or do two queries and merge, or push into an RPC.
- Decide whether to also filter `contract.sheet_present = true` for consistency with
  the rest of the dashboard (recommended — archived contracts shouldn't appear).
- The render already maps the full array (no `slice`); the section header count
  `buckets.installments_due.length` will update automatically.
- Keep `sequence >= 2` (seq 1 = signing deposit, counted as new-client income).
- Confirm the section's intent with the income spec: see
  `docs/CONTRACTS_DASHBOARD_INCOME_SPEC.md` and migration 0172 — the income engine
  already separates this-month vs overdue installment buckets; the **display list**
  here should mirror "expected + overdue" as the team expects. The `status` column
  in the list will then show `overdue` (red) for carryover rows.

**Also note (leftover text in the team message):** "هنا نوع العقد موجود والدفعة
للسيلز فمش عارفة ليه مش ظاهرة؟" — this is Issue 5 (the Sales pill "—"), ALREADY
FIXED via migration 0189. No action needed; it was re-pasted.

**Verification:** after the fix, reload `/contracts?view=dashboard` in preview and
confirm the "Installments due this month" header shows ~34 and overdue rows appear
with the red "overdue" status pill. Cross-check the count against the sheet's
Installments Tracker if the team disputes the number.
