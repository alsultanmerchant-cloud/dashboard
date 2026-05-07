-- 0069_task_field_gaps.sql
-- Adds task fields that exist on Odoo project.task but were missing in
-- public.tasks. Importer (sync-odoo) populates them from live Odoo.
--
-- Origin in Odoo:
--   date_assign / date_end                — rwasem_project_category_enhancements
--   duration_days / working_days_open / working_days_close — eg_task_stage_duration
--   design_count                          — project_customization
--   document_count                        — rwasem_document_management_project
--   duration_tracking (jsonb)             — Odoo core
--   email_cc                              — Odoo core

alter table public.tasks
  add column if not exists date_assign date,
  add column if not exists date_end date,
  add column if not exists duration_days integer,
  add column if not exists working_days_open numeric(8,3),
  add column if not exists working_days_close numeric(8,3),
  add column if not exists design_count integer not null default 0,
  add column if not exists document_count integer not null default 0,
  add column if not exists duration_tracking jsonb,
  add column if not exists email_cc text;

create index if not exists idx_tasks_date_assign on public.tasks(date_assign) where date_assign is not null;
create index if not exists idx_tasks_date_end on public.tasks(date_end) where date_end is not null;
