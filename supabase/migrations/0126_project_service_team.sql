-- 0126_project_service_team.sql
--
-- Per-project team assignment. When a project is created and a service is
-- added, the operator assigns a real employee to each position that the
-- service's task templates use (one employee per position per service), and
-- may add extra people who join every task of that service.
--
--   project + service + position  →  employee
--
-- Task generation reads this map to fill task_assignees: a task's assignees
-- are the employees mapped to the positions it uses, plus the service's
-- extras. The per-stage owner is then the assignee whose position matches.

create table if not exists public.project_service_team (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  -- true = an extra person the operator added (joins every task of the
  -- service); false = the assignee for a position the templates reference.
  is_extra boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (project_id, service_id, position_id)
);

create index if not exists project_service_team_project_idx
  on public.project_service_team (project_id);
create index if not exists project_service_team_service_idx
  on public.project_service_team (service_id);

alter table public.project_service_team enable row level security;

drop policy if exists "project_service_team_select" on public.project_service_team;
create policy "project_service_team_select"
  on public.project_service_team
  for select
  using (public.has_org_access(organization_id));

drop policy if exists "project_service_team_write" on public.project_service_team;
create policy "project_service_team_write"
  on public.project_service_team
  for all
  using (public.has_permission(organization_id, 'projects.manage'))
  with check (public.has_permission(organization_id, 'projects.manage'));

comment on table public.project_service_team is
  'Per-project, per-service position → employee assignment decided at project '
  'creation. Task generation reads this to fill task_assignees.';
