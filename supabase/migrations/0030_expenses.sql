-- 0030_expenses.sql
-- Adds the expenses module — operating costs the agency tracks against
-- contract revenue (installments) to produce a Finance P&L view.
--
-- RLS uses the same has_permission() helper as contracts (0026b), so
-- visibility is governed by role_permissions instead of bare org membership.

-- 1. Permissions (owner/admin can see and manage; manager can view only)
insert into public.permissions (key, description) values
  ('finance.view',   'عرض البيانات المالية: الفواتير، المصروفات، صافي الربح'),
  ('finance.manage', 'إدارة المصروفات: إضافة، تعديل، حذف')
on conflict (key) do nothing;

-- Grant to roles
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin')
  and p.key in ('finance.view', 'finance.manage')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'manager'
  and p.key = 'finance.view'
on conflict do nothing;

-- 2. Category enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_category') then
    create type expense_category as enum (
      'salaries',
      'rent',
      'ads',
      'software',
      'equipment',
      'utilities',
      'marketing',
      'tax',
      'other'
    );
  end if;
end$$;

-- 3. Table
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  expense_date    date not null,
  category        expense_category not null,
  amount          numeric(12,2) not null check (amount >= 0),
  vendor          text,
  description     text,

  -- An expense can be tied to a project (e.g. ad spend for a campaign)
  -- or left as general overhead.
  project_id      uuid references public.projects(id) on delete set null,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_expenses_org      on public.expenses(organization_id);
create index if not exists idx_expenses_date     on public.expenses(expense_date desc);
create index if not exists idx_expenses_category on public.expenses(category);
create index if not exists idx_expenses_project  on public.expenses(project_id);

-- 4. RLS — mirrors contracts pattern
alter table public.expenses enable row level security;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete to authenticated
  using (public.has_permission(organization_id, 'finance.manage'));

-- 5. Auto-bump updated_at
create or replace function public.expenses_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.expenses_set_updated_at();
