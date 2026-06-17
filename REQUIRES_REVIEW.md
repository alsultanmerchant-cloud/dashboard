# REQUIRES_REVIEW — uncommitted work pending AI audit

Audience: the AI auditor agent. This file lists everything in the current working
tree that is **not yet committed** and should be reviewed before commit. Two
distinct bodies of work are stacked here:

- **Part A — Kanban true column totals + balanced loading** (tasks board). Newest.
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
