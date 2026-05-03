-- =========================================================================
-- Migration 0024 — Categories Engine (phase T4)
-- =========================================================================
-- Goal: port Odoo's project.category + project.category.task engine so that
-- selecting services on a new project auto-generates the right tasks with
-- correct deadlines, owners and followers.
--
-- Schema reality (verified before writing this migration):
--   * services                — already seeded (3 rows: Social Media, SEO,
--                               Media Buying), has organization_id.
--   * task_templates          — already exists, keyed by service_id.
--   * task_template_items     — already exists, has offset/duration/role
--                               columns and supports week_index.
--   * project_services        — already exists, primary key (id) but unique
--                               (project_id, service_id) by usage.
--
-- This migration is purely ADDITIVE:
--   1. service_categories — per-org named service buckets (Odoo "category").
--      Each row points to one of the existing services rows. Lets a single
--      service host multiple "package" flavours (e.g. SM Lite vs SM Pro)
--      without duplicating the service row.
--   2. ALTER task_templates  → add category_id, default_owner_position,
--                               deadline_offset_days, upload_offset_days,
--                               default_followers_positions[],
--                               depends_on_template_id,
--                               sla_minutes_new, sla_minutes_in_progress,
--                               sort_order.
--   3. ALTER project_services → add category_id, week_split, weeks.
--   4. RLS for service_categories using has_permission (1-arg overload).
--   5. Permission 'category.manage_templates' bound to admin + manager.
-- =========================================================================

-- 1. service_categories ----------------------------------------------------
create table if not exists public.service_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id      uuid references public.services(id) on delete set null,
  key             text not null,
  name_ar         text not null,
  name_en         text,
  color           text,
  description     text,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  external_source text,
  external_id     bigint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

comment on table public.service_categories is
  'Service-delivery buckets (Odoo project.category). One row per (org, key). Each maps optionally to a services row; task_templates hang off here.';

create index if not exists idx_service_categories_org
  on public.service_categories(organization_id);
create index if not exists idx_service_categories_service
  on public.service_categories(service_id);

-- updated_at trigger — reuse existing helper if defined, else inline.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_service_categories_updated_at on public.service_categories;
    execute $tg$
      create trigger trg_service_categories_updated_at
      before update on public.service_categories
      for each row execute function public.set_updated_at();
    $tg$;
  end if;
end$$;

-- 2. task_templates additions ---------------------------------------------
alter table public.task_templates
  add column if not exists category_id uuid references public.service_categories(id) on delete set null,
  add column if not exists default_owner_position text,
  add column if not exists deadline_offset_days integer,
  add column if not exists upload_offset_days integer,
  add column if not exists default_followers_positions text[] not null default '{}',
  add column if not exists depends_on_template_id uuid references public.task_templates(id) on delete set null,
  add column if not exists sla_minutes_new integer,
  add column if not exists sla_minutes_in_progress integer,
  add column if not exists sort_order integer not null default 0;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='task_templates'
      and constraint_name='task_templates_default_owner_position_check'
  ) then
    alter table public.task_templates
      add constraint task_templates_default_owner_position_check
      check (default_owner_position is null
             or default_owner_position in ('head','team_lead','specialist','agent','admin','account_manager'));
  end if;
end$$;

create index if not exists idx_task_templates_category
  on public.task_templates(category_id);
create index if not exists idx_task_templates_depends_on
  on public.task_templates(depends_on_template_id);

-- 3. project_services additions -------------------------------------------
alter table public.project_services
  add column if not exists category_id uuid references public.service_categories(id) on delete set null,
  add column if not exists week_split  boolean not null default false,
  add column if not exists weeks       integer;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='project_services'
      and constraint_name='project_services_weeks_check'
  ) then
    alter table public.project_services
      add constraint project_services_weeks_check
      check (weeks is null or weeks between 1 and 12);
  end if;
end$$;

create index if not exists idx_project_services_category
  on public.project_services(category_id);

-- 4. RLS on service_categories --------------------------------------------
alter table public.service_categories enable row level security;

drop policy if exists service_categories_select on public.service_categories;
create policy service_categories_select
  on public.service_categories
  for select
  to authenticated
  using (true);

drop policy if exists service_categories_insert on public.service_categories;
create policy service_categories_insert
  on public.service_categories
  for insert
  to authenticated
  with check ( public.has_permission('category.manage_templates') );

drop policy if exists service_categories_update on public.service_categories;
create policy service_categories_update
  on public.service_categories
  for update
  to authenticated
  using      ( public.has_permission('category.manage_templates') )
  with check ( public.has_permission('category.manage_templates') );

drop policy if exists service_categories_delete on public.service_categories;
create policy service_categories_delete
  on public.service_categories
  for delete
  to authenticated
  using ( public.has_permission('category.manage_templates') );

-- 5. Permission seed ------------------------------------------------------
insert into public.permissions (key, description) values
  ('category.manage_templates',
   'إدارة تصنيفات الخدمات وقوالب المهام: إنشاء، تعديل، إزالة')
on conflict (key) do nothing;

-- Bind to owner (already gets all perms via 0006 catch-all but make explicit),
-- admin, and manager (head-of-department in T1 terminology).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager')
  and p.key = 'category.manage_templates'
on conflict do nothing;

-- 6. Backfill: link the seeded English-named master templates to a default
--    "primary" category per service so the createProject expansion still
--    finds them when a project_services row carries no category_id.
--    Idempotent: only inserts service_categories rows if they don't exist.
insert into public.service_categories (organization_id, service_id, key, name_ar, name_en, sort_order)
select
  s.organization_id,
  s.id,
  'primary:' || s.slug,
  s.name,
  s.slug,
  0
from public.services s
on conflict (organization_id, key) do nothing;

update public.task_templates tt
set category_id = sc.id
from public.services s
join public.service_categories sc
  on sc.service_id = s.id
 and sc.key = 'primary:' || s.slug
where tt.service_id = s.id
  and tt.category_id is null;

comment on column public.task_templates.category_id is
  'Optional link to a service_categories row. NULL templates remain service-wide defaults.';
comment on column public.task_templates.deadline_offset_days is
  'Days from project.start_date to the task deadline. Falls back to task_template_items.offset_days_from_project_start + duration_days when null.';
comment on column public.task_templates.upload_offset_days is
  'Days BEFORE the task deadline by which the upload must be submitted (PDF §11). Falls back to task_template_items.upload_offset_days_before_deadline.';
comment on column public.task_templates.default_followers_positions is
  'Positions whose holders are auto-attached as followers on generated tasks (T3 task_followers).';
