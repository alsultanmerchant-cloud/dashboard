-- 0040_services_external_ref.sql
-- The Odoo importer (extended) upserts service rows keyed on
-- (organization_id, external_source='odoo', external_id=odoo_category_id)
-- so re-runs replace existing rows instead of duplicating. The clients,
-- projects, tasks, and employee_profiles tables already had this triple
-- via 0011 — services was missed.

alter table public.services
  add column if not exists external_source text,
  add column if not exists external_id text;

-- Unique on the import triple so .upsert(onConflict: 'organization_id,external_source,external_id')
-- works the same way it does on the other imported tables.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'services_org_ext_key'
  ) then
    alter table public.services
      add constraint services_org_ext_key
      unique (organization_id, external_source, external_id);
  end if;
end$$;
