-- 0064_template_items_external_and_links.sql
-- Schema groundwork to ingest the 279 Odoo `project.category.task` rows.
-- Adds:
--   1. task_template_items.code             — Odoo task_code (e.g. PRJ-007-014)
--   2. task_template_items.requires_approval — Odoo requires_approval flag
--   3. task_template_items.external_source / external_id — for idempotent upsert
--   4. task_template_links table             — template-level FS/SS/FF/SF links
-- Existing seeded rows (0014_seed_pdf_task_templates) coexist; they have NULL
-- external_source/external_id so re-syncs don't touch them.

alter table public.task_template_items
  add column if not exists code text,
  add column if not exists requires_approval boolean not null default false,
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists task_template_items_external_uniq
  on public.task_template_items (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

create index if not exists task_template_items_template_code_idx
  on public.task_template_items (task_template_id, code)
  where code is not null;

comment on column public.task_template_items.code is
  'Optional human-readable code (mirrors tasks.task_code; sourced from Odoo task_code).';
comment on column public.task_template_items.requires_approval is
  'When true, instantiated tasks default approval_required=true.';
comment on column public.task_template_items.external_source is
  'Origin system for upsert keying (e.g. ''odoo'').';
comment on column public.task_template_items.external_id is
  'Origin system row id (e.g. project.category.task id).';

create table if not exists public.task_template_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  source_item_id uuid not null references public.task_template_items(id) on delete cascade,
  target_item_id uuid not null references public.task_template_items(id) on delete cascade,
  dependency_type public.task_dependency_type not null default 'finish_to_start',
  lag_days integer not null default 0,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  constraint task_template_links_no_self check (source_item_id <> target_item_id),
  constraint task_template_links_org_template check (organization_id is not null)
);

create unique index if not exists task_template_links_natural_uniq
  on public.task_template_links (task_template_id, source_item_id, target_item_id, dependency_type);

create unique index if not exists task_template_links_external_uniq
  on public.task_template_links (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

create index if not exists task_template_links_template_idx
  on public.task_template_links (task_template_id);

comment on table public.task_template_links is
  'Template-level dependency links (mirrors task_links structure for project.category.task targets).';

alter table public.task_template_links enable row level security;

drop policy if exists task_template_links_read on public.task_template_links;
create policy task_template_links_read on public.task_template_links
  for select using (public.has_org_access(organization_id));

drop policy if exists task_template_links_write on public.task_template_links;
create policy task_template_links_write on public.task_template_links
  for all using (public.has_permission(organization_id, 'tasks.manage'))
  with check (public.has_permission(organization_id, 'tasks.manage'));
