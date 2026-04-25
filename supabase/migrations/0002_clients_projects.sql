-- 0002_clients_projects.sql
-- Services catalogue, clients, and project domain (project, services, members).

-- =========================================================================
-- services
-- =========================================================================
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index if not exists idx_services_org on public.services(organization_id);

create trigger trg_services_updated_at
before update on public.services
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- clients
-- =========================================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  company_website text,
  source text,
  status text not null default 'active'
    check (status in ('active','inactive','lead')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_clients_org on public.clients(organization_id);
create index if not exists idx_clients_status on public.clients(organization_id, status);

create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- projects
-- =========================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null,
  description text,
  status text not null default 'active'
    check (status in ('active','on_hold','completed','cancelled')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  start_date date,
  end_date date,
  account_manager_employee_id uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_projects_org on public.projects(organization_id);
create index if not exists idx_projects_client on public.projects(client_id);
create index if not exists idx_projects_status on public.projects(organization_id, status);
create index if not exists idx_projects_am on public.projects(account_manager_employee_id);

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- project_services
-- =========================================================================
create table if not exists public.project_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active','paused','completed')),
  created_at timestamptz not null default now(),
  unique (project_id, service_id)
);

create index if not exists idx_project_services_org on public.project_services(organization_id);
create index if not exists idx_project_services_project on public.project_services(project_id);

-- =========================================================================
-- project_members
-- =========================================================================
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  role_label text,
  created_at timestamptz not null default now(),
  unique (project_id, employee_id)
);

create index if not exists idx_project_members_org on public.project_members(organization_id);
create index if not exists idx_project_members_project on public.project_members(project_id);
create index if not exists idx_project_members_employee on public.project_members(employee_id);
