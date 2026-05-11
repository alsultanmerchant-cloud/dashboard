-- 0095 — Sky Light feedback: notification title still leads with the task
-- code (e.g. "PRJ-002-002 متأخرة"), which the team reads as an "ID" rather
-- than a label. Migration 0088 already moved the project name into the body,
-- but the title kept the task_code prefix. Switch the title to the project
-- name so the panel reads as «<project>» first.
--
-- Idempotent: `create or replace` the two cron functions; cron schedule
-- (0053 / 0060) keeps firing them. Also rewrite the title on every existing
-- TASK_OVERDUE / TASK_ACTIVITY_DUE row so the current backlog renders the
-- new shape immediately.

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
    select t.id, t.organization_id, t.title, t.task_code, t.planned_date,
           p.name as project_name, p.id as project_id
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.stage <> 'done'
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
           -- Project name leads the title; body still carries task title + delay.
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
     and planned_date is not null
     and planned_date < v_today
     and (last_overdue_notification is null or last_overdue_notification < v_today);

  return v_inserted;
end;
$$;


create or replace function public.notify_overdue_activities()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_inserted int := 0;
begin
  with due as (
    select a.id, a.organization_id, a.task_id, a.summary, a.due_date,
           a.assignee_id, t.task_code, t.title as task_title,
           p.name as project_name
      from public.task_activities a
      join public.tasks t on t.id = a.task_id
      join public.projects p on p.id = t.project_id
     where a.completed_at is null
       and a.due_date is not null
       and a.due_date <= v_today
       and (a.last_due_notification is null or a.last_due_notification < v_today)
  ),
  recipients as (
    select d.id as activity_id, d.organization_id, d.task_id, d.summary, d.due_date,
           d.task_code, d.task_title, d.project_name,
           emp.user_id, emp.id as employee_id
      from due d
      join public.employee_profiles emp on emp.id = d.assignee_id
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
           'TASK_ACTIVITY_DUE',
           '«' || coalesce(project_name, '—') || '» نشاط مستحق',
           coalesce(task_title, '—') || ' — '
             || summary || case
               when due_date < v_today
                 then ' — متأخر (' || (v_today - due_date) || ' يوم)'
               else ' — مستحق اليوم'
             end,
           'task',
           task_id
      from recipients
    returning 1
  )
  select count(*)::int into v_inserted from inserted;

  update public.task_activities
     set last_due_notification = v_today
   where completed_at is null
     and due_date is not null
     and due_date <= v_today
     and (last_due_notification is null or last_due_notification < v_today);

  return v_inserted;
end;
$$;

-- Rewrite existing notification titles so the team's current backlog displays
-- the new shape without waiting for the next cron firing. We re-derive the
-- project name by joining through tasks → projects (notifications.entity_id
-- is the task_id for TASK_OVERDUE / TASK_ACTIVITY_DUE).
update public.notifications n
   set title = '«' || coalesce(p.name, '—') || '» '
               || case n.type when 'TASK_OVERDUE' then 'متأخرة' else 'نشاط مستحق' end
  from public.tasks t
  join public.projects p on p.id = t.project_id
 where n.type in ('TASK_OVERDUE', 'TASK_ACTIVITY_DUE')
   and n.entity_type = 'task'
   and t.id = n.entity_id::uuid
   and n.organization_id = t.organization_id;

-- Migration 0088 prefixed the body with «<project>» too. Now that the title
-- carries the project name, strip the prefix from legacy bodies so the panel
-- doesn't show the project twice per row.
update public.notifications
   set body = regexp_replace(body, '^«[^»]+» — ', '')
 where type in ('TASK_OVERDUE', 'TASK_ACTIVITY_DUE')
   and body ~ '^«[^»]+» — ';
