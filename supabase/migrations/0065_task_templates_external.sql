-- 0065_task_templates_external.sql
-- Adds external_source/external_id to task_templates so the Odoo
-- project.category rows can be upserted as one task_template per category.
-- Coexists with the 3 hardcoded UUIDs from 0014_seed_pdf_task_templates
-- (those keep external_source/external_id NULL).

alter table public.task_templates
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists task_templates_external_uniq
  on public.task_templates (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

comment on column public.task_templates.external_source is
  'Origin system for upsert keying (e.g. ''odoo'').';
comment on column public.task_templates.external_id is
  'Origin system row id (e.g. project.category id).';
