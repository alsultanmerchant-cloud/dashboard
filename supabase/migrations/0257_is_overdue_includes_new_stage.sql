-- 0257 — revert 0219: a not-started (`new`) task past its deadline IS overdue
-- =========================================================================
-- 0219 carved the `new` stage out of the canonical overdue rule on the theory
-- that not-started late work is "ordinary scheduling slip, not distress".
-- The Sky Light team rejected that: if a task crossed its deadline and nobody
-- has even STARTED it, that is the worst kind of delay, not an exempt one.
--
-- It also made our numbers disagree with Rwasem. Verified on غادة محمد
-- (2026-07-20): 5 assigned tasks are open with planned_date < today —
-- 2 `new`, 2 `sent_to_client`, 1 `specialist_review`. Rwasem's own filter
-- lists all 5; the /accountability «متأخرة» column showed 3.
--
-- Canonical rule restored to the one the team actually uses in Rwasem (and
-- that src/lib/data/executive.ts countOverdueNow already implements):
--     stage <> 'done'  AND  planned_date < current_date
--
-- Idempotent (`create or replace`; backfill is naturally re-runnable).

-- 1. Trigger expression — drop the `new` exclusion.
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

-- 2. Backfill existing rows to the restored definition.
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

comment on column public.tasks.is_overdue is
  'Trigger-maintained: true when stage <> ''done'' AND planned_date < current_date. A not-started (`new`) task past its deadline counts as overdue — the team treats un-started late work as a delay, not an exemption (0257 reverts 0219). Refreshed nightly by notify_overdue_tasks().';

-- 3. Overdue-notification cron — same predicate, inline. Keeps every 0209
--    archived-skip guard; only the `stage <> 'new'` exclusions are removed
--    (candidate CTE, the is_overdue refresh, and the notification stamp).
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
  -- Refresh is_overdue for any rows whose flag no longer matches the canonical
  -- expression (yesterday's not-overdue tasks that crossed midnight, done tasks
  -- that were re-opened, etc.).
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
    select t.id, t.organization_id, t.title, t.task_code, t.planned_date,
           p.name as project_name, p.id as project_id
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.stage <> 'done'
       and t.archived_at is null
       and p.status <> 'archived'
       and t.planned_date is not null
       and t.planned_date < v_today
       and (t.last_overdue_notification is null or t.last_overdue_notification < v_today)
  ),
  recipients as (
    select o.id as task_id, o.organization_id, o.title, o.task_code, o.planned_date,
           o.project_name,
           emp.user_id, emp.id as employee_id
      from overdue o
      join public.task_assignees ta on ta.task_id = o.id
      join public.employee_profiles emp on emp.id = ta.employee_id
     where emp.user_id is not null
    union
    select o.id, o.organization_id, o.title, o.task_code, o.planned_date,
           o.project_name,
           emp.user_id, emp.id
      from overdue o
      join public.projects p on p.id = o.project_id
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
           '«' || coalesce(project_name, '—') || '» متأخرة',
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
     and archived_at is null
     and planned_date is not null
     and planned_date < v_today
     and (last_overdue_notification is null or last_overdue_notification < v_today);

  return v_inserted;
end;
$$;
