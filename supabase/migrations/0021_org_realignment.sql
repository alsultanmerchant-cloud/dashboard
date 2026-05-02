-- =========================================================================
-- Migration 0021 — Org Realignment (phase T1)
-- =========================================================================
-- Sky Light's owner spec calls for an explicit 4-tier per-department layer
-- (Head → Team Leads → Specialists / Agents) plus a way to assign the head
-- and team-lead seats. Migration 0018 already shipped:
--   * `department_kind` enum (group | account_management | main_section |
--     supporting_section | quality_control | other)
--   * parent_department_id wiring for grouping
--   * leaf rows for the 7 technical departments + admin/finance/sales
--
-- This migration is purely additive on top of that:
--   1. departments.head_user_id  (FK auth.users) — owner-spec literal column
--   2. employee_profiles.position (head | team_lead | specialist | agent | admin)
--   3. department_team_leads     (multi-lead, per-department)
--   4. permission 'org.manage_structure' bound to owner + admin
--
-- We DO NOT recreate the kind enum, do NOT reseed departments, and do NOT
-- touch the existing `departments.head_employee_id` column. UI code can
-- continue to use `head_employee_id` for joins; `head_user_id` exists to
-- satisfy the owner spec verbatim and is intended for any callers that
-- already hold an auth user id.
-- All operations are idempotent; safe to re-run.
-- =========================================================================

-- 1. departments.head_user_id ----------------------------------------------
alter table public.departments
  add column if not exists head_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_departments_head_user
  on public.departments(head_user_id)
  where head_user_id is not null;

comment on column public.departments.head_user_id is
  'Optional auth.users link for the department head. Co-exists with head_employee_id which is the canonical UI join.';

-- 2. employee_profiles.position --------------------------------------------
alter table public.employee_profiles
  add column if not exists position text;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'employee_profiles'
      and constraint_name = 'employee_profiles_position_check'
  ) then
    alter table public.employee_profiles
      add constraint employee_profiles_position_check
      check (position is null or position in ('head','team_lead','specialist','agent','admin'));
  end if;
end$$;

create index if not exists idx_employee_profiles_position
  on public.employee_profiles(organization_id, position)
  where position is not null;

comment on column public.employee_profiles.position is
  '4-tier org position per owner spec §16: head | team_lead | specialist | agent | admin. NULL = unset (legacy/imported users awaiting review).';

-- 3. department_team_leads -------------------------------------------------
create table if not exists public.department_team_leads (
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id       uuid not null references auth.users(id)         on delete cascade,
  added_by      uuid references auth.users(id),
  added_at      timestamptz not null default now(),
  primary key (department_id, user_id)
);

comment on table public.department_team_leads is
  'Per-department Team Leads (multi-lead). Owner-confirmed seat counts: AM=3, Media Buying=1, SEO=2, Social Media=1.';

create index if not exists idx_department_team_leads_user
  on public.department_team_leads(user_id);

-- RLS ----------------------------------------------------------------------
alter table public.department_team_leads enable row level security;

drop policy if exists department_team_leads_select on public.department_team_leads;
create policy department_team_leads_select
  on public.department_team_leads
  for select
  to authenticated
  using (true);

drop policy if exists department_team_leads_insert on public.department_team_leads;
create policy department_team_leads_insert
  on public.department_team_leads
  for insert
  to authenticated
  with check (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'org.manage_structure'
    )
  );

drop policy if exists department_team_leads_update on public.department_team_leads;
create policy department_team_leads_update
  on public.department_team_leads
  for update
  to authenticated
  using (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'org.manage_structure'
    )
  )
  with check (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'org.manage_structure'
    )
  );

drop policy if exists department_team_leads_delete on public.department_team_leads;
create policy department_team_leads_delete
  on public.department_team_leads
  for delete
  to authenticated
  using (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'org.manage_structure'
    )
  );

-- 4. Permission seed -------------------------------------------------------
insert into public.permissions (key, description) values
  ('org.manage_structure',
   'تعديل هيكل الوكالة: رؤساء الأقسام، قادة الفرق، مناصب الموظفين')
on conflict (key) do nothing;

-- Bind to owner + admin roles (idempotent — owner already gets all perms via
-- the catch-all in 0006, but re-asserting keeps re-runs deterministic).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin')
  and p.key = 'org.manage_structure'
on conflict do nothing;
