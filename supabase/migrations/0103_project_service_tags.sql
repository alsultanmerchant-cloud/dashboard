-- 0103_project_service_tags.sql
--
-- Sky Light feedback §3.1: tags currently exist at the project and task
-- level (project_tags + project_tag_assignments, task_tags). Add the same
-- vocabulary at the project_service level so a single service inside a
-- project can be flagged (e.g. "HOLD" while social media keeps moving).
--
-- Reuses the existing project_tags catalog (HOLD, Urgent, …) so users
-- don't manage two separate tag lists.

create table if not exists public.project_service_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_service_id uuid not null references public.project_services(id) on delete cascade,
  tag_id uuid not null references public.project_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (project_service_id, tag_id)
);

create index if not exists project_service_tag_assignments_org_idx
  on public.project_service_tag_assignments (organization_id);
create index if not exists project_service_tag_assignments_ps_idx
  on public.project_service_tag_assignments (project_service_id);
create index if not exists project_service_tag_assignments_tag_idx
  on public.project_service_tag_assignments (tag_id);

alter table public.project_service_tag_assignments enable row level security;

drop policy if exists "project_service_tags_select"
  on public.project_service_tag_assignments;
create policy "project_service_tags_select"
  on public.project_service_tag_assignments
  for select
  using (public.has_org_access(organization_id));

drop policy if exists "project_service_tags_write"
  on public.project_service_tag_assignments;
create policy "project_service_tags_write"
  on public.project_service_tag_assignments
  for all
  using (public.has_permission(organization_id, 'projects.manage'))
  with check (public.has_permission(organization_id, 'projects.manage'));

comment on table public.project_service_tag_assignments is
  'Tag a single project_services row (e.g. mark one service on a project as HOLD). Sky Light §3.1.';
