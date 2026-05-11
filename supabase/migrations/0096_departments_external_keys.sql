-- 0096 — Sky Light feedback: pull org structure (departments + positions +
-- managers) from Odoo. The importer needs an idempotent key on departments
-- so re-running doesn't duplicate rows. employee_profiles already has the
-- (external_source, external_id) pair from migration 0011; mirror that here
-- and seed the source for hr.department imports.

alter table public.departments
  add column if not exists external_source text,
  add column if not exists external_id text;

-- Full (not partial) unique index — Postgres treats NULLs as distinct, so
-- native (non-Odoo) departments with null external_source/external_id can
-- still coexist. A partial index breaks PostgREST's upsert ON CONFLICT path
-- because it can't infer a matching constraint from a partial index.
drop index if exists public.departments_org_external_uniq;
create unique index if not exists departments_org_external_uniq
  on public.departments(organization_id, external_source, external_id);
