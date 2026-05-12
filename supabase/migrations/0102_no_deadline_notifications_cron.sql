-- 0102_no_deadline_notifications_cron.sql
--
-- Sky Light feedback §1.6: tasks created without a deadline can sit
-- invisible until someone trips over them. Daily cron that pings the
-- task's assignees + the project AM once per week for any non-done task
-- that has neither planned_date nor due_date.
--
-- Mirrors 0053 (overdue notifications). One-row throttle column on tasks
-- so the same task doesn't fire daily — re-fires after 7 days if still
-- without a deadline.
--
-- Cron lands at 06:10 UTC, 10 minutes after the overdue cron, to keep
-- notification floods staggered.

alter table public.tasks
  add column if not exists last_no_deadline_notification date;

create index if not exists idx_tasks_no_deadline_notification
  on public.tasks(organization_id, last_no_deadline_notification)
  where last_no_deadline_notification is not null;

create or replace function public.notify_no_deadline_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_inserted int := 0;
  v_throttle interval := interval '7 days';
begin
  with eligible as (
    select t.id, t.organization_id, t.title, t.task_code, t.project_id
      from public.tasks t
     where t.stage <> 'done'
       and t.planned_date is null
       and t.due_date is null
       and (
         t.last_no_deadline_notification is null
         or t.last_no_deadline_notification < (v_today - v_throttle)
       )
  ),
  recipients as (
    -- Direct assignees.
    select e.id as task_id, e.organization_id, e.title, e.task_code,
           emp.user_id, emp.id as employee_id
      from eligible e
      join public.task_assignees ta on ta.task_id = e.id
      join public.employee_profiles emp on emp.id = ta.employee_id
     where emp.user_id is not null
    union
    -- Project account manager.
    select e.id, e.organization_id, e.title, e.task_code,
           emp.user_id, emp.id
      from eligible e
      join public.projects p on p.id = e.project_id
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
           'TASK_NO_DEADLINE',
           coalesce(task_code || ' بلا موعد', 'مهمة بلا موعد'),
           title || ' — لم يتم تحديد موعد نهائي بعد. أضف الموعد لتفعيل التتبع.',
           'task',
           task_id
      from recipients
    returning 1
  )
  select count(*)::int into v_inserted from inserted;

  update public.tasks
     set last_no_deadline_notification = v_today
   where stage <> 'done'
     and planned_date is null
     and due_date is null
     and (
       last_no_deadline_notification is null
       or last_no_deadline_notification < (v_today - v_throttle)
     );

  return v_inserted;
end;
$$;

comment on function public.notify_no_deadline_tasks() is
  'Weekly reminder for no-deadline tasks. Pings assignees and project AM once per week per task. Sky Light §1.6.';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'notify-no-deadline-tasks-daily') then
    perform cron.schedule(
      'notify-no-deadline-tasks-daily',
      '10 6 * * *',
      $cron$ select public.notify_no_deadline_tasks(); $cron$
    );
  end if;
end$$;
