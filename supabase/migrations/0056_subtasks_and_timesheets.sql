-- 0056_subtasks_and_timesheets.sql
-- Adds:
--   * tasks.parent_task_id  — sub-tasks (Odoo's child_ids)
--   * task_timesheets        — per-employee time entries
-- with RLS that mirrors task visibility.

alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete set null;

create index if not exists idx_tasks_parent on public.tasks(parent_task_id) where parent_task_id is not null;

alter table public.tasks
  drop constraint if exists tasks_parent_not_self;
alter table public.tasks
  add constraint tasks_parent_not_self check (parent_task_id is null or parent_task_id <> id);

create table if not exists public.task_timesheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  spent_on date not null default current_date,
  hours numeric(5,2) not null check (hours >= 0 and hours <= 24),
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_task_timesheets_task on public.task_timesheets(task_id, spent_on desc);
create index if not exists idx_task_timesheets_employee on public.task_timesheets(employee_id, spent_on desc);

alter table public.task_timesheets enable row level security;

drop policy if exists task_timesheets_select on public.task_timesheets;
create policy task_timesheets_select on public.task_timesheets
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists task_timesheets_write on public.task_timesheets;
create policy task_timesheets_write on public.task_timesheets
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission(organization_id, 'tasks.manage')
      or exists (
        select 1 from public.employee_profiles emp
         where emp.id = task_timesheets.employee_id
           and emp.user_id = auth.uid()
      )
    )
  )
  with check (
    public.has_org_access(organization_id)
    and (
      public.has_permission(organization_id, 'tasks.manage')
      or exists (
        select 1 from public.employee_profiles emp
         where emp.id = task_timesheets.employee_id
           and emp.user_id = auth.uid()
      )
    )
  );
