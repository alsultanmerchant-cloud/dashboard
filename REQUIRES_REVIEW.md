# REQUIRES_REVIEW — uncommitted work pending AI audit

Audience: the AI auditor agent. This file lists everything in the current working
tree that is **not yet committed** and should be reviewed before commit. Two
distinct bodies of work are stacked here:

- **Part E — Satisfaction brief-adherence breakdown + contracts May/April re-freeze** (this session). Newest.
- **Part D — Agents-only performance tables**.
- **Part C — UI/UX consistency: toolbar/search-filter standardization + contracts filter redesign**.
- **Part A — Kanban true column totals + balanced loading** (tasks board).
- **Part B — Contracts dashboard fixes** (previous agent's session). See also
  [`docs/HANDOVER_CONTRACTS_SESSION.md`](docs/HANDOVER_CONTRACTS_SESSION.md).

Everything below is **uncommitted**. All DB migrations referenced are **already
applied to prod** (org `rawasm-demo`, single-tenant) via the Supabase Management
API; the `.sql` files mirror what was applied.

> How to verify (team convention): query Supabase with `.env.local` creds
> (REST read via `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; DDL via
> Management API), **not** the Supabase MCP. UI default locale is English
> (intentional). Preview behind auth — test owner `alsultain@agency.com` /
> `alsultain22`.

---

## Part A — Kanban true column totals + balanced per-column loading

### Problem being solved
The global `/tasks` kanban only loads a slice of cards (was 120) and rendered each
column header as `tasks.length` (the *loaded* count). Two defects:
1. **Wrong header counts** — e.g. the "New" column showed `117` instead of the true
   `517` matching tasks in the filtered set.
2. **Lopsided columns** — the loaded slice was the newest-N globally
   (`order by created_at desc`), so the newest tasks all piled into one or two
   buckets (e.g. `new=104`) while every other column showed 0–1 cards.

### Changes (two concerns, three migrations)

**Concern 1 — true per-column totals for ALL group-by modes.**
- **Migration 0191** (`0191_list_tasks_bundle_group_rows.sql`): `list_tasks_bundle`
  now also returns `group_rows` — a lightweight array of grouping keys for **every**
  task in the filtered set (not just the paged window). Each entry carries only the
  fields the client's `bucketTasksBy` reads, **with the same field names as a
  BoardTask**, so the client buckets them with the *same* code as the loaded cards.
  This yields exact totals for every group-by — including local-timezone date
  buckets and multi-valued assignee/tag membership that a SQL `GROUP BY` could not
  reproduce. (Supersedes migration 0190's stage-only `stage_counts` — see collision
  note below.)
  - `tags` in `group_rows` are **project** tags, matching what the global board's
    cards expose (`listBoardTasksFromRows` maps `tags: t.tags` = project tags).
  - `role_slots` is keyed by `role_type` via `distinct on (role_type)` to mirror the
    card's last-writer-wins object and avoid duplicate-key aggregation errors.
- Client: `bucketTotals` memo in `task-board.tsx` runs `bucketTasksBy(groupingRows
  ?? tasks, outerKey)` and feeds each column header a `total` prop. Header renders
  `total > loaded ? total : loaded`, so a fully-loaded project board (where loaded
  is already true) keeps live drag-and-drop counts.

**Concern 2 — balanced per-column initial load.**
- **Migration 0192** (`0192_list_tasks_bundle_balanced.sql`): adds
  `p_partition_by` + `p_partition_limit`. When set, the paged window returns the
  newest `p_partition_limit` **per bucket** (window `row_number() over (partition
  by <whitelisted expr> order by created_at desc)`) instead of the global newest-N.
  - Whitelist (switch on `p_partition_by`, value only selects a CASE branch — **no
    interpolation, no injection**): `stage / priority / status / progress / service /
    project / customer`. Unknown/null → flat load (single `__all__` partition →
    identical to the old behavior).
  - **Drops the prior function overload first** — adding params changes the
    signature, and a coexisting overload would cause PostgREST PGRST203 ambiguity.
- `BALANCEABLE_PARTITIONS` map (in `tasks.ts`) sets per-bucket caps (40 for
  low-cardinality dims; 12–15 for project/service/customer to bound payload) and the
  group-key → partition-field mapping. `BALANCED_BOARD_LIMIT = 600` caps total cards.
- Multi-valued (assignee/tags) and client-tz date group-bys are intentionally
  **excluded** from balancing → they fall back to a flat (paged) load.

**Load-more semantics (balanced mode).** Flat offset paging would skip/duplicate in
balanced mode (the loaded set is not a flat newest-prefix). So balanced "load more"
**grows the per-bucket cap and REPLACES** the board (`tasks-infinite-view.tsx`:
`boardPartition` prop + `partitionLimit` state). Non-balanced board load-more keeps
appending, with an id-dedupe safety net. The API route (`api/tasks/route.ts`) accepts
`partitionBy` + `partitionLimit` (re-validated against `BALANCEABLE_PARTITIONS`) and
raises the board limit ceiling to 2000.

### Files touched (Part A)
| File | Change |
|---|---|
| `supabase/migrations/0191_list_tasks_bundle_group_rows.sql` | RPC returns `group_rows` |
| `supabase/migrations/0192_list_tasks_bundle_balanced.sql` | RPC `p_partition_by`/`p_partition_limit`, drops old overload |
| `src/lib/data/tasks.ts` | `group_rows` plumbing, `BALANCEABLE_PARTITIONS`, `BALANCED_BOARD_LIMIT`, partition params on `fetchTaskBundle`/`listBoardTasksPage` |
| `src/app/(dashboard)/tasks/_loaders.ts` | thread `groupRows` + `partition` through `loadTaskBoardPageForGlobalView` |
| `src/app/(dashboard)/tasks/page.tsx` | compute partition from `groupBy[0]`, pass `groupingRows` + `boardPartition` |
| `src/app/(dashboard)/tasks/tasks-infinite-view.tsx` | `groupingRows`/`boardPartition` props, grow-cap-replace load-more, append dedupe |
| `src/app/(dashboard)/projects/[id]/task-board.tsx` | `bucketTotals` memo, `total` prop on StageColumn/ProjectColumn/BucketColumn/NestedColumn |
| `src/app/api/tasks/route.ts` | accept `partitionBy`/`partitionLimit`, board limit ceiling 2000 |

### Invariants / things to check
- **`group_rows` field names must stay in sync with what `bucketTasksBy` reads.** If
  a new group-by dimension is added to `bucketTasksBy`, the RPC must emit the field
  it reads, or that dimension's totals silently fall back to loaded counts.
- **`group_rows.tags` = project tags** (not task tags) — deliberately matches the
  global board's `listBoardTasksFromRows`. Don't "fix" to task tags without changing
  both.
- **Partition whitelist is security-sensitive**: the RPC `case` and the API
  `BALANCEABLE_PARTITIONS` guard must agree; never interpolate `p_partition_by`.
- **Nested (stacked) group-by**: only the OUTER column header uses true totals; inner
  sub-section counts remain loaded-based (documented in `NestedColumn`).

### Verification status (Part A)
- ✅ **True totals** verified live in preview across representative modes:
  stage (sum 667; New 517), priority (medium 666 / 48 loaded), assignee
  (multi-valued, per-person totals; sum 688 from overlap — expected), deadline
  (local-tz, sum 667).
- ✅ **Balanced initial load** verified: stage columns now `new=40, in_progress=40,
  done=40, client_changes=29, sent_to_client=23, specialist_review=19,
  ready_to_send=8, manager_review=3` (every column populated) vs the old
  `new=104, others 0–1`. RPC-level diff also confirmed via Management API.
- ⚠️ **Grow-cap "load more" (balanced) not yet end-to-end verified in preview** — the
  code path is implemented but the click-through was interrupted. **Auditor: please
  verify** that clicking the kanban "load more" in a balanced mode (e.g. stage) grows
  per-column cards without duplicate React keys and that `hasMore` converges to false.
- ℹ️ Console shows **pre-existing** nested-anchor hydration errors (a `/projects`
  `<a>` nested inside the card's `/tasks` `<a>` in `TaskCard`) — unrelated to this
  work, already flagged as a separate task.

### Known risks / tradeoffs (Part A)
- **Payload**: `group_rows` adds ~330 KB (default view) to ~900 KB (all-tasks filter)
  to the RSC payload. Acceptable for this internal desktop tool; flag if trimming is
  wanted (e.g. only emit fields for the active group-by).
- **Balanced load for high-cardinality dims** (project/customer with many buckets):
  per-bucket cap is small (12) and total is capped at 600/2000; this biases toward
  buckets with recent activity rather than a perfectly even spread.

---

## Part B — Contracts dashboard fixes (previous agent, session 2026-06-17)

Full detail in [`docs/HANDOVER_CONTRACTS_SESSION.md`](docs/HANDOVER_CONTRACTS_SESSION.md).
Summary of what to review (all migrations applied to prod; code uncommitted):

| Area | Migration | Summary |
|---|---|---|
| Grid status filter | — | Filter on `contract_status_label` (not the derived enum); added SOON/Renewal-Soon chip. Grid = 85 live / 199. (`contracts-grid.tsx`, `messages/{ar,en}.json`) |
| Stale sheet rows | **0186** `contract_sheet_present.sql` | `contracts.sheet_present` flag; importer flips absent sheet rows to false; grid filters `sheet_present=true`. Backfilled 15 stale rows. |
| CEO roster parity | **0187** `contracts_roster_sheet_parity.sql` | `get_contracts_roster` current-client = `sheet_present AND label NOT ILIKE 'Closed%'` → 85. |
| "Clients needing attention" panel | **0188** `ceo_client_insights_attention.sql` | `get_ceo_client_insights` re-scoped to real signals, ordered by severity. New `ExperiencePill` mirrors the satisfaction page tiers EXACTLY. **Invariant:** keep `ExperiencePill` tiers in sync with `satisfaction-workspace.tsx`. |
| Installment source-type autofill | **0189** `installments_source_type_autofill.sql` | trigger `fill_installment_source_type` fills `source_type_key` from contract revenue type when null (honors `type_before_hold`); + backfill. Fixes missing Sales/Account pill and dropped income totals. |
| Installments-due list (next-task) | — | `getMonthTargetBuckets()` widened to include still-owed overdue carryover. `/contracts?view=dashboard` "Installments due" now ~34 (was 10). Code-only, `src/lib/data/contracts.ts` ~line 488. |
| Also touched | **0185** `contract_sheet_client_name.sql` | row-level sheet client name (pre-existing in tree). |

Code files (Part B): `contracts-grid.tsx`, `ceo-dashboard.tsx`,
`src/lib/data/contracts.ts`, `src/lib/import/commit-contract-import.ts`,
`src/lib/supabase/types.ts`, `messages/ar.json`, `messages/en.json`, plus the new
component `src/components/metric-info.tsx` and other modified files visible in
`git status` (accountability, ceo-brief, dashboard-assistant, task-board for
contracts, etc.).

### Verification status (Part B)
Per the handover, all five issues + the next-task were verified live in preview by
the previous agent. The auditor should spot-check the headline numbers against the
live sheet (85 live contracts / 199 rows; installments-due ~34).

---

## Part C — UI/UX consistency: toolbar/search-filter standardization (this session, 2026-06-17)

**No DB migrations** — all code-only, no schema/RPC changes.

### Problem being solved
A UI/UX audit found search + filter controls were inconsistent across the dashboard:
5+ bespoke toolbar styles, raw `<input>/<select>` on some pages, local-state filters
that lose state on refresh, mixed URL/local state, and the same chip filter
reimplemented 4 ways. The **project-management section (Tasks/Projects) toolbar is the
team-approved canonical pattern**; this work begins standardizing toward it
("foundation first → visual + behavior parity"). A shared `FilterBar` already existed
but was used only in the dev showcase (`src/app/dev/design-system/page.tsx`).

### Changes

**Phase 0 — shared primitives (the missing layer):**
- **`src/lib/use-url-filters.ts`** (NEW) — wraps the copy-pasted
  `useSearchParams + useRouter + URLSearchParams` boilerplate. API: `get`,
  `set({k:v})`, `setDebounced` (350ms, matches the codebase), `clear([keys])`,
  `searchParams`. Optional `resetPageKeys` resets pagination on filter change.
- **`src/components/filter-chip.tsx`** (NEW) — canonical pill: cyan-dim active /
  soft inactive, `as="link" | "button"` variants, optional `count` badge. Replaces
  the 4-way hand-rolled chip duplication.
- **`src/components/view-switcher.tsx`** (NEW) — generic, config-driven, URL-synced
  view toggle mirroring the Tasks switcher (the Tasks-specific one stays separate
  because of its default-view-per-context logic). Not yet adopted by a page.
- **`src/components/filter-bar.tsx`** (MODIFIED) — added a `trailing` slot
  (count / view-switcher, pinned inline-end). **Fixed a latent RTL bug**: the search
  icon used `rtl:right-2.5 ltr:left-2.5` (start side) but padded `rtl:pe-8 ltr:ps-8`
  (end side), so in RTL the placeholder overlapped the icon. Now `start-2.5` + `ps-9`
  (logical, both directions correct).

**Phase 1 — page migrations:**
- **`src/app/(dashboard)/contracts/logs-view.tsx`** — native `<select>`/
  `<input search>`/`<input date>` → shadcn `Select` + `Input`; ~40 lines of URL
  boilerplate → `useUrlFilters`; Clear button now disables when no filters active;
  search icon RTL fix (`start-2.5` + `ps-9`). The manager `Select` uses
  `alignItemWithTrigger={false}` + `max-h-72` so the dropdown drops straight down
  (base-UI's default overlays the selected item on the trigger and clips options).
  Colored per-log-type chips kept as-is (intentional semantic color).
- **`src/app/(dashboard)/accountability/accountability-workspace.tsx`** — search +
  role filter adopt `FilterBar` + `FilterChip`. **Filtering stays client-side**
  (instant) because `getAccountabilityOverview` is an expensive live-compute that
  already loads every row — re-running it per keystroke would be wrong. State is
  mirrored to the URL via `window.history.replaceState` (shareable + refresh-safe,
  **no** server re-render) and seeded from `searchParams` on mount.
- **`src/app/(dashboard)/notifications/notifications-list.tsx`** — `unread` filter
  moved from local `useState` into the URL (`?unread=1`), fixing the mixed
  category-in-URL / unread-in-local state. All + Unread chips → `FilterChip`. This
  list is light, so URL navigation (server re-render) is acceptable here (unlike
  accountability).

**Contracts table filter redesign (user-driven, separate from the audit):**
- **`src/app/(dashboard)/contracts/contracts-grid.tsx`** — the `ChipGroup` filter
  strip on `/contracts` (table view) had a real bug: options sat in
  `overflow-x-auto scrollbar-hide`, so any option past the column width scrolled off
  with **no visible scrollbar** → "options all hidden". Final design (after a few
  iterations with the user): each group is a full-width row of **spaced rounded pills**
  (no dividers), active = cyan-dim, options **wrap** instead of clipping; the four
  short groups (TARGET/STATUS/TYPE/PAYMENT) pack **two-per-row** on `xl` while PACKAGE
  (many options) keeps its own full-width row. Saves vertical space, nothing hidden.

### Files touched (Part C)
| File | Change |
|---|---|
| `src/lib/use-url-filters.ts` | NEW — shared URL-filter hook |
| `src/components/filter-chip.tsx` | NEW — canonical chip (link/button + count) |
| `src/components/view-switcher.tsx` | NEW — generic URL-synced view switcher (unused so far) |
| `src/components/filter-bar.tsx` | `trailing` slot + RTL search-icon padding fix |
| `src/app/(dashboard)/contracts/logs-view.tsx` | shadcn Select/Input + useUrlFilters, Clear-disabled, Select drop-down fix |
| `src/app/(dashboard)/accountability/accountability-workspace.tsx` | FilterBar/FilterChip + URL mirror via history.replaceState |
| `src/app/(dashboard)/notifications/notifications-list.tsx` | unread filter → URL, FilterChip adoption |
| `src/app/(dashboard)/contracts/contracts-grid.tsx` | ChipGroup: fix hidden-options overflow → wrapping pill rows, 2-per-row packing |
| `src/app/(dashboard)/accountability/accountability-workspace.tsx` | remove CoveragePanel; rework AiLinkedSection → per-client latest complaint + Today/This-week toggle |
| `messages/en.json`, `messages/ar.json` | new `AccountabilityPage.ai` complaint/window keys |

### Invariants / things to check (Part C)
- **Toolbar standard**: new list pages should start from `FilterBar` + `FilterChip` +
  `useUrlFilters`, not a blank toolbar div (see memory `project_toolbar_standard`).
- **Accountability URL mirror** deliberately uses `history.replaceState` (NOT
  `router.replace`) to avoid re-running the expensive engine; `useSearchParams` won't
  re-render on those updates — local state is the source of truth by design.
- **Search-icon pattern**: icon on `start-2.5`, input padding `ps-9` (logical
  properties) — don't reintroduce `rtl:pe-8`/physical sides.
- **logs-view `Select` value mapping**: `"__all__"` sentinel maps to the
  "all managers" label via a `SelectValue` render fn (base-UI shows the raw value
  otherwise).

### Verification status (Part C)
- ✅ **logs-view** verified live in preview in **EN and AR/RTL** — toolbar renders,
  Select shows "All managers", chip toggle updates URL, Clear disables correctly,
  search icon no longer overlaps in RTL. No console errors; `tsc` clean.
- ✅ **contracts-grid** filter redesign saved + `tsc` clean. **Not** screenshot-verified
  (preview lost its auth session, then folder access was revoked — see note). User was
  iterating against it live and approved the final pill-row layout.
- ⚠️ **accountability** + **notifications** migrations: `tsc` clean but **NOT visually
  verified** (preview auth + later an OS-level folder-permission revocation blocked
  the click-through). **Auditor: verify** filter state survives refresh and round-trips
  through the URL on both pages.

### Accountability rework (DONE — applied after folder access restored)
Both previously-pending items are now implemented in `accountability-workspace.tsx`:
1. ✅ **Removed** the `CoveragePanel` (نطاق التغطية) and its now-unused function; the
   `ReviewerRigorSection` takes full width (the wrapping `lg:grid-cols-2` div is gone).
   `overview.coverage` is still consumed by the head-stats overdue count.
2. ✅ **Reworked `AiLinkedSection`** → client-complaints view: shows the **latest
   `kind==="complaint"` per client** (keyed by `clientId ?? clientName ?? id`) within a
   **Today / This week toggle** (client-side `useMemo`, `range` state defaulting to
   "week"), sorted newest-first. **Dropped the related-tasks block entirely** (the
   task↔complaint linkage was unreliable). Card = client · date · quote · source.
   Removed the now-unused `KIND_TONES`/`KNOWN_KINDS` consts.
   - New i18n keys (EN + AR) under `AccountabilityPage.ai`: `complaintsTitle`,
     `complaintsHint`, `windowToday`, `windowWeek`, `emptyComplaints`. Old keys
     (`title`/`hint`/`empty`/`relatedWork*`) left in place (harmless).
   - ⚠️ `tsc` clean but **not visually verified** (preview at login wall). The `range`
     window uses `new Date()` in a `useMemo`; windows are coarse (day / 7-day) so
     server/client hydration produces the same set in practice — **auditor: glance for
     any hydration warning near midnight.**

Remaining audit migrations also still open: Clients, Sales Leads, Escalations
(→ `FilterChip` + `FilterBar`, add search to Clients/Leads), Satisfaction wrap, i18n
placeholder sweep, and a "Toolbar pattern" note for `CLAUDE.md`.

### Note — mid-session folder lock
Toward the end of the session macOS revoked the host app's access to
`~/Documents/projects/mr-dashboard` (every path under it returned
`Operation not permitted`; paths outside read fine — classic TCC Documents-folder
revocation). All Part C edits above were **saved to disk before** the revocation; the
two "Pending" items were never written. If files look off, confirm access is restored
(System Settings → Privacy & Security → Files and Folders / Full Disk Access).

---

## Part D — Agents-only performance tables (this session, 2026-06-17)

**No DB migrations** — code-only (a `positions.is_leadership` column was the cleaner
design but the prod-DDL classifier blocked it; implemented as code predicates).

### Problem
A department manager (احمد حبيب, position "مدير القسم التقني") appeared in the
Reviewer-rigor comparison. The team wants every table that RANKS/COMPARES employees
by performance to show individual contributors only. **Decision (user): exclude all
leadership** = dept managers + CSO + team leads (قائد الفريق) + supporting leads; KEEP
account managers (مدير الحساب), specialists, executors. Scope: **all performance tables**.

### Key gotcha
`positions.role` is NOT a seniority signal — it encodes the task-attribution role, so a
dept manager can carry `role='specialist'` (احمد حبيب is exactly this). Leadership is
therefore matched by `role in ('manager','team_lead','supporting_lead')` **OR** position
NAME in the dept-manager/CSO list. NOTE: مدير الحساب (account manager — kept) ≠ مدير قسم
إدارة الحسابات (account-dept manager — excluded). Verified against live data: exactly 28
people excluded, all individual contributors kept.

### Changes
- **NEW `src/lib/data/leadership.ts`** — single source of truth:
  `nonLeadershipFilter(alias)` (raw-SQL predicate, null-position = kept),
  `isLeadershipPosition(pos)` (JS, for PostgREST embeds), `LEADERSHIP_POSITION_NAMES`.
- **`src/lib/data/accountability.ts`** — scorecard query + BOTH reviewer-rigor queries
  (stage-history `buildStageReviewerSql` and gate-based `loadManagerReviewers`) join
  `positions` and apply `nonLeadershipFilter`.
- **`src/lib/data/reports-extras.ts`** — `getSpecialistLoad`, `getDesignerMonthlyOutput`
  embed `position:positions(role,name)` and skip leadership; + new `getLeadershipNameSet`.
- **`src/lib/data/executive.ts`** — `getSpecialistLoadTop`, `getPerformerLeaderboard` skip
  leadership.
- **`src/lib/data/activity-scores.ts`** — `getTeamActivityOverview` skips leadership.
- **`src/app/(dashboard)/reports/page.tsx`** — Odoo People Board has no position data, so
  the leaderboard is filtered by NAME against `getLeadershipNameSet` (Odoo res.users.name
  ↔ Supabase full_name; exact-after-trim). `OdooSections` now takes `orgId`.

### Files touched (Part D)
| File | Change |
|---|---|
| `src/lib/data/leadership.ts` | NEW — shared leadership predicate (SQL + JS) |
| `src/lib/data/accountability.ts` | scorecard + 2 reviewer queries exclude leadership |
| `src/lib/data/reports-extras.ts` | specialist-load + designer-output skip leadership; `getLeadershipNameSet` |
| `src/lib/data/executive.ts` | specialist-load-top + performer-leaderboard skip leadership |
| `src/lib/data/activity-scores.ts` | team-activity skips leadership |
| `src/app/(dashboard)/reports/page.tsx` | Odoo People Board filtered by name set |

### Invariants / risks (Part D)
- **Manager Review collapses to ~2 rows.** It credits the assigned team_manager, and those
  are almost entirely leads/DMs (verified: 9 team-leads + 2 dept-managers + احمد حبيب +
  1 account-dept-manager excluded; only 1 account-manager + 1 no-position remain). Faithful
  to "exclude all leadership" but the section is now sparse — **auditor/team: decide whether
  to keep team-leads in Manager Review or hide the section.**
- **Odoo People Board uses NAME matching** (no position data in Odoo) — fragile across
  Odoo↔Supabase. A name that doesn't match exactly (after trim/space-collapse) won't be
  filtered. Consider mapping Odoo user → employee_profiles.external_id for robustness.
- **Null-position employees are KEPT** (unknown ≠ leadership) — intentional.
- ⚠️ **Not visually verified** (preview at login wall). `tsc` clean for all touched files;
  the pre-existing repo-wide `tsc` errors (escalations/projects/renewals/scripts) are
  unrelated.

---

## Part E — Satisfaction brief-adherence breakdown + contracts May/April re-freeze (this session, 2026-06-17)

Two unrelated bodies of work in this session. **E1** is a data-only operation (no
code shipped except a helper script); **E2** is a feature touching schema, prompt,
DB, data layer, UI, and the dashboard assistant.

### E1 — Contracts dashboard: re-froze May & April from the sheet (data + 1 script)

**Problem.** `/contracts?view=dashboard` showed a wrong **May 2026** — the row was
frozen on **2026-06-08** from a stale early version of the sheet (before the
2026-06-14..16 parser fixes). The dashboard only ever stores ONE month's
sheet-computed numbers per pull, and the sheet's month is controlled by
`CEO_Dashboared!G8` (a literal "Jun" feeding `X1 = DATE(I8, MATCH(G8,{Jan..Dec},0),1)`)
which is **owner-locked** on the production sheet (non-owner edits revert).

**What was done.**
- The user made an **owner copy** of the real sheet (no IMPORTRANGE → it recomputes
  internally) and set `G8` to May, then April, sharing it Anyone-with-link.
- New helper **`scripts/freeze-sheet-month.mjs`** (NOT wired into the app) re-runs the
  exact freeze path standalone: downloads the workbook, reuses the REAL parser
  (`src/lib/import/parse-sheet-dashboard.ts`), and replicates
  `commit-sheet-dashboard.ts` via Supabase REST. Run with
  `bun --conditions react-server scripts/freeze-sheet-month.mjs --write --expect=<YYYY-MM-01> --sheet=<COPY_ID>`.
  - `--conditions react-server` is REQUIRED so the `server-only` import resolves to its
    empty shim instead of throwing.
  - `--expect` guards against writing the wrong month; `--sheet` overrides the prod sheet id.
- **Re-froze May** (`monthly_dashboard_totals`/`monthly_target_snapshot`/`am_targets`,
  `source='sheet_import'`, `is_frozen=true`): on_target 34 / overdue 6 / sales_deposit 78 /
  actual 105,065.52 / expected 192,143 / ach 54.68%. 78 bucket rows, 0 unmatched, 14 AMs.
- **Froze April** (`2026-04-01`): on_target 29 / overdue 6 / sales_deposit 93 / actual
  141,179 / expected 160,690 / ach 87.86%. 67 bucket rows, 14 AMs. **Verified the rendered
  dashboard matches the sheet** for both months (tile-by-tile).

**⚠️ Drift fallback added to the SCRIPT ONLY (review for parity).** April (2 months back)
orphaned 14 of 67 bucket `Key`s — contracts that renewed since carry a later key, so the
exact `C##|YYYYMMDD` no longer exists in our `contracts.external_id`. Symptom: the
Renewal-Funnel renewed/lost numerator reads `buckets.renewed.length`
(`ceo-dashboard.tsx:415`), so an incomplete snapshot rendered **"1/35" instead of "8/35"**
and the `driftedLists` warning did NOT fire (it only triggers when no snapshot exists, not
when one is incomplete). `scripts/freeze-sheet-month.mjs` now adds a **client-code fallback**:
when the exact Key is gone, map to that client's CURRENT contract via the `C##` prefix →
`clients.external_id` (latest `start_date`), dedup on `(contract_id,bucket)`. Recovered all
14 → funnel correct. **The production `commit-sheet-dashboard.ts` does NOT have this
fallback** — left as-is because the in-app "Pull from Sheet" button only ever pulls the
owner-locked CURRENT month (drift ≈ 0). Auditor: decide whether to port the fallback into
`commit-sheet-dashboard.ts` for symmetry, or keep it script-only.

**Known limitation (pre-existing, not introduced):** the roster strip (`cnt_roster_*`) is the
sheet's point-in-time "Today" overview, not month-filtered — a past-month freeze stores
today's roster as that month's. Documented to the user.

### E2 — Satisfaction: brief-adherence now explains itself (`/satisfaction`)

**Problem (client-reported).** The **الالتزام بالبريف (brief adherence)** gauge showed a bare
number (e.g. 40) with no explanation of WHICH brief requirements were unmet, and the
"مساعد الموجز" assistant couldn't answer "why 40?" — it had no per-item data. Root cause:
`briefAdherenceScore` was stored as a lone 0-100 int; the analysis prompt already reasons
per brief clause ("link any reduction to a specific brief item") but that reasoning was
**discarded**. Brief adherence is real and well-populated (47/75 current analyses have a
score; Busu's is backed by a shared Google Doc), so the user chose **fix** over remove.

**Files changed.**
- **`supabase/migrations/0195_brief_adherence_breakdown.sql`** — `alter table
  client_satisfaction_analyses add column brief_adherence jsonb` (APPLIED to prod via
  Management API; file mirrors).
- **`src/lib/satisfaction-schema.ts`** — added nullable `briefAdherence` object:
  `{ reason: string, items: [{ requirement, status: delivered|partial|not_delivered|no_evidence, note }] }`.
- **`src/lib/satisfaction-analyze.ts`** — prompt now asks for the per-item breakdown when a
  brief exists (else null); null-guard `if (!brief) result.briefAdherence = null`; stores
  `brief_adherence`.
- **`src/lib/data/satisfaction.ts`** — `brief_adherence` added to `ANALYSIS_COLUMNS` and
  mapped into `AnalysisInfo.briefAdherence` (the interface extends `SatisfactionResult`, so
  the field flows through automatically).
- **`src/app/(dashboard)/satisfaction/satisfaction-workspace.tsx`** — new `BriefAdherencePanel`
  rendered under the gauge (only when `analysis.briefAdherence` is non-null): score chip,
  per-status counts, the reason line, and each requirement with a colored status badge + note
  (sorted not_delivered → partial → delivered → no_evidence). New lucide imports
  `XCircle, MinusCircle, HelpCircle, ClipboardList`.
- **`messages/ar.json` + `messages/en.json`** — added `SatisfactionPage.briefBreakdown.*`
  (title/empty/status labels). **Both files validated as parseable JSON.**
- **Assistant grounding** — `src/components/executive/dashboard-selection-assistant.tsx`
  now reads `?client=` (via `useSearchParams`) and passes `clientId` in the request body;
  `src/app/api/dashboard-assistant/route.ts` accepts `clientId` and, when
  `page.includes('/satisfaction')`, loads that client's current analysis
  (`brief_adherence` + score + summary) into the system context so the assistant answers
  from real per-requirement data instead of guessing.

**Verification status.**
- ✅ `bunx tsc --noEmit` — **0 errors in any changed file** (the ~57 repo-wide errors are
  pre-existing/unrelated: untyped `supabaseAdmin` → `GenericStringError`, React-19 transition
  typings, `searchParams` `{}` — none in our files).
- ✅ Re-analyzed Busu; `brief_adherence` jsonb populated (reason + 6 items with statuses).
- ✅ **Rendered the panel** (`?analysis=<id>` to view the new snapshot): "Why this score? —
  brief requirement breakdown · 55% · 1 Delivered / 4 Partial / 1 Not delivered" with the
  reason line and per-item badges + notes. Screenshot captured.
- ✅ Assistant API returns 200 and answers **scoped to the named client** (proves grounding
  wired). It currently says "no saved breakdown — please re-analyze" because Busu's
  `is_current` analysis is the stale 2026-06-08 `all`-window row (no breakdown); the new
  breakdown lives on a non-current `all` snapshot.

**⚠️ Open item the auditor/team must close.** `is_current` is set **only for weekly runs**
(`analyze ... isCurrent = windowKind === "week"`). Busu's current analysis is an unusual
`all`-window row, so re-running `all` did NOT replace the headline. A **weekly** re-analyze
(the daily cron's normal path) becomes current AND now carries the breakdown — i.e. the
feature self-populates org-wide on the next weekly cycle. A weekly re-analyze for Busu was
**fired but interrupted before confirmation** — re-run it (or wait for the cron) to make
Busu's live gauge + assistant show the breakdown. No backfill of `brief_adherence` exists
for historical rows (by design: it regenerates on next analysis).

**Pre-existing bug noticed (NOT mine, NOT fixed):** `satisfaction-workspace.tsx:121` does
`useTranslations("TasksPage.stages")` but `TasksPage.stages` is **missing in both
`ar.json` and `en.json`** → floods the console with `MISSING_MESSAGE` IntlErrors (non-fatal;
next-intl falls back). Worth a follow-up.

---

## ⚠️ Migration numbering collision (action needed)

There are **two different `0190` migrations** in `supabase/migrations/`:
- `0190_ceo_brief_dismissed_risks.sql` (CEO brief work — separate concern)
- `0190_list_tasks_bundle_stage_counts.sql` (the stage-only totals, now **superseded
  by 0191** — left in history as a harmless `create or replace` intermediate)

Both are applied to prod. The numbering clash is cosmetic (each was applied by name,
not by sequence) but the auditor should decide whether to renumber one before commit
to keep `supabase/migrations/` strictly ordered. The `list_tasks_bundle` lineage is
**0190 (stage_counts) → 0191 (group_rows) → 0192 (balanced)**; running them in order
ends at the 0192 definition.

---

## Suggested auditor checklist
1. **Security**: confirm `p_partition_by` is never interpolated and the RPC `case`
   whitelist ⊇ the API `BALANCEABLE_PARTITIONS` keys.
2. **Correctness**: re-run the balanced-vs-flat RPC diff; confirm `group_rows` totals
   equal `bucketTasksBy` over loaded cards for a few modes.
3. **Load-more (balanced)**: click-through verify grow-cap-replace (the one unverified
   path — see Part A verification status).
4. **Migration hygiene**: resolve the dual-0190 collision; confirm 0191/0192 are
   idempotent and match what's on prod.
5. **Part B**: spot-check contract counts (85/199) and the `ExperiencePill` ↔
   satisfaction-tier invariant.
6. **Build/types**: run `bun run build` (a disk-full condition earlier in the session
   produced spurious `tsc` errors — re-run on a healthy disk).
7. **Part C (UI/UX)**: verify accountability + notifications filters survive refresh /
   round-trip through the URL; confirm RTL search-icon padding on migrated toolbars;
   sanity-check the contracts-grid filter strip shows all options (no horizontal
   clipping). Note the two **pending** accountability items were not applied.
8. **Part E1 (contracts re-freeze)**: confirm May/April `monthly_dashboard_totals` match
   the sheet; decide whether the **client-code drift fallback** should be ported from
   `scripts/freeze-sheet-month.mjs` into the production `commit-sheet-dashboard.ts`.
9. **Part E2 (brief breakdown)**: review the `briefAdherence` schema + prompt; confirm the
   panel renders for a populated analysis and is hidden when null; verify the assistant
   grounding loads the right client. **Close the `is_current` gap**: trigger a **weekly**
   re-analyze for Busu (and confirm the daily cron's weekly runs populate `brief_adherence`
   org-wide). Optionally fix the pre-existing `TasksPage.stages` missing-message.
