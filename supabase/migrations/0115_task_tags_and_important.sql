-- 0115_task_tags_and_important.sql
--
-- Odoo task-detail parity: two fields visible on the Rwasem task form that
-- the importer wasn't syncing.
--   • tasks.is_important    ← Odoo project.task.ks_mark_important ("Mark As Important")
--   • task_tag_assignments  ← Odoo project.task.tag_ids (m2m → project.tags)
-- Reuses the existing project_tags catalog, mirroring project_tag_assignments.

alter table public.tasks
  add column if not exists is_important boolean not null default false;

create table if not exists public.task_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag_id uuid not null references public.project_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (task_id, tag_id)
);

create index if not exists task_tag_assignments_org_idx
  on public.task_tag_assignments (organization_id);
create index if not exists task_tag_assignments_task_idx
  on public.task_tag_assignments (task_id);
create index if not exists task_tag_assignments_tag_idx
  on public.task_tag_assignments (tag_id);

alter table public.task_tag_assignments enable row level security;

drop policy if exists "task_tags_select" on public.task_tag_assignments;
create policy "task_tags_select"
  on public.task_tag_assignments
  for select
  using (public.has_org_access(organization_id));

drop policy if exists "task_tags_write" on public.task_tag_assignments;
create policy "task_tags_write"
  on public.task_tag_assignments
  for all
  using (public.has_permission(organization_id, 'tasks.manage'))
  with check (public.has_permission(organization_id, 'tasks.manage'));

comment on table public.task_tag_assignments is
  'Task <-> project_tags m2m. Mirrors Odoo project.task.tag_ids. Synced by the Odoo importer.';
comment on column public.tasks.is_important is
  'Odoo project.task.ks_mark_important - the "Mark As Important" star.';
