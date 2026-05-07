-- 0070_project_field_gaps.sql
-- Adds project fields present on Odoo project.project but missing here.
--
-- Origin in Odoo:
--   site_address / site_address_display / site_latitude / site_longitude
--                                          — rwasem_project_category_enhancements
--   financial_info                         — rwasem_project_category_enhancements
--   total_progress                         — rwasem_project_task_progress
--   document_count                         — rwasem_document_management_project
--   has_active_category                    — rwasem_project_category_enhancements (computed; we store last value)

alter table public.projects
  add column if not exists site_address text,
  add column if not exists site_address_display text,
  add column if not exists site_latitude double precision,
  add column if not exists site_longitude double precision,
  add column if not exists financial_info text,
  add column if not exists total_progress numeric(5,2) not null default 0,
  add column if not exists document_count integer not null default 0,
  add column if not exists has_active_category boolean not null default false;
