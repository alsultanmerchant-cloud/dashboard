-- 0011_odoo_external_ref.sql
-- Track the Odoo source-of-truth ID on every entity we pull from Odoo, so the
-- importer can upsert idempotently. Source defaults to 'odoo' but the column
-- is generic so we can later attribute rows to other systems if needed.

alter table public.clients
  add column if not exists external_source text,
  add column if not exists external_id bigint;

alter table public.projects
  add column if not exists external_source text,
  add column if not exists external_id bigint;

alter table public.tasks
  add column if not exists external_source text,
  add column if not exists external_id bigint;

alter table public.employee_profiles
  add column if not exists external_source text,
  add column if not exists external_id bigint;

-- One Odoo row maps to at most one dashboard row per org.
create unique index if not exists uq_clients_external
  on public.clients (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

create unique index if not exists uq_projects_external
  on public.projects (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

create unique index if not exists uq_tasks_external
  on public.tasks (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

create unique index if not exists uq_employees_external
  on public.employee_profiles (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;
