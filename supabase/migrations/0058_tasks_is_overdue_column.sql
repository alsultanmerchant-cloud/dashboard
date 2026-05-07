-- 0058_tasks_is_overdue_column.sql
-- Materialise tasks.is_overdue so saved filters / kanban / Gantt do not
-- recompute (stage <> 'done' AND planned_date < current_date) inline.
--
-- Trigger keeps the column in sync on INSERT and on UPDATE of stage or
-- planned_date. The daily overdue cron also refreshes the flag across
-- the row set to handle the date-rollover case (a task that became
-- overdue overnight without any column change).

alter table public.tasks
  add column if not exists is_overdue boolean not null default false;

create or replace function public.tg_tasks_set_is_overdue()
returns trigger
language plpgsql
as $$
begin
  new.is_overdue := (
    new.stage is distinct from 'done'::task_stage
    and new.planned_date is not null
    and new.planned_date < current_date
  );
  return new;
end;
$$;

drop trigger if exists trg_tasks_set_is_overdue on public.tasks;
create trigger trg_tasks_set_is_overdue
before insert or update of stage, planned_date
on public.tasks
for each row
execute function public.tg_tasks_set_is_overdue();

-- Backfill the column for existing rows.
update public.tasks
   set is_overdue = (
     stage is distinct from 'done'::task_stage
     and planned_date is not null
     and planned_date < current_date
   )
 where is_overdue is distinct from (
     stage is distinct from 'done'::task_stage
     and planned_date is not null
     and planned_date < current_date
   );

-- Partial index — saved filters and kanban only ever ask for is_overdue=true.
create index if not exists idx_tasks_is_overdue
  on public.tasks(organization_id)
  where is_overdue = true;

-- Extend the daily cron to also refresh is_overdue across all rows so
-- midnight transitions are picked up without touching unrelated columns.
create or replace function public.notify_overdue_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_inserted int := 0;
begin
  -- Refresh is_overdue for any rows whose flag no longer matches the
  -- canonical expression (typically: yesterday's not-overdue tasks that
  -- crossed midnight, or done tasks that were re-opened).
  update public.tasks
     set is_overdue = (
       stage is distinct from 'done'::task_stage
       and planned_date is not null
       and planned_date < v_today
     )
   where is_overdue is distinct from (
       stage is distinct from 'done'::task_stage
       and planned_date is not null
       and planned_date < v_today
     );

  with overdue as (
    select t.id, t.organization_id, t.title, t.task_code, t.planned_date
      from public.tasks t
     where t.stage <> 'done'
       and t.planned_date is not null
       and t.planned_date < v_today
       and (t.last_overdue_notification is null or t.last_overdue_notification < v_today)
  ),
  recipients as (
    select o.id as task_id, o.organization_id, o.title, o.task_code, o.planned_date,
           emp.user_id, emp.id as employee_id
      from overdue o
      join public.task_assignees ta on ta.task_id = o.id
      join public.employee_profiles emp on emp.id = ta.employee_id
     where emp.user_id is not null
    union
    select o.id, o.organization_id, o.title, o.task_code, o.planned_date,
           emp.user_id, emp.id
      from overdue o
      join public.projects p on p.id = (select project_id from public.tasks where id = o.id)
      join public.employee_profiles emp on emp.id = p.account_manager_employee_id
     where emp.user_id is not null
  ),
  inserted as (
    insert into public.notifications (
      organization_id, recipient_user_id, recipient_employee_id,
      type, title, body, entity_type, entity_id
    )
    select organization_id,
           user_id,
           employee_id,
           'TASK_OVERDUE',
           coalesce(task_code || ' متأخرة', 'مهمة متأخرة'),
           title || ' — تجاوزت موعد التسليم (' || (v_today - planned_date) || ' يوم)',
           'task',
           task_id
      from recipients
    returning 1
  )
  select count(*)::int into v_inserted from inserted;

  update public.tasks
     set last_overdue_notification = v_today
   where stage <> 'done'
     and planned_date is not null
     and planned_date < v_today
     and (last_overdue_notification is null or last_overdue_notification < v_today);

  return v_inserted;
end;
$$;

comment on column public.tasks.is_overdue is
  'Trigger-maintained: true when stage <> done AND planned_date < current_date. Refreshed nightly by notify_overdue_tasks() to handle date rollover.';
