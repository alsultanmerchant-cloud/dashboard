-- 0032_leaves.sql
-- HR module — leave requests with self-service request, manager approval,
-- typed reasons. Mirrors the contracts/expenses/leads pattern: org-scoped,
-- has_permission RLS, audit-friendly columns.
--
-- Half-day support: `days` is numeric(5,1) so 0.5 / 1.5 etc. work.
-- An employee files for themselves; the requester (created_by) and the
-- subject (employee_user_id) can differ when an admin files on behalf.

-- 1. Permissions
insert into public.permissions (key, description) values
  ('hr.view',    'عرض كل طلبات الإجازات وملخص الموارد البشرية'),
  ('hr.manage',  'الموافقة أو رفض طلبات الإجازات وإدارة الموارد البشرية')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager')
  and p.key in ('hr.view', 'hr.manage')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('account_manager', 'team_lead')
  and p.key = 'hr.view'
on conflict do nothing;

-- 2. Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'leave_type') then
    create type leave_type as enum (
      'annual',
      'sick',
      'unpaid',
      'maternity',
      'paternity',
      'compassionate',
      'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'leave_status') then
    create type leave_status as enum (
      'pending',
      'approved',
      'rejected',
      'cancelled'
    );
  end if;
end$$;

-- 3. Table
create table if not exists public.leaves (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Subject of the leave (the person taking the time off)
  employee_user_id    uuid not null references auth.users(id) on delete cascade,
  employee_profile_id uuid references public.employee_profiles(id) on delete set null,

  -- Dates (inclusive). End must be >= start.
  start_date  date not null,
  end_date    date not null,
  days        numeric(5,1) not null check (days > 0),

  -- Reason
  leave_type  leave_type   not null default 'annual',
  reason      text,

  -- Workflow
  status      leave_status not null default 'pending',
  decided_by  uuid references auth.users(id) on delete set null,
  decided_at  timestamptz,
  decision_note text,

  -- Provenance
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint leaves_dates_check check (end_date >= start_date)
);

create index if not exists idx_leaves_org      on public.leaves(organization_id);
create index if not exists idx_leaves_user     on public.leaves(employee_user_id);
create index if not exists idx_leaves_status   on public.leaves(status);
create index if not exists idx_leaves_dates    on public.leaves(start_date, end_date);

-- 4. RLS
alter table public.leaves enable row level security;

-- Read: managers + the requester themselves
drop policy if exists leaves_select on public.leaves;
create policy leaves_select on public.leaves
  for select to authenticated
  using (
    public.has_permission(organization_id, 'hr.view')
    or employee_user_id = auth.uid()
    or created_by = auth.uid()
  );

-- Insert: anyone authenticated can request their OWN leave (employee_user_id = auth.uid()),
-- or someone with hr.manage can file on behalf of others.
drop policy if exists leaves_insert on public.leaves;
create policy leaves_insert on public.leaves
  for insert to authenticated
  with check (
    employee_user_id = auth.uid()
    or public.has_permission(organization_id, 'hr.manage')
  );

-- Update: requester can cancel their own pending leave; managers can decide on any.
drop policy if exists leaves_update on public.leaves;
create policy leaves_update on public.leaves
  for update to authenticated
  using (
    public.has_permission(organization_id, 'hr.manage')
    or (employee_user_id = auth.uid() and status = 'pending')
  )
  with check (
    public.has_permission(organization_id, 'hr.manage')
    or (employee_user_id = auth.uid() and status in ('pending', 'cancelled'))
  );

-- Delete: managers only
drop policy if exists leaves_delete on public.leaves;
create policy leaves_delete on public.leaves
  for delete to authenticated
  using (public.has_permission(organization_id, 'hr.manage'));

-- 5. Auto-bump updated_at
create or replace function public.leaves_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leaves_set_updated_at on public.leaves;
create trigger leaves_set_updated_at
  before update on public.leaves
  for each row execute function public.leaves_set_updated_at();
