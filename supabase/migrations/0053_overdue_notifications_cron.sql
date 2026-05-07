-- 0053_overdue_notifications_cron.sql
-- Daily cron that surfaces overdue tasks. Mirrors the Odoo
-- _cron_notify_overdue_tasks behavior: one notification per assignee per
-- task per day. Throttled by tasks.last_overdue_notification.

alter table public.tasks
  add column if not exists last_overdue_notification date;

create index if not exists idx_tasks_overdue_notification
  on public.tasks(organization_id, last_overdue_notification)
  where last_overdue_notification is not null;

-- The function: bulk-insert notifications, then stamp the throttle column.
-- Returns the number of notifications inserted.
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

comment on function public.notify_overdue_tasks() is
  'Daily overdue-task notifier. Inserts notifications for assignees and the project AM, throttled by tasks.last_overdue_notification. Mirrors Odoo _cron_notify_overdue_tasks.';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'notify-overdue-tasks-daily') then
    perform cron.schedule(
      'notify-overdue-tasks-daily',
      '0 6 * * *',
      $cron$ select public.notify_overdue_tasks(); $cron$
    );
  end if;
end$$;
