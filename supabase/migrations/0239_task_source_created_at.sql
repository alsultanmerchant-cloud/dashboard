-- 0239 — Real Odoo task creation date for exact historical trend reconstruction.
--
-- tasks.created_at ≈ the local Odoo *sync* date, so the Executive-Indicators
-- "Overdue during period" and "Projects at risk as-of" reconstructions
-- under-count any window that starts before the sync: the task looks like it
-- "didn't exist yet". Migration 0234 patched existence with task_stage_history,
-- but stage-history coverage is incomplete for older tasks, so the 30/90-day
-- Overdue trend still ran ~10-13% low vs Rwasem (verified against live Odoo).
--
-- source_created_at carries Odoo's real project.task.create_date (UTC). The
-- existence checks below now prefer it, falling back to the previous
-- least(created_at, first stage-history entry) only when it is absent.

alter table public.tasks add column if not exists source_created_at timestamptz;

comment on column public.tasks.source_created_at is
  'Real Odoo project.task.create_date (UTC). Authoritative task-existence timestamp for historical KPI reconstruction; created_at is the local sync time.';

-- Projects At Risk, as of end-of-day p_asof (snapshot). Includes archived
-- projects; applies NO hold/lost exclusion (spec: exclusion is Main-value only).
create or replace function public.get_projects_at_risk_asof(
  p_org uuid, p_asof date, p_threshold integer
) returns integer
language sql stable security definer set search_path = public
as $$
  with cutoff as (
    select ((p_asof + 1)::timestamp at time zone 'Asia/Riyadh') as end_utc
  ),
  first_seen as (
    select task_id, min(entered_at) as fe
    from task_stage_history where organization_id = p_org group by task_id
  )
  select count(*)::int from (
    select t.project_id
    from tasks t
    join projects p on p.id = t.project_id and p.organization_id = p_org
    left join first_seen f on f.task_id = t.id
    cross join cutoff c
    where t.organization_id = p_org
      and coalesce(t.due_date, t.planned_date) < p_asof                         -- overdue by D
      and not (t.archived_at is not null and t.completed_at is null and t.actual_done_date is null)
      and (
        coalesce(t.completed_at, (t.actual_done_date::timestamp at time zone 'Asia/Riyadh')) is null
        or coalesce(t.completed_at, (t.actual_done_date::timestamp at time zone 'Asia/Riyadh')) >= c.end_utc
      )                                                                          -- still open at D
      and (t.archived_at is null or t.archived_at >= c.end_utc)                  -- not archived by D
      and coalesce(t.source_created_at, least(t.created_at, f.fe)) < c.end_utc   -- existed by D (real create date first)
    group by t.project_id
    having count(*) >= p_threshold
  ) q;
$$;

-- Overdue Tasks that were open AND overdue at any time during [p_from, p_to]
-- (spec KPI 3). Excludes tasks whose client's contract is hold/lost/closed.
create or replace function public.get_overdue_during_period(
  p_org uuid, p_from date, p_to date
) returns integer
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Asia/Riyadh') as s_utc,
           ((p_to + 1)::timestamp at time zone 'Asia/Riyadh') as e_utc
  ),
  first_seen as (
    select task_id, min(entered_at) as fe
    from task_stage_history where organization_id = p_org group by task_id
  ),
  excl as (  -- clients whose contract state resolves to hold/lost (no live one)
    select client_id from contracts
    where organization_id = p_org and client_id is not null
    group by client_id
    having bool_or(status in ('active','renewed')) = false
       and bool_or(status in ('hold','lost','closed'))
  )
  select count(*)::int
  from tasks t
  join projects p on p.id = t.project_id and p.organization_id = p_org
  left join first_seen f on f.task_id = t.id
  cross join bounds b
  where t.organization_id = p_org
    and (p.client_id is null or p.client_id not in (select client_id from excl))
    and coalesce(t.due_date, t.planned_date) < p_to
    and not (t.archived_at is not null and t.completed_at is null and t.actual_done_date is null)
    and coalesce(t.source_created_at, least(t.created_at, f.fe)) < b.e_utc                -- existed (real create date first)
    and ((coalesce(t.due_date, t.planned_date) + 1)::timestamp at time zone 'Asia/Riyadh') < b.e_utc  -- overdue-start < period end
    and least(
          coalesce(t.completed_at, (t.actual_done_date::timestamp at time zone 'Asia/Riyadh')),
          now()
        ) > b.s_utc;                                                                       -- overdue-end > period start
$$;

grant execute on function public.get_projects_at_risk_asof(uuid, date, integer) to authenticated, service_role;
grant execute on function public.get_overdue_during_period(uuid, date, date) to authenticated, service_role;
