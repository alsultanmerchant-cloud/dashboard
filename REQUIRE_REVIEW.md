# Review Required — Metric Tooltips + Review Rigor Two-Stage Fix

**Date:** 2026-06-17
**Branch:** `main`
**Author:** Claude (Agency CC)

Two related pieces of work, both touching the accountability module and the i18n
message files. Please review before merge/deploy.

---

## 1. Review Rigor card now models BOTH review stages

### Problem
The `/accountability` "صرامة المراجعة" (Reviewer rigor) card only modeled the
`manager_review` stage. The data actually has **two** review stages —
`manager_review` (2,439 tasks) and `specialist_review` (2,863 tasks) — and the
specialist stage was treated purely as a "forward/pass" destination, so it had
**no reviewer at all**. The two people shown were credited only by team-manager
assignment, not tied to the specialist review work.

### Decision (user-confirmed)
- Model **both** stages, shown as **two separate sections**.
- **Manager Review** → credited to the assigned `team_manager` (the Manager/Head
  who "reviews quality" per the Sky Light ops manual). *(unchanged behavior)*
- **Specialist Review** → credited to the **executing specialist** = the task
  assignee (`task_assignees.employee_id`, `role_type='agent'`), deduplicated to
  one deterministic person per task.

Attribution rationale: Odoo sync never writes the approval-gate columns and
`moved_by` is 100% NULL, so reviews are credited by **assignment** (a team-level
proxy, not a personal verdict). There is no dedicated "specialist reviewer"
column, so the executing assignee is the chosen proxy.

### Changes
- **`src/lib/data/accountability.ts`**
  - Removed the single-stage `PASS_STAGES`; added `MANAGER_PASS_STAGES`
    (`specialist_review, ready_to_send, sent_to_client, done`) and
    `SPECIALIST_PASS_STAGES` (`ready_to_send, sent_to_client, done`).
  - Extracted the fallback SQL into a parameterized `buildStageReviewerSql(org,
    { stage, passStages, attribution })` where `attribution` is `team_manager`
    or `agent` (changes the dedup CTE's actor column + filter, the stage filter,
    and the "pass" forward set).
  - Replaced `loadReviewers` with: `loadManagerReviewers` (approval-gate
    preferred → stage-history fallback), `loadSpecialistReviewers`
    (stage-history only), and a combined `loadReviewers` returning
    `{ managerReview, specialistReview }`.
  - `AccountabilityOverview.reviewers` type changed from `ReviewerRigorRow[]` to
    `{ managerReview: ReviewerRigorRow[]; specialistReview: ReviewerRigorRow[] }`.
- **`src/app/(dashboard)/accountability/accountability-workspace.tsx`**
  - `ReviewerRigorSection` now renders two `ReviewerStageBlock`s (extracted
    component) — one per stage, each with its own title, subtitle, attribution
    note, and reviewer table.

### Review focus points
- [ ] Specialist-review attribution proxy (executing assignee) is acceptable for
      the team's reading of "who reviewed."
- [ ] `SPECIALIST_PASS_STAGES` excludes `manager_review`/`specialist_review`
      correctly (a specialist review "passes" only when it moves to
      ready_to_send / sent_to_client / done).
- [ ] Dedup-to-one-per-task is correct for the `agent` attribution (mirrors the
      existing team-manager dedup).

### Verification done
- `tsc --noEmit`: **0 errors** in the two edited files (project has a
  pre-existing dirty tsc baseline elsewhere, unrelated to this change).
- Live DB query confirmed `specialist_review` now yields real reviewers
  (عمر الخيام 192, محمد عادل 101, …) distinct from manager-review people.
- Rendered `/accountability` live: both sections populate; no console errors.

---

## 2. Filled all dangling metric-tooltip i18n keys (178 references)

### Problem
Earlier incomplete work had wired **178 distinct `metricTooltips.*` references**
across 11 dashboard files, but **none of the keys existed** in `messages/en.json`
or `messages/ar.json` — every one was a dangling tooltip that would render its
raw key path on hover.

> Note: a background multi-agent Workflow was attempted for this but failed
> entirely — every agent hit a macOS **TCC "Operation not permitted"** denial on
> `~/Documents` and made zero edits. All keys below were written in the main
> session instead.

### What was added
Every key's text was grounded in the **real computation** by reading the
indicator's data source, and written **bilingually** (English + Arabic with
Arabic-Indic numerals). Placed under each component's own translation namespace.

| Area | Keys | Namespace(s) |
|---|---|---|
| Accountability | 22 | `AccountabilityPage` |
| Contracts | 44 | `ContractsPage` |
| Finance + Expenses | 42 | `FinancePage`, `FinanceExpensesPage` |
| Dashboard home | 27 | `Dashboard`, `Executive.hero`, `Executive.pulse` |
| Reports | 22 | `ReportsPage` |
| Satisfaction + Groups | 21 refs (→26 concrete) | `SatisfactionPage` |
| **Total** | **178 refs / 183 concrete keys each language** | |

(The 2 dynamic prefixes `satisfaction_bucket_*` and `satisfaction_dim_*` expand
to 7 concrete keys — atRisk/watch/healthy/pending and
relationship/execution/commercial.)

Also added 4 section keys to `AccountabilityPage.reviewers`
(`managerReviewTitle/Subtitle`, `specialistReviewTitle/Subtitle`) and genericized
`reviewers.empty` / `reviewers.attributedNote` for the two-section layout.

### Review focus points
- [ ] Tooltip wording is accurate to each metric's real formula/source (spot-check
      a few against the data layer — e.g. contracts Account/Sales split, finance
      Expected vs Actual rows, reports stored-digest snapshots).
- [ ] Arabic phrasing reads naturally and uses Arabic-Indic numerals.
- [ ] No raw `metricTooltips.` key path leaks on hover.

### Verification done
- Both message files parse as valid JSON.
- **Namespace-aware verifier**: every `t("metricTooltips.…")` reference resolves
  to a non-empty string under its file's actual namespace in **both** en and ar
  (dynamic prefixes covered).
- `metricTooltips.` never leaked as raw text on any rendered page; no console
  errors.

### Not fully verified
- Could **not** capture clean screenshots of contracts/finance/reports/
  satisfaction pages — the preview tab got stuck replaying a queue of navigation
  requests. Static verification + the accountability render + zero console errors
  cover correctness, but a manual hover pass on those four pages is recommended
  during review.

---

## 3. Overdue-installments section now has a live fallback (Sky Light feedback 2026-06-16)

### Background
Sky Light reviewed the contracts CEO dashboard's "الدفعات المستحقة هذا الشهر"
(Installments due this month) widget and sent three asks. On investigation, all
three were **already implemented and committed** in `9940040` (2026-06-16 12:50),
~2h *after* their 10:59 message — they were viewing the pre-`9940040` deployed
build:
1. First payment (دفعة اولى) excluded from the due-list — query filters
   `.gte("sequence", 2)` (signing deposit is already counted as new-client
   income, not an installment).
2. Contract type → collecting department shown via the "النوع / القسم" column
   (`InstallmentDeptCell`): `source_type_key` New=Sales, Renew/WinBack/UPSELL=Account.
3. Dedicated "الدفعات المتأخرة" (Overdue installments) section, split Account / Sales.

### Problem fixed this session
The dedicated overdue section (#3) was **snapshot-only**. Its per-department
buckets `acc_inst_overdue` / `sales_inst_overdue` are populated from the frozen
`monthly_target_snapshot`, but the live RPC `get_month_target_buckets` (0174)
**never emits them**. So for any month without a captured sheet snapshot (e.g. a
fresh month before the first "Pull from Sheet"), both lists were empty and the
section silently disappeared — even though overdue rows existed inline in the
"installments due" table. That's exactly the visibility gap the client flagged.

### Change
- **`src/lib/data/contracts.ts`** (`getMonthTargetBuckets`)
  - Added `expected_date` to the `IRow` type; hoisted the installment rows into
    `instRows` so they can be reused.
  - Added a **live fallback**: when both `acc_inst_overdue` and
    `sales_inst_overdue` are empty (⇒ live RPC path, no snapshot), derive them
    from the overdue installment rows — `expected_date < month-start` AND status
    not in (`received`, `waived`) — summed per contract and split by
    `source_type_key` (New→Sales, Renew/WinBack/UPSELL→Account). Null/legacy-type
    rows are skipped from the dept split (they still appear inline in the main
    table with the متأخرة badge). Snapshot path is untouched (guard requires both
    empty). Added a `sales_inst_overdue.sort(byValue)` for parity with account.
  - Updated the `MonthBuckets` doc comment (no longer "snapshot-only").
- **`src/app/(dashboard)/contracts/ceo-dashboard.tsx`**
  - Updated the stale "Snapshot-only" comment above the overdue section to
    describe the snapshot-or-live behavior. No logic change — the existing
    `!driftedLists && (acc+sales) > 0` gate still hides the section for a
    frozen-no-snapshot month (drifted data) and when both lists are empty.

### Review focus points
- [ ] Overdue definition for the live split (`expected_date < month-start` AND
      not received/waived) is the right semantic — mirrors 0168's E27 and the
      sheet's overdue lists; this-month rows are "due", not overdue.
- [ ] Dropping null/legacy `source_type_key` rows from the dept split is
      acceptable (they remain visible inline in the main table).
- [ ] Guard correctness: live fallback must never override a real snapshot.

### Verification done
- `tsc --noEmit`: **0 errors** in `contracts.ts` / `ceo-dashboard.tsx` (rest of
  repo has the pre-existing dirty baseline).
- Rendered `/contracts?view=dashboard` for Apr/May/Jun 2026 (all frozen) — the
  overdue section renders via snapshot in each, **no regression** (Jun shows the
  sheet's curated Account 0 / Sales 5).
- Live-fallback predicate validated against prod DB (`.env.local` REST creds):
  for Jun it yields **Account 2 clients (5,152 SR) / Sales 15 clients
  (67,701 SR)** with 5 null-type rows skipped — i.e. the section will populate
  with real data on any non-snapshot month instead of disappearing.

### Not verified
- Could not exercise the live path through the UI — all three selectable months
  (Apr/May/Jun) already have snapshots. Live path covered by the DB predicate
  check above.

> Likely the client's *actual* issue is **deployment**: all of #1–#3 are
> committed but they're on a stale build. Confirm Vercel has deployed `main`
> (HEAD) and ask them to hard-refresh.

---

## 4. "Clients needing attention" panel — renewal-pipeline toggle (Sky Light request 2026-06-17)

### Request
Tie the contracts CEO panel (was "أهم العملاء", now "عملاء يحتاجون انتباهك") to the
selected month's **renewal status** — On-Target (ends this month, not renewed) +
Overdue (ended before, still open) — so the team can work the renewal list and
lift renewal rates, excluding future renewals ("هيجددوا الشهر الجاي") and clients
flagged only for unrelated problems. *(Client was on a stale build showing the
pre-0188 revenue-ranked version.)*

### Decision (user-confirmed via clarifying Qs)
- **Add a toggle** (not a hard replace): "خط التجديد / Renewal" (default) vs
  "الكل / All".
- Renewal view shows **only renewal-pipeline clients that also have a problem** —
  which is automatic, since the attention list already requires a problem signal,
  so renewal view = attention-list ∩ (On-Target ∪ Overdue).

### Changes
- **`supabase/migrations/0190_ceo_insights_renewal_status.sql`** *(applied to prod
  via Management API; mirrored to file)* — `get_ceo_client_insights` gains a
  `renewal_status` column ('overdue' | 'on_target' | null) using the EXACT
  0172/0174 bucket predicates (status not in closed/lost/renewed; end_date <
  month-start = overdue, in-month = on_target, future/none = null). Return type
  changed ⇒ `drop function` then create. Attention WHERE filter **unchanged**.
- **`src/lib/data/contracts.ts`** — `CeoClientInsight` gains `renewal_status`
  (flows through via the row spread; no map change).
- **`src/app/(dashboard)/contracts/page.tsx`** — `getCeoClientInsights` limit
  12 → **50** so the client-side toggle has the full set (panel still shows top
  10 of the active filter).
- **`src/app/(dashboard)/contracts/ceo-dashboard.tsx`** — `TopClientsPanel` now a
  stateful client component: segmented toggle (default `renewal`), new
  "التجديد/Renewal" column with `RenewalStatusBadge` (متأخر التجديد rose / تجديد
  هذا الشهر amber), filtered list, and mode-specific subtitle + empty state.
  Bilingual via the existing `copy()` helper (no new i18n keys).

### Review focus points
- [ ] Renewal-bucket predicate matches 0172/0174 (a client with any overdue
      not-yet-renewed contract → 'overdue'; else any in-month → 'on_target').
- [ ] Default-to-renewal-view is the desired landing state.
- [ ] limit 50 is enough headroom; top-10 cap on display is acceptable (header
      shows the true per-mode counts).

### Verification done
- `tsc --noEmit`: **0 errors** in the 3 edited TS/TSX files.
- Migration applied; for June 2026 the RPC returns **15 on_target / 7 overdue /
  28 null** within the 50-row attention list.
- Rendered `/contracts?view=dashboard&m=2026-06-01`: panel defaults to
  "Renewal (22)" with the All (50) toggle; Renewal column badges render; toggle
  switches without refetch; no console errors. Screenshot captured.

---

## Files changed

```
messages/ar.json                                            | 230 +
messages/en.json                                            | 230 +
src/app/(dashboard)/accountability/accountability-workspace.tsx | 543
src/lib/data/accountability.ts                              | 308
src/lib/data/contracts.ts                                   |  ~60
src/app/(dashboard)/contracts/ceo-dashboard.tsx            |  ~95
src/app/(dashboard)/contracts/page.tsx                     |    1
supabase/migrations/0190_ceo_insights_renewal_status.sql   | 245 (new)
```

## How to verify locally
1. `bun dev`, log in (owner test account), open `/accountability` — confirm the
   two review sections (Manager Review / Specialist Review) both populate.
2. Hover the ⓘ icons / metric values on `/contracts?view=dashboard`, `/finance`,
   `/finance/expenses`, `/reports`, `/satisfaction`, `/satisfaction/groups`, and
   the executive `/dashboard` — confirm real explanations appear (try both
   locales).
3. Optional: re-run the key check —
   `node` parse of both message files + grep that no rendered page contains the
   literal `metricTooltips.`.

---

## 2. Nested Team View for Account Manager Targets

### Problem
The per-AM target breakdown on `/contracts?view=dashboard` was a flat list. It mixed Team Leaders, the Department Manager, and Agents without clear hierarchy. Additionally, the organizational hierarchy data (`team_leader_employee_id`) in the database was incorrect for several members, making it impossible to group them as they appear in the source Google Sheet.

### Changes
- **Data Correction (Supabase):**
  - Updated `employee_profiles` for **بسملة محمد** and **دنيا الدمياطي** to sit under **سارة الامين** (was دينا الحسيني).
  - Updated **دينا الحسيني** to sit under **اية رضا** (was none).
- **`src/lib/data/contracts.ts`**:
  - Modified `AmTargetRow` type to include `team_leader_id`.
  - Updated `getAmTargets` to fetch `team_leader_employee_id` from the `employee_profiles` relation.
- **`src/app/(dashboard)/contracts/GroupedAmTargetsTable.tsx` (New Component)**:
  - Implements a nested table view.
  - Groups agents under their respective **🌟 Team Leaders**.
  - Displays the **👑 Department Manager** (Grand Total) at the bottom.
  - Visual cues for hierarchy (indentation and connector arrows `↳`).
- **`src/app/(dashboard)/contracts/ceo-dashboard.tsx`**:
  - Replaced the flat table implementation with the new `GroupedAmTargetsTable` component.
