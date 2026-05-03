-- =========================================================================
-- Phase T7 — Renewal Cycles
-- =========================================================================
--
-- Owner-confirmed (DECISIONS_LOG.md row 1): renewal cycles vary per client
-- (some monthly, some quarterly, some 6-monthly). A renewal is the SAME
-- projects row + a NEW renewal_cycles row — preserves history without
-- duplicating client/contract data.
--
-- Plan:
--   1. ALTER projects: cycle_length_months (INT NULL = one-time),
--      next_renewal_date (DATE NULL).
--   2. CREATE renewal_cycles (id, project_id, cycle_no, started_at,
--      ended_at, status). UNIQUE (project_id, cycle_no).
--   3. RLS: split SELECT vs INSERT/UPDATE/DELETE. SELECT joins projects
--      (so cannot use FOR ALL — wave-2 lesson). Writes gated on
--      has_permission('renewal.manage') (1-arg overload — dispatch hard rule).
--   4. Permission seed: 'renewal.manage' bound to owner/admin/manager/
--      account_manager. (Reading is granted by has_org_access on the
--      parent project.)
-- =========================================================================

-- 1. projects columns ------------------------------------------------------
alter table public.projects
  add column if not exists cycle_length_months integer,
  add column if not exists next_renewal_date date;

comment on column public.projects.cycle_length_months is
  'Renewal cadence in months. NULL = one-time project. Common values: 1 (monthly), 3 (quarterly), 6, 12.';
comment on column public.projects.next_renewal_date is
  'Date of the next expected renewal. Drives the 14-day "تجديد خلال X يوم" badge and the renewal-scheduler edge function.';

create index if not exists idx_projects_next_renewal_date
  on public.projects(next_renewal_date)
  where next_renewal_date is not null;

-- 2. renewal_cycles --------------------------------------------------------
create table if not exists public.renewal_cycles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cycle_no integer not null,
  started_at date not null,
  ended_at date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (project_id, cycle_no),
  check (status in ('active', 'completed', 'cancelled'))
);

create index if not exists idx_renewal_cycles_project
  on public.renewal_cycles(project_id, cycle_no desc);

comment on table public.renewal_cycles is
  'Per-project renewal cycle ledger. cycle_no monotonic per project. status: active|completed|cancelled.';

-- 3. RLS -------------------------------------------------------------------
-- IMPORTANT (wave-2 lesson): never declare a permissive FOR ALL policy whose
-- USING/WITH CHECK references another RLS-protected table. Split into
-- SELECT and INSERT/UPDATE/DELETE.
alter table public.renewal_cycles enable row level security;

drop policy if exists renewal_cycles_select on public.renewal_cycles;
create policy renewal_cycles_select
  on public.renewal_cycles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = renewal_cycles.project_id
        and public.has_org_access(p.organization_id)
    )
  );

drop policy if exists renewal_cycles_insert on public.renewal_cycles;
create policy renewal_cycles_insert
  on public.renewal_cycles
  for insert
  to authenticated
  with check ( public.has_permission('renewal.manage') );

drop policy if exists renewal_cycles_update on public.renewal_cycles;
create policy renewal_cycles_update
  on public.renewal_cycles
  for update
  to authenticated
  using      ( public.has_permission('renewal.manage') )
  with check ( public.has_permission('renewal.manage') );

drop policy if exists renewal_cycles_delete on public.renewal_cycles;
create policy renewal_cycles_delete
  on public.renewal_cycles
  for delete
  to authenticated
  using ( public.has_permission('renewal.manage') );

-- 4. Permission seed -------------------------------------------------------
insert into public.permissions (key, description) values
  ('renewal.manage',
   'إدارة دورات التجديد: بدء دورة جديدة، تحديث جدول التجديد للمشروع')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager', 'account_manager')
  and p.key = 'renewal.manage'
on conflict do nothing;
