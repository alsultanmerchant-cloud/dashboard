-- 0057_delay_days_working_days.sql
-- Replace the calendar-day `delay_days` generated column with a trigger-
-- maintained column that uses working_days_between (Sun-Thu, minus
-- per-org holidays). Recreates the dependent tasks_with_metrics view.

drop view if exists public.tasks_with_metrics;

alter table public.tasks
  drop column if exists delay_days;

alter table public.tasks
  add column delay_days integer;

create index if not exists idx_tasks_delay_days
  on public.tasks(organization_id, delay_days)
  where delay_days is not null and delay_days > 0;

create or replace function public.compute_task_delay_days(
  p_org uuid,
  p_stage public.task_stage,
  p_planned date,
  p_completed timestamptz
)
returns int
language plpgsql
stable
as $$
declare
  v_done_date date;
begin
  if p_stage <> 'done' or p_planned is null or p_completed is null then
    return null;
  end if;
  v_done_date := (p_completed at time zone 'UTC')::date;
  if v_done_date <= p_planned then
    return 0;
  end if;
  return public.working_days_between(p_org, p_planned, v_done_date);
end;
$$;

create or replace function public.tg_sync_task_delay_days()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT'
     or new.stage is distinct from old.stage
     or new.planned_date is distinct from old.planned_date
     or new.completed_at is distinct from old.completed_at then
    new.delay_days := public.compute_task_delay_days(
      new.organization_id, new.stage, new.planned_date, new.completed_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_sync_delay_days on public.tasks;
create trigger trg_tasks_sync_delay_days
  before insert or update of stage, planned_date, completed_at on public.tasks
  for each row execute function public.tg_sync_task_delay_days();

update public.tasks
   set delay_days = public.compute_task_delay_days(
     organization_id, stage, planned_date, completed_at
   );

create or replace view public.tasks_with_metrics as
select id,
       organization_id,
       project_id,
       service_id,
       title,
       description,
       status,
       priority,
       due_date,
       completed_at,
       created_from_template_item_id,
       created_at,
       updated_at,
       created_by,
       stage,
       stage_entered_at,
       planned_date,
       allocated_time_minutes,
       progress_percent,
       expected_progress_percent,
       progress_slip_percent,
       external_source,
       external_id,
       delay_days,
       hold_reason,
       hold_since,
       case
         when planned_date is null then null::integer
         when stage = 'done'::public.task_stage then delay_days
         else (current_date - planned_date)
       end as running_delay_days,
       public.task_current_stage_seconds(t.*) as current_stage_seconds
  from public.tasks t;

create or replace function public.recompute_task_delay_days(p_org uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is not null and not public.has_org_access(p_org) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  with upd as (
    update public.tasks
       set delay_days = public.compute_task_delay_days(
         organization_id, stage, planned_date, completed_at
       )
     where organization_id = p_org
     returning 1
  )
  select count(*)::int into v_count from upd;
  return v_count;
end;
$$;

grant execute on function public.recompute_task_delay_days(uuid) to authenticated;
