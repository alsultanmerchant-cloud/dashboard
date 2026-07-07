# Executive Indicators — Functional Specification (client-authored)

> Source of truth. Shared by the Sky Light team on 2026-07-07 as the exact
> Executive-Indicator behavior they want on the Project Management Dashboard.
> **All KPI calculations must strictly follow this spec.** No KPI overrides
> these rules unless its own definition explicitly says so.
>
> Implementation-mapping notes (how each abstract term maps to THIS codebase's
> data model) live at the bottom under "Codebase Mapping". Keep the two separate:
> the spec above the line is the client's language; the mapping below is ours.

---

## 1. General Principles

- Calculate every KPI directly from synchronized Project Management data in the system.
- Never use cached, stored, or previously-calculated dashboard values.
- Every KPI strictly follows its Business Definition.
- Never estimate, infer, or guess missing values.
- Every calculation is deterministic, reproducible, from synchronized data.
- Count unique entities only when the KPI definition requires it.
- Ignore deleted records unless stated otherwise.
- If required data is unavailable, return a **validation error**, not a wrong value.

## 2. KPI Card Structure — two independent components

### A. Main KPI Value
Large number on the card. Represents the **current live operational state**.
- Always latest synchronized data.
- Does **not** depend on the dashboard date filter unless the KPI says so.
- Active records only; ignore archived projects, archived tasks, deleted records.
- Task-based KPIs consider only currently **Open** tasks unless overridden.
- Answers: "What is the KPI value right now?"

### B. Trend Indicator
Small value beside/below the Main KPI Value. Represents **historical change**.
- Never modifies/influences the Main KPI Value.
- Always compares the **Selected Period** vs the **Previous Equivalent Period**.
- Fully independent from the Main KPI Value; always historical evaluation.
- Answers: "How has this KPI changed vs the previous equivalent period?"

## 3. Period Comparison Logic
Trend follows the dashboard date filter. The Previous Equivalent Period has the
**exact same duration** as the Selected Period.
- Last 7 Days ↔ Previous 7 Days; Last 30 ↔ Previous 30; Last 90 ↔ Previous 90.
- Custom Range ↔ immediately-preceding range of identical duration.

For every Trend Indicator compute: Current Period Value, Previous Period Value,
Difference (`current − previous`), Trend Direction (Increase / Decrease / No Change).

## 4. Historical Evaluation Rules
Historical calculations represent what **actually happened** during each period,
not the current state.
- Evaluate every record by its historical state during the evaluated period.
- Include tasks that were Closed/Done if they satisfied the KPI conditions during the period.
- Include archived projects if they satisfied the conditions during the period.
- Include archived tasks only when their final status is Closed/Done.
- Archived tasks still Open are always excluded from historical calculations.
- Never exclude a historical record solely because it was archived after the period.

## 5. Trend Tooltip
Every Trend Indicator shows a hover tooltip with: KPI Name, Selected Period,
Current Period Value, Previous Equivalent Period, Previous Period Value,
Difference, Trend Direction. (The Main KPI Value = current live state; the Trend
= historical comparison.)

## 6. Validation Rules
Never calculate a KPI if required data is unavailable. Instead return
`Unable to calculate KPI. Missing Required Data: [list]`. Never estimate.

## 7. KPI Definition Template
Every indicator has: 1. KPI Name · 2. Business Definition · 3. Data Requirements
· 4. KPI-Specific Calculation Rules · 5. Formula · 6. Output. All KPIs inherit
every rule in this spec unless explicitly overridden.

## 8. Output Definition
Every indicator returns: **Main KPI Value** (current live value); **Trend
Indicator** (current, previous, difference, direction); **Tooltip** (selected
period, previous equivalent period, current, previous, difference, direction,
and the note that Main = live / Trend = historical).

## 9. Future-Proof Configuration
Business thresholds should be configurable whenever possible. Avoid hardcoded
thresholds unless permanent. When a configurable threshold exists, calculations
must use the configured value.

## 10. Standard Terminology
Main KPI Value · Trend Indicator · Selected Period · Previous Equivalent Period ·
Current Period Value · Previous Period Value · Difference · Trend Direction ·
Business Definition · Data Requirements · KPI-Specific Calculation Rules ·
Formula · Output · Validation Rules.

---

# KPI 1 — Projects At Risk

> **Revision (2026-07-07, Sky Light feedback).** Split into two tiers:
> - **Projects At Risk** = projects with **≥1** overdue Open task ("at least one
>   overdue task"). This is the count the team validates against Rawasem.
> - **High-Risk Projects** = projects whose overdue Open task count reaches the
>   configured Risk Threshold (**default = 5**, editable at `/settings/kpi`).
>
> Both tiers share the same overdue-Open-task basis and the same Main-value
> scoping (active, non-archived, HOLD/LOST excluded). The overdue predicate is
> the Rawasem-parity one used by the sibling Overdue KPI (`stage <> 'done' AND
> deadline < today`, i.e. it does **not** exclude the `new` stage). The text
> below describes the shared mechanics; only the qualifying threshold differs.

**Business Definition.** A project is "At Risk" when its count of overdue Open
tasks reaches/exceeds a threshold. Projects At Risk uses threshold **1**;
High-Risk Projects uses the configured Risk Threshold (**default = 5**). Indicates
high probability of delayed delivery / operational instability.

**Data Requirements.** Project: ID, Status, Archived Flag, Tags. Task: ID,
Project ID, Status, Deadline, Archived Flag. System: Current Date/Time, Selected Period.

**Main KPI Value.** Count live projects satisfying ALL:
- Project is Active and not Archived.
- **Exclusion (Main value only):** if the project is not archived AND has tag
  `HOLD` or `LOST`, exclude it even if it meets the overdue threshold. This
  exclusion applies ONLY to the Main KPI Value, never to the Trend.
- Tasks counted: Active, not Archived, currently **Open**, Deadline < current date.
- Group overdue Open tasks by project; a project qualifies when its overdue Open
  task count **≥ Configured Risk Threshold**. Count each qualifying project once.

**Trend Indicator.** Per evaluated period, count unique projects that satisfied
the definition **during** that period (historical evaluation). Compare Selected
vs Previous Equivalent Period. **Do NOT apply the HOLD/LOST exclusion to the Trend.**

**Formula.**
`ProjectsAtRisk = COUNT(DISTINCT Project) WHERE OpenOverdueTasks >= Threshold AND ProjectTag NOT IN (HOLD, LOST)`
`Difference = CurrentPeriod − PreviousPeriod`

---

# KPI 2 — On-Time Task Delivery

**Business Definition.** Delivery performance for completed tasks. The card shows
three values: On-Time Delivery %, Completed Tasks Count, and a Main KPI Value.
Completed = status DONE or CLOSED. On-time = DONE/CLOSED **and** Completion
Date/Time ≤ Deadline.

**A. On-Time Delivery %** (over Selected Period):
- `CompletedTasksCount = COUNT WHERE status IN (DONE,CLOSED) AND CompletionDate ∈ SelectedPeriod AND not deleted`
- `OnTimeCompleted = same + CompletionDateTime <= Deadline`
- `OnTime% = OnTimeCompleted / CompletedTasksCount * 100` (if denom 0 → return 0%, no divide-by-zero).

**B. Completed Tasks Count.** Total completed during Selected Period (the "N tasks"
shown by the %). Same inclusion as above.

**C. Main KPI Value (override).** Does NOT replace the %. It's an additional live
value, **independent of the Selected Period**: count tasks delivered **on time
today** — status DONE/CLOSED, Completion Date = Today, CompletionDateTime ≤
Deadline, not archived, not deleted. Answers "how many tasks were delivered on
time today?"

**D. Trend Indicator.** Historical change in On-Time % between Selected and
Previous Equivalent Period. Must not modify %, Completed Count, or Main KPI Value.

---

# KPI 3 — Overdue Tasks

**Business Definition.** Overdue tasks and their historical movement. A task is
overdue when it was still **Open** after its deadline passed.

**Overdue definition.** Deadline passed AND task was still Open after the deadline
AND had not reached DONE/CLOSED at the time it became overdue.

**Exclusion.** Exclude if ANY: task has LOST or HOLD tag, OR **parent project**
has LOST or HOLD tag (applies even when the tag is only on the parent project).

**Trend (historical).** Current Period = count tasks that were Open and overdue
**at any time during** the Selected Period; Previous Period = same for the
previous equivalent period. A task counts in a period if it was Open+overdue then,
**even if it later became DONE/CLOSED**. Do not use current status only.
`Difference = Current − Previous`.

---

# KPI 4 — Service Delivery Performance

**Business Definition.** Per Service/Category row, three values: On-Time Delivery
Rate (%), Completed Tasks Count, CLIENT CHANGES Count. **Renewal services merge
into their base** (e.g. `Renewal Social Media` counts under `Social Media`);
never shown/calculated as separate categories.

**Scope.** Each row = one base Service/Category; include tasks whose category is
the base name OR `Renewal + base name`.

**Completed.** Any task that reached DONE or CLOSED during the Selected Period.
Archived and non-archived both included; no exclusion rules apply.

**On-Time Rate (Main).** Among tasks that became DONE/CLOSED during the Selected
Period, on-time = `CompletionDate <= Deadline`.
`(OnTimeCompleted / TotalCompleted) * 100`; if none completed → 0%.

**Completed Tasks Count.** Total DONE/CLOSED during Selected Period. Informational;
not compared to previous period.

**CLIENT CHANGES Count.** Count tasks that **entered the CLIENT CHANGES stage**
during the Selected Period, using **Task Stage History**. Include if it entered
at least once; task may be Open/Closed/Archived/not — all included. Multiple
entries in the same period count once (DISTINCT task).

**Trends.** On-Time Rate trend = current − previous period rate. CLIENT CHANGES
trend = current − previous period count (via stage history).

---

# KPI 5 — Client Changes Comparison

**Business Definition.** Compares total tasks that entered the CLIENT CHANGES
stage during the Selected Period vs the immediately-preceding period of equal
duration.

**Current Period Value.** Count tasks where: entered CLIENT CHANGES stage; the
entry occurred within the Selected Period; using **Task Stage History**, not
current stage. Status does not affect eligibility (Open/Done/Closed all included);
archived included. Each task counted once, by its **first** entry into CLIENT
CHANGES within the period.

**Previous Period Value.** Same rules on the immediately-preceding equal-duration period.

**Comparison.** Display % increase/decrease per the global comparison behavior.

**Validation.** Use Stage History only; current status/archived never affect
inclusion; only the date of entering CLIENT CHANGES decides the period; count once
per period even if entered multiple times.

---

# Codebase Mapping (ours — how the spec's terms bind to this system)

> Verified against `src/lib/supabase/types.ts`, `src/lib/data/executive.ts`,
> `src/lib/data/ceo-dashboard.ts`, and live data on 2026-07-07.

| Spec term | This system |
|---|---|
| **Task "Open"** | `tasks.stage <> 'done'` (no separate CLOSED status exists) |
| **Task "DONE or CLOSED" / completed** | terminal `tasks.stage = 'done'` (status is only `done`/`in_progress`) |
| **Task Completion Date** | `tasks.completed_at` (or `actual_done_date`); on-time already uses `riyadhDateOf(completed_at) <= deadline` |
| **Task Deadline** | `tasks.due_date ?? tasks.planned_date` (existing convention in `executive.ts`) |
| **Task Archived Flag** | `tasks.archived_at IS NOT NULL` |
| **CLIENT CHANGES stage** | stage enum value `client_changes` (label "تعديلات العميل") |
| **Task Stage History** | table `task_stage_history` (+ `stage_entered_at`) |
| **Service / Category** | `tasks.service_id`; renewal-merge already implemented (see `[[project_service_renewal_merge]]`) |
| **Project Active / Archived** | `projects.status IN ('active','archived')` — the ONLY two values |
| **Project HOLD tag** | ⚠️ NOT a project tag. Candidates: `projects.held_at IS NOT NULL`, or the client's contract in `Hold`. **DECISION NEEDED.** |
| **Project LOST tag** | ⚠️ NOT a project tag. Candidates: `projects.status='archived'`, or the client's contract `Lost`. **DECISION NEEDED.** |
| **Selected Period** | `DateRangePicker` + `resolveRange(sp)` |
| **Previous Equivalent Period / Trend / Tooltip** | ✅ built in `src/lib/data/executive-indicators.ts` (`getExecutiveIndicators`) + `executive-indicators-row.tsx`. Trends computed in TS from `completed_at` — no RPC/token dependency. |
| **Configured Risk Threshold (5)** | ✅ `kpi_settings` table (migration 0233) + `getRiskThreshold(orgId)` + admin UI at `/settings/kpi`; default 5 |
| **Historical existence** | ✅ exact via `task_stage_history` in RPCs `get_projects_at_risk_asof` / `get_overdue_during_period` (migration 0234); TS `created_at` path is the fallback |

### Known reconciliation points (flag before building)
1. **Overdue definition** differs from our current `is_overdue` (migration 0219:
   `stage NOT IN (done,new) AND planned_date < today`, Riyadh tz). The spec does
   NOT exclude the `new` stage. Decide which wins per KPI.
2. **`project_tags`** currently holds Odoo *role* tags (Art Director, …), not
   HOLD/LOST — so HOLD/LOST must bind to contract/held_at, not tags.
3. **Timezone:** all "today"/deadline boundaries must use Asia/Riyadh
   (`src/lib/tz.ts`), see `[[project_riyadh_today_timezone]]`.
