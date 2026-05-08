-- 0073_project_followers.sql
-- Project-level followers (mirrors mail.followers on project.project, 232
-- rows across 74 active projects in live Odoo). Same shape as
-- task_followers but scoped to a project; employee-id-keyed so RLS can
-- gate by employee_profiles.user_id.

create table if not exists public.project_followers (
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  external_source text,
  external_id text,
  primary key (project_id, employee_id)
);

create index if not exists idx_project_followers_project on public.project_followers(project_id);
create index if not exists idx_project_followers_employee on public.project_followers(employee_id);
create unique index if not exists project_followers_external_uniq
  on public.project_followers(organization_id, external_source, external_id);

alter table public.project_followers enable row level security;

drop policy if exists project_followers_select on public.project_followers;
create policy project_followers_select on public.project_followers
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists project_followers_write on public.project_followers;
create policy project_followers_write on public.project_followers
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission(organization_id, 'projects.manage')
      or exists (
        select 1 from public.employee_profiles ep
         where ep.id = project_followers.employee_id
           and ep.user_id = auth.uid()
      )
    )
  )
  with check (
    public.has_org_access(organization_id)
    and (
      public.has_permission(organization_id, 'projects.manage')
      or exists (
        select 1 from public.employee_profiles ep
         where ep.id = project_followers.employee_id
           and ep.user_id = auth.uid()
      )
    )
  );
