-- 0031_leads.sql
-- Sales pipeline: leads in stages (new → contacted → qualified → proposal → won/lost).
-- Mirrors the contracts/expenses pattern: org-scoped, has_permission RLS,
-- audit-friendly columns. Conversion into a client/contract is a follow-up
-- (we capture client_id when the lead converts).

-- 1. Permissions
insert into public.permissions (key, description) values
  ('sales.view',   'عرض قائمة العملاء المحتملين والمرحلة التجارية'),
  ('sales.manage', 'إدارة العملاء المحتملين: إضافة، تعديل، نقل المرحلة')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager')
  and p.key in ('sales.view', 'sales.manage')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'account_manager'
  and p.key = 'sales.view'
on conflict do nothing;

-- 2. Stage enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum (
      'new',
      'contacted',
      'qualified',
      'proposal',
      'won',
      'lost'
    );
  end if;
end$$;

-- 3. Table
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Identity
  name            text not null,                          -- company / lead name
  contact_name    text,
  email           text,
  phone           text,

  -- Pipeline
  status          lead_status not null default 'new',
  source          text,                                   -- where it came from
  estimated_value numeric(12,2) not null default 0,       -- potential SAR
  next_step_at    date,                                   -- next planned follow-up
  notes           text,

  -- Ownership & links
  assigned_to_employee_id uuid references public.employee_profiles(id) on delete set null,
  converted_client_id     uuid references public.clients(id) on delete set null,

  -- Provenance
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_leads_org      on public.leads(organization_id);
create index if not exists idx_leads_status   on public.leads(status);
create index if not exists idx_leads_created  on public.leads(created_at desc);
create index if not exists idx_leads_assigned on public.leads(assigned_to_employee_id);

-- 4. RLS
alter table public.leads enable row level security;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (public.has_permission(organization_id, 'sales.view'));

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (public.has_permission(organization_id, 'sales.manage'));

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (public.has_permission(organization_id, 'sales.manage'))
  with check (public.has_permission(organization_id, 'sales.manage'));

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated
  using (public.has_permission(organization_id, 'sales.manage'));

-- 5. Auto-bump updated_at
create or replace function public.leads_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.leads_set_updated_at();
