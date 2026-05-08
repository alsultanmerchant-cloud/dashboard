-- 0076_project_role_managers.sql
-- Per-role team manager / leader on a project. Sky Light's PDF §9 lists
-- 4 tiers: Account Manager / Section Head (manager) / Specialist / Agent.
-- Until now we only had one slot per specialty (specialist). Add the
-- manager partner so each role has BOTH the specialist who does the work
-- AND the section head accountable for it.
alter table public.projects
  add column if not exists social_manager_id uuid references public.employee_profiles(id) on delete set null,
  add column if not exists media_manager_id  uuid references public.employee_profiles(id) on delete set null,
  add column if not exists seo_manager_id    uuid references public.employee_profiles(id) on delete set null;

create index if not exists idx_projects_social_manager on public.projects(social_manager_id) where social_manager_id is not null;
create index if not exists idx_projects_media_manager  on public.projects(media_manager_id)  where media_manager_id  is not null;
create index if not exists idx_projects_seo_manager    on public.projects(seo_manager_id)    where seo_manager_id    is not null;
