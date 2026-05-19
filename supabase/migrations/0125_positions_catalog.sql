-- 0125_positions_catalog.sql
--
-- Unified job-title / role catalog.
--
-- A "position" is the granular job title shown on the employee form. Each
-- position maps to exactly one of the 7 structural task roles, which is what
-- task auto-assignment resolves against. The flow is:
--
--   employee.position_id  →  positions.role  →  resolved assignee
--
-- Task templates pick a position (by slug) for each item / stage; task
-- generation resolves position → role → employee. New positions are added
-- straight from the employee form (combobox) and immediately appear as
-- options in task templates.

-- 1. team_lead joins the task role enum. Positions with role 'team_lead' now
--    resolve to a real assignee, so task_assignees.role_type must accept it.
alter type public.task_role_type add value if not exists 'team_lead';

-- 2. positions catalog. `slug` is the stable key carried by task templates
--    (`default_role_key` / `stage_owner_positions`); the 7 system rows use
--    the legacy role keys as their slug so existing template data stays valid
--    with no rewrite. `role` is the structural bucket used for resolution.
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  role text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint positions_role_check check (role in (
    'specialist','manager','account_manager','team_lead',
    'agent','supporting_lead','supporting_agent'
  )),
  unique (organization_id, slug)
);

create index if not exists positions_org_idx on public.positions (organization_id);

alter table public.positions enable row level security;

drop policy if exists "positions_select" on public.positions;
create policy "positions_select"
  on public.positions
  for select
  using (public.has_org_access(organization_id));

drop policy if exists "positions_write" on public.positions;
create policy "positions_write"
  on public.positions
  for all
  using (public.has_permission(organization_id, 'employees.manage'))
  with check (public.has_permission(organization_id, 'employees.manage'));

-- 3. Seed the 7 system positions for every organization. slug == role so the
--    existing task-template `default_role_key` values ('specialist', …) keep
--    resolving without a data migration.
insert into public.positions (organization_id, slug, name, role, is_system)
select o.id, v.slug, v.name, v.slug, true
from public.organizations o
cross join (values
  ('specialist',       'المتخصص'),
  ('manager',          'مدير القسم'),
  ('account_manager',  'مدير الحساب'),
  ('team_lead',        'قائد الفريق'),
  ('agent',            'المنفّذ'),
  ('supporting_lead',  'قائد القسم المساند'),
  ('supporting_agent', 'منفّذ القسم المساند')
) as v(slug, name)
on conflict (organization_id, slug) do nothing;

-- 4. Link employees to a position. job_title (free text) is kept as a
--    denormalised display copy synced by the server action.
alter table public.employee_profiles
  add column if not exists position_id uuid
    references public.positions(id) on delete set null;

create index if not exists employee_profiles_position_id_idx
  on public.employee_profiles (position_id);

-- 5. Best-effort backfill: existing free-text job titles that exactly match a
--    seeded position's slug or name get linked. Everything else stays null
--    until an admin re-picks the position on the employee form.
update public.employee_profiles e
set position_id = p.id
from public.positions p
where p.organization_id = e.organization_id
  and e.position_id is null
  and e.job_title is not null
  and lower(trim(e.job_title)) in (lower(p.slug), lower(p.name));

comment on table public.positions is
  'Job-title catalog. Each position maps to one of 7 structural task roles; '
  'task generation resolves position -> role -> employee. slug is the stable '
  'key referenced by task_template_items.default_role_key / stage_owner_positions.';
comment on column public.employee_profiles.position_id is
  'FK to positions. The employee form combobox sets this; job_title is kept '
  'in sync as a display copy.';
