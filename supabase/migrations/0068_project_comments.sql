-- 0068_project_comments.sql
-- Project-level chatter (mirrors mail.message on project.project, 566 rows live).
-- Same shape as task_comments so the UI can share a renderer.

create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  external_author_name text,
  external_author_avatar_url text,
  body text not null,
  is_internal boolean not null default true,
  kind text not null default 'note',
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_comments_author_check
    check (author_user_id is not null or external_id is not null)
);

create index if not exists idx_project_comments_project on public.project_comments(project_id, created_at desc);
create unique index if not exists project_comments_external_uniq
  on public.project_comments(organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

alter table public.project_comments enable row level security;

drop policy if exists project_comments_select on public.project_comments;
create policy project_comments_select on public.project_comments
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists project_comments_write on public.project_comments;
create policy project_comments_write on public.project_comments
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  )
  with check (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  );
