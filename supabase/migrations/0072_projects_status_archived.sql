-- 0072_projects_status_archived.sql
-- Add 'archived' to projects.status so the importer can mark Odoo projects
-- whose `active` field flipped to false. Keeps Supabase counts aligned with
-- Odoo's "active = true" kanban without dropping rows.
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status = any (array['active','on_hold','completed','cancelled','archived']));
