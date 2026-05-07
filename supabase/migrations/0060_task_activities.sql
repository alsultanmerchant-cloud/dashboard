-- 0060_task_activities.sql
-- mail.activity-style scheduled to-dos on tasks. Distinct from chatter
-- (freeform comments) and sub-tasks (deliverables). Activities are
-- date-bound reminders: "Call client back tomorrow", "Review by Thursday".

do $$ begin
  create type task_activity_type as enum ('call','email','review','upload','other');
exception when duplicate_object then null; end $$;

create table if not exists public.task_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  assignee_id uuid references public.employee_profiles(id) on delete set null,
  activity_type task_activity_type not null default 'other',
  summary text not null,
  due_date date,
  completed_at timestamptz,
  last_due_notification date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_task_activities_task on public.task_activities(task_id, due_date);
create index if not exists idx_task_activities_assignee on public.task_activities(assignee_id) where completed_at is null;
create index if not exists idx_task_activities_open_due
  on public.task_activities(organization_id, due_date)
  where completed_at is null and due_date is not null;

-- updated_at maintenance.
create or replace function public.tg_task_activities_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_task_activities_touch on public.task_activities;
create trigger trg_task_activities_touch
  before update on public.task_activities
  for each row execute function public.tg_task_activities_touch();

alter table public.task_activities enable row level security;

drop policy if exists task_activities_select on public.task_activities;
create policy task_activities_select on public.task_activities
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists task_activities_write on public.task_activities;
create policy task_activities_write on public.task_activities
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission(organization_id, 'tasks.manage')
      or exists (
        select 1 from public.tasks t
         where t.id = task_activities.task_id
           and t.created_by = auth.uid()
      )
      or exists (
        select 1 from public.employee_profiles emp
         where emp.id = task_activities.assignee_id
           and emp.user_id = auth.uid()
      )
    )
  )
  with check (
    public.has_org_access(organization_id)
    and (
      public.has_permission(organization_id, 'tasks.manage')
      or exists (
        select 1 from public.tasks t
         where t.id = task_activities.task_id
           and t.created_by = auth.uid()
      )
      or exists (
        select 1 from public.employee_profiles emp
         where emp.id = task_activities.assignee_id
           and emp.user_id = auth.uid()
      )
    )
  );

-- Daily notifier for activities whose due_date <= today AND not completed.
-- Throttled by last_due_notification, mirroring notify_overdue_tasks().
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
           a.assignee_id, t.task_code
      from public.task_activities a
      join public.tasks t on t.id = a.task_id
     where a.completed_at is null
       and a.due_date is not null
       and a.due_date <= v_today
       and (a.last_due_notification is null or a.last_due_notification < v_today)
  ),
  recipients as (
    select d.id as activity_id, d.organization_id, d.task_id, d.summary, d.due_date, d.task_code,
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
           coalesce(task_code || ' — نشاط مستحق', 'نشاط مستحق'),
           summary || case
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

comment on function public.notify_overdue_activities() is
  'Daily activity-due notifier. Inserts notifications for assignees of task_activities rows whose due_date<=today and completed_at is null. Throttled by last_due_notification.';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'notify-overdue-activities-daily') then
    perform cron.schedule(
      'notify-overdue-activities-daily',
      '5 6 * * *',
      $cron$ select public.notify_overdue_activities(); $cron$
    );
  end if;
end$$;
