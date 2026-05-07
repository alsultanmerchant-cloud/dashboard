-- 0049_project_specialist_slots.sql
-- Adds the 3 specialist role slots on projects to mirror Sky Light's
-- rwasem_customer_report extension fields. Each is an optional FK to
-- employee_profiles. Auto-assignment from these slots into task_assignees
-- can be wired by the project-creation flow in a follow-up; this migration
-- only lays the schema and indexes.
--
-- Mirrors:
--   project.project.social_specialist_id  (rwasem_customer_report)
--   project.project.media_specialist_id   (rwasem_customer_report)
--   project.project.seo_specialist_id     (rwasem_customer_report)

alter table public.projects
  add column if not exists social_specialist_id uuid
    references public.employee_profiles(id) on delete set null,
  add column if not exists media_specialist_id uuid
    references public.employee_profiles(id) on delete set null,
  add column if not exists seo_specialist_id uuid
    references public.employee_profiles(id) on delete set null;

create index if not exists idx_projects_social_specialist
  on public.projects(organization_id, social_specialist_id)
  where social_specialist_id is not null;

create index if not exists idx_projects_media_specialist
  on public.projects(organization_id, media_specialist_id)
  where media_specialist_id is not null;

create index if not exists idx_projects_seo_specialist
  on public.projects(organization_id, seo_specialist_id)
  where seo_specialist_id is not null;

comment on column public.projects.social_specialist_id is
  'Project-level Social Media specialist slot (mirrors Odoo rwasem_customer_report.social_specialist_id). Used for default task assignment and per-role authorization.';
comment on column public.projects.media_specialist_id is
  'Project-level Media Buying specialist slot (mirrors Odoo rwasem_customer_report.media_specialist_id).';
comment on column public.projects.seo_specialist_id is
  'Project-level SEO specialist slot (mirrors Odoo rwasem_customer_report.seo_specialist_id).';
