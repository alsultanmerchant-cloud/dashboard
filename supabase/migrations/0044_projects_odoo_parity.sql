-- 0044_projects_odoo_parity.sql
-- Add Rwasem-style project fields needed by the dashboard projects list,
-- plus tags + clients.address. Aligns Supabase 'projects' with what
-- src/app/(dashboard)/projects renders so the screen can read from
-- Supabase instead of Odoo XML-RPC.

begin;

-- 1. New columns on projects ------------------------------------------------
alter table public.projects
  add column if not exists project_manager_employee_id uuid references public.employee_profiles(id) on delete set null,
  add column if not exists store_name text,
  add column if not exists target text,
  add column if not exists last_update_status text,
  add column if not exists last_update_color int,
  add column if not exists color int not null default 0,
  add column if not exists is_favorite boolean not null default false;

-- target enum mirrors Odoo Rwasem custom selection on project.project
alter table public.projects
  drop constraint if exists projects_target_check;
alter table public.projects
  add constraint projects_target_check
  check (target is null or target in ('on_target','off_target','out','sales_deposit','renewed'));

-- 2. New address column on clients (Site: line in project cards) -----------
alter table public.clients
  add column if not exists address text;

-- 3. project_tags + assignments --------------------------------------------
create table if not exists public.project_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color int not null default 0,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_tags_org_external_uniq
  on public.project_tags(organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

create index if not exists project_tags_org_idx on public.project_tags(organization_id);

create table if not exists public.project_tag_assignments (
  project_id uuid not null references public.projects(id) on delete cascade,
  tag_id uuid not null references public.project_tags(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, tag_id)
);

create index if not exists project_tag_assignments_tag_idx on public.project_tag_assignments(tag_id);
create index if not exists project_tag_assignments_org_idx on public.project_tag_assignments(organization_id);

-- 4. RLS — mirror existing org-scoped pattern via has_org_access() ---------
alter table public.project_tags enable row level security;
alter table public.project_tag_assignments enable row level security;

drop policy if exists project_tags_select on public.project_tags;
create policy project_tags_select on public.project_tags
  for select using (has_org_access(organization_id));
drop policy if exists project_tags_write on public.project_tags;
create policy project_tags_write on public.project_tags
  for all using (has_org_access(organization_id))
  with check (has_org_access(organization_id));

drop policy if exists project_tag_assignments_select on public.project_tag_assignments;
create policy project_tag_assignments_select on public.project_tag_assignments
  for select using (has_org_access(organization_id));
drop policy if exists project_tag_assignments_write on public.project_tag_assignments;
create policy project_tag_assignments_write on public.project_tag_assignments
  for all using (has_org_access(organization_id))
  with check (has_org_access(organization_id));

-- 5. updated_at trigger on project_tags ------------------------------------
drop trigger if exists project_tags_set_updated_at on public.project_tags;
create trigger project_tags_set_updated_at
  before update on public.project_tags
  for each row execute function public.tg_set_updated_at();

-- 6. Aggregate view for task counts (open / closed / total per project) ----
-- Used by listProjects() to avoid N+1 aggregations.
create or replace view public.project_task_counts as
select
  p.id as project_id,
  count(t.id) as task_count,
  count(t.id) filter (where t.stage <> 'done') as open_task_count,
  count(t.id) filter (where t.stage = 'done') as closed_task_count
from public.projects p
left join public.tasks t on t.project_id = p.id
group by p.id;

commit;
