-- 0066_template_external_unique_full.sql
-- Replaces the partial unique indexes from 0064/0065 with full unique
-- indexes/constraints. Postgres treats NULLs as distinct in unique indexes
-- by default (NULLS DISTINCT), so existing rows with NULL externals still
-- coexist; PostgREST upsert (ON CONFLICT) requires the index to be full,
-- not partial.

drop index if exists public.task_templates_external_uniq;
create unique index if not exists task_templates_external_uniq
  on public.task_templates (organization_id, external_source, external_id);

drop index if exists public.task_template_items_external_uniq;
create unique index if not exists task_template_items_external_uniq
  on public.task_template_items (organization_id, external_source, external_id);

drop index if exists public.task_template_links_external_uniq;
create unique index if not exists task_template_links_external_uniq
  on public.task_template_links (organization_id, external_source, external_id);
