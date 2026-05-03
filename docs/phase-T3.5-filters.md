# T3.5 — Head-of-Department Task Filters

**Status:** queued (post-T3, post-T4). Surfaced by the owner during Wave 2 dispatch.

## Why this exists

T3 closes the PDF-mandated task workflow gaps (followers, hold, delay banner on completed tasks). It does **not** give a department head the views they actually use day-to-day to run their team. Those views are filters on the task list, scoped per-direct-report, with cuts the current `delay_days` computation can't answer.

## Owner's words (verbatim, Arabic)

> حبيت اوضح الفلاتر الموجودة حاليا
>
> في فلاتر لكل موظف في القسم عند الهيد علشان يظهرله كل تاسكاته كا عدد وعلشان متابعته لتاسكات تيمه
>
> في فلاتر علي تاسكات متوزعتش لسه (تاسكات الهيد بس اللي موجود اساين فيها ولسه موزعهاش)
>
> تاسكات التيم بالديدلاين (الهيد بيفتح الفلتر ويختار التاريخ عاوز يشوف تأخيرات لحد امتي بالظبط كام تاسك للموظف ده مثلا) واللي هي التاسكات المفتوحه لسه الديلاي مش بيظهر غير التاسكات اللي انتهت زي ما حضرتك فاهم
>
> ده بشكل عام باقي التاسكات علي حسب ظروف كل هيد..
>
> في هيد مثلاً ماسك شغل بنفسه فا عاملين فلاتر تخص تاسكاته هوا
>
> تاسكات متكريته بدون ديدلاين فا بالتالي ظهور انه متأخر او لا مش هيبان

## Filters to implement

### 1. Per-employee filter for the head
Head sees a chip/dropdown of every direct report; selecting one filters the task list to that employee's tasks and shows the count badge. Default landing for a head is "كل تاسكات الفريق" with per-employee chips beneath.

**Data:** `task_assignees` joined to `employee_profiles` where `manager_id = <current head's employee_id>`.

### 2. "Not yet redistributed" filter
Tasks where the head is the only assignee and hasn't pushed them to a specialist yet. Flags inbox-buildup at the head level.

**Data:** tasks where the sole row in `task_assignees` is the head themselves AND `tasks.status != 'done'`. May want a `redistributed_at` timestamp later, but the assignee-cardinality check is sufficient for v1.

### 3. Team tasks by forward deadline
Head opens a date picker, picks a future date, sees per-employee count of **open** tasks whose deadline falls on or before that date. The point is to forecast "how late will so-and-so be by next Thursday."

**Schema gap:** `delay_days` (0023) is `STORED GENERATED` and only populates when `status='done'`. There is no forward-looking equivalent. Two options:

- **a)** Compute on read: `CASE WHEN status != 'done' AND deadline < <picked_date> THEN <picked_date> - deadline END`. No schema change, all logic in the query.
- **b)** Add a `projected_delay_days(at_date date)` SQL function. Cleaner reuse, same math.

Recommend (a) for v1 — keeps the migration surface small and the date is a UI parameter anyway.

### 4. Per-head custom filters
Heads vary. Some execute work themselves and want filters scoped to *their own* assignments, separate from team-wide views. Probably wants a "filter presets" mechanism eventually:

- `task_filter_presets` table: `(id, owner_user_id, name, filter_json, is_pinned, created_at)`
- UI: save current filter as preset, pin to sidebar.

This is the only piece that genuinely needs new schema. Defer until #1–#3 ship and we see which presets heads actually save.

### 5. Recurring tasks without deadline
Some recurring tasks have no `deadline`, so neither `delay_days` nor the forward-projection in #3 produces a signal. Two paths:

- **a)** Synthesise a virtual deadline from the cadence (last-completion + interval). Requires the recurrence to be modeled (it isn't yet — there's no `recurrence` column on `tasks`).
- **b)** Show a "متأخر عن الإيقاع المعتاد" badge based on time-since-last-completion vs median historical interval. Pure read-side, no schema.

(b) is the pragmatic v1; (a) is the right long-term answer once recurrence is first-class.

## Sequencing

T3.5 should not start until:
- T3 lands (followers + hold + the `tasks_select` re-cut)
- T4 lands (categories engine — defines what "open task" means once auto-generation is on)
- 0022b applied (otherwise the head would see other departments' tasks and the per-employee filter is meaningless)

## Out of scope

- Cross-department views (org-wide task search lives at the owner level, not the head level)
- Manager-of-managers rollups (Sky Light has 5 tiers; this phase is single-tier head → direct reports)
- Recurrence modeling on `tasks` — earned its own phase if/when (5a) is taken seriously
