-- 0067_attachments.sql
-- Adds task_attachments + project_attachments tables to mirror Odoo
-- ir.attachment rows linked to project.task / project.project. Supabase
-- Storage bucket "attachments" backs the binaries; rows here carry only
-- metadata + the storage path so re-syncs don't blow up size.
--
-- Decision: import metadata + a fallback Odoo URL ("source_url") so the
-- 7K+ existing files remain viewable without forcing a multi-GB binary
-- migration up front. A future job can lazily download to Storage.

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  task_comment_id uuid references public.task_comments(id) on delete set null,
  filename text not null,
  mimetype text,
  size_bytes bigint,
  storage_path text,           -- supabase storage object key (nullable until uploaded)
  source_url text,             -- fallback URL (e.g. Odoo /web/content/{id})
  uploaded_by uuid references auth.users(id) on delete set null,
  external_source text,
  external_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_attachments_task on public.task_attachments(task_id, created_at desc);
create index if not exists idx_task_attachments_comment on public.task_attachments(task_comment_id) where task_comment_id is not null;
create unique index if not exists task_attachments_external_uniq
  on public.task_attachments(organization_id, external_source, external_id);

create table if not exists public.project_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  filename text not null,
  mimetype text,
  size_bytes bigint,
  storage_path text,
  source_url text,
  uploaded_by uuid references auth.users(id) on delete set null,
  external_source text,
  external_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_attachments_project on public.project_attachments(project_id, created_at desc);
create unique index if not exists project_attachments_external_uniq
  on public.project_attachments(organization_id, external_source, external_id);

alter table public.task_attachments enable row level security;
alter table public.project_attachments enable row level security;

drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists task_attachments_write on public.task_attachments;
create policy task_attachments_write on public.task_attachments
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'tasks.manage')
  )
  with check (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'tasks.manage')
  );

drop policy if exists project_attachments_select on public.project_attachments;
create policy project_attachments_select on public.project_attachments
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists project_attachments_write on public.project_attachments;
create policy project_attachments_write on public.project_attachments
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  )
  with check (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  );

-- Storage bucket for new uploads (private; signed URLs only).
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Storage policies: any authenticated org member can read/write objects
-- under attachments/. Path-level scoping (org/project/task) is enforced at
-- the application layer when generating signed URLs.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'attachments_org_read'
  ) then
    create policy attachments_org_read on storage.objects
      for select to authenticated
      using (bucket_id = 'attachments');
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'attachments_org_write'
  ) then
    create policy attachments_org_write on storage.objects
      for insert to authenticated
      with check (bucket_id = 'attachments');
  end if;
end $$;
