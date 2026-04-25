-- 0001_extensions_and_core.sql
-- Agency Command Center — core organization, RBAC, and people tables.
-- Multi-tenant schema (every domain table carries organization_id) so future
-- expansion is safe even though the MVP UI runs single-tenant.

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- updated_at maintenance
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- organizations
-- =========================================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  default_locale text not null default 'ar',
  timezone text not null default 'Asia/Riyadh',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- departments
-- =========================================================================
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  parent_department_id uuid references public.departments(id) on delete set null,
  head_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index if not exists idx_departments_org on public.departments(organization_id);
create index if not exists idx_departments_parent on public.departments(parent_department_id);

create trigger trg_departments_updated_at
before update on public.departments
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- employee_profiles
-- =========================================================================
create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  job_title text,
  avatar_url text,
  employment_status text not null default 'active'
    check (employment_status in ('active','on_leave','suspended','terminated')),
  manager_employee_id uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_employees_org on public.employee_profiles(organization_id);
create index if not exists idx_employees_dept on public.employee_profiles(department_id);
create index if not exists idx_employees_user on public.employee_profiles(user_id);
create index if not exists idx_employees_manager on public.employee_profiles(manager_employee_id);

create trigger trg_employees_updated_at
before update on public.employee_profiles
for each row execute function public.tg_set_updated_at();

-- Late FK to close the cycle with departments.head_employee_id
alter table public.departments
  add constraint departments_head_employee_fk
  foreign key (head_employee_id)
  references public.employee_profiles(id)
  on delete set null;

-- =========================================================================
-- roles & permissions
-- =========================================================================
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  key text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create trigger trg_roles_updated_at
before update on public.roles
for each row execute function public.tg_set_updated_at();

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, role_id)
);

create index if not exists idx_user_roles_user on public.user_roles(user_id);
create index if not exists idx_user_roles_org on public.user_roles(organization_id);

-- =========================================================================
-- Helpers used by RLS policies and server code
-- =========================================================================
create or replace function public.current_user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.employee_profiles where user_id = auth.uid()
  union
  select organization_id from public.user_roles where user_id = auth.uid();
$$;

create or replace function public.has_org_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employee_profiles
    where user_id = auth.uid() and organization_id = target_org
    union
    select 1 from public.user_roles
    where user_id = auth.uid() and organization_id = target_org
  );
$$;

create or replace function public.has_permission(target_org uuid, perm_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and ur.organization_id = target_org
      and p.key = perm_key
  );
$$;

grant execute on function public.current_user_organization_ids() to authenticated;
grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
