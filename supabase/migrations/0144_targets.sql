-- =========================================================================
-- Migration 0144 — Per-employee + per-department monthly targets
-- =========================================================================
-- Mirrors am_targets (0026b) but for operational delivery targets used by
-- Monthly Closing (achieved-vs-target). `month` is the first-of-month date.
-- RLS read via has_org_access; write gated by target.manage.
-- =========================================================================

create table if not exists public.employee_targets (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations(id) on delete cascade,
  employee_profile_id         uuid not null references public.employee_profiles(id) on delete cascade,
  month                       date not null,
  target_completed_tasks      int not null default 0,
  target_designs              int not null default 0,
  target_on_time_pct          numeric(5,2),
  target_quality_max_revisions numeric(5,2),
  notes                       text,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (organization_id, employee_profile_id, month)
);

create index if not exists idx_employee_targets_org   on public.employee_targets(organization_id);
create index if not exists idx_employee_targets_emp   on public.employee_targets(employee_profile_id);
create index if not exists idx_employee_targets_month on public.employee_targets(month);

create table if not exists public.department_targets (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  department_id             uuid not null references public.departments(id) on delete cascade,
  month                     date not null,
  target_completed_tasks    int not null default 0,
  target_on_time_pct        numeric(5,2),
  target_projects_delivered int not null default 0,
  notes                     text,
  created_by                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organization_id, department_id, month)
);

create index if not exists idx_department_targets_org   on public.department_targets(organization_id);
create index if not exists idx_department_targets_dept  on public.department_targets(department_id);
create index if not exists idx_department_targets_month on public.department_targets(month);

drop trigger if exists trg_employee_targets_updated_at on public.employee_targets;
create trigger trg_employee_targets_updated_at
  before update on public.employee_targets
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_department_targets_updated_at on public.department_targets;
create trigger trg_department_targets_updated_at
  before update on public.department_targets
  for each row execute function public.tg_set_updated_at();

alter table public.employee_targets   enable row level security;
alter table public.department_targets enable row level security;

-- employee_targets policies
drop policy if exists employee_targets_select on public.employee_targets;
create policy employee_targets_select on public.employee_targets
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists employee_targets_write on public.employee_targets;
create policy employee_targets_write on public.employee_targets
  for all to authenticated
  using      (public.has_permission(organization_id, 'target.manage'))
  with check (public.has_permission(organization_id, 'target.manage'));

-- department_targets policies
drop policy if exists department_targets_select on public.department_targets;
create policy department_targets_select on public.department_targets
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists department_targets_write on public.department_targets;
create policy department_targets_write on public.department_targets
  for all to authenticated
  using      (public.has_permission(organization_id, 'target.manage'))
  with check (public.has_permission(organization_id, 'target.manage'));
