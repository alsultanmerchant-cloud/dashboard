-- 0219 — Sky Light feedback: a task that is still in the `new` stage (never
-- started) yet past its planned_date is "ordinary late" — it just means the
-- team is working the batch sequentially and the schedule slipped, not that the
-- project is stuck. The old `is_overdue` definition (0058) flagged EVERY
-- non-done task past its date, so these not-started tasks flooded the CEO
-- "where is the danger" card (e.g. Chic Boutique read 15 overdue / 43% slip
-- when only ~3 were on started work) and every other overdue surface
-- (/tasks filters, kanban, scorecards, overdue notifications).
--
-- New canonical rule — overdue everywhere now means:
--     stage NOT IN ('done', 'new')  AND  planned_date < current_date
--
-- Because nearly every surface reads the materialised `tasks.is_overdue`
-- column, redefining the column's trigger + backfill propagates the rule
-- agency-wide. The overdue-notification cron computes the same predicate
-- inline, so it is updated to match (don't ping people about work nobody has
-- been asked to start yet).
-- Idempotent (`create or replace`; backfill is naturally re-runnable).

-- 1. Trigger expression — exclude the `new` stage.
create or replace function public.tg_tasks_set_is_overdue()
returns trigger
language plpgsql
as $$
begin
  new.is_overdue := (
    new.stage is distinct from 'done'::task_stage
    and new.stage is distinct from 'new'::task_stage
    and new.planned_date is not null
    and new.planned_date < current_date
  );
  return new;
end;
$$;

-- 2. Backfill existing rows to the new definition.
update public.tasks
   set is_overdue = (
     stage is distinct from 'done'::task_stage
     and stage is distinct from 'new'::task_stage
     and planned_date is not null
     and planned_date < current_date
   )
 where is_overdue is distinct from (
     stage is distinct from 'done'::task_stage
     and stage is distinct from 'new'::task_stage
     and planned_date is not null
     and planned_date < current_date
   );

comment on column public.tasks.is_overdue is
  'Trigger-maintained: true when stage NOT IN (done, new) AND planned_date < current_date. A task still in the `new` (not-started) stage is never overdue — its lateness is ordinary scheduling slip, not distress. Refreshed nightly by notify_overdue_tasks().';

-- 3. Overdue-notification cron — same predicate, inline. Keeps all 0209
--    archived-skip guards; only adds the `stage <> 'new'` exclusion (in both
--    the candidate CTE and the last_overdue_notification stamp update) and
--    refreshes is_overdue across the row set to absorb the midnight rollover.
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
  -- expression (yesterday's not-overdue tasks that crossed midnight, tasks that
  -- moved off the `new` stage, done tasks that were re-opened, etc.).
  update public.tasks
     set is_overdue = (
       stage is distinct from 'done'::task_stage
       and stage is distinct from 'new'::task_stage
       and planned_date is not null
       and planned_date < v_today
     )
   where is_overdue is distinct from (
       stage is distinct from 'done'::task_stage
       and stage is distinct from 'new'::task_stage
       and planned_date is not null
       and planned_date < v_today
     );

  with overdue as (
    select t.id, t.organization_id, t.title, t.task_code, t.planned_date,
           p.name as project_name, p.id as project_id
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.stage <> 'done'
       and t.stage <> 'new'
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
     and stage <> 'new'
     and archived_at is null
     and planned_date is not null
     and planned_date < v_today
     and (last_overdue_notification is null or last_overdue_notification < v_today);

  return v_inserted;
end;
$$;
