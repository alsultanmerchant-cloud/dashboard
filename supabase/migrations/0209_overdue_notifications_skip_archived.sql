-- 0209 — Sky Light feedback ("ظهور تاسكات موجودة في الأرشيف"): the overdue
-- notification crons (0053 / 0095) only excluded stage='done' tasks. They
-- never excluded ARCHIVED tasks or tasks in ARCHIVED projects (dropped/lost
-- clients), so the bell + /notifications were flooded with overdue alerts for
-- work that no longer matters — 19k+ stale TASK_OVERDUE rows org-wide.
--
-- This migration:
--   1. `create or replace` both cron functions to also require
--      `t.archived_at is null` and the project not be archived.
--   2. One-time cleanup: delete existing TASK_OVERDUE / TASK_ACTIVITY_DUE
--      notifications whose task is archived, done, or in an archived project.
--      These are purely cron-generated noise (not user content); the fixed
--      functions won't regenerate them.
-- Idempotent (`create or replace`; the delete is naturally re-runnable).

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
       and t.archived_at is null
       and t.stage <> 'done'
       and p.status <> 'archived'
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

  update public.task_activities a
     set last_due_notification = v_today
    from public.tasks t
   where a.task_id = t.id
     and a.completed_at is null
     and t.archived_at is null
     and t.stage <> 'done'
     and a.due_date is not null
     and a.due_date <= v_today
     and (a.last_due_notification is null or a.last_due_notification < v_today);

  return v_inserted;
end;
$$;

-- One-time cleanup of the existing stale backlog.
delete from public.notifications n
 using public.tasks t
 where n.type in ('TASK_OVERDUE', 'TASK_ACTIVITY_DUE')
   and n.entity_type = 'task'
   and t.id = n.entity_id::uuid
   and (
        t.archived_at is not null
     or t.stage = 'done'
     or exists (
          select 1 from public.projects p
           where p.id = t.project_id and p.status = 'archived'
        )
   );
