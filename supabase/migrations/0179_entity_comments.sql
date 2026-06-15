-- =========================================================================
-- 0179 — Entity comments (polymorphic notes for contracts & clients).
--
-- Brings the Sky Light task "Log note" experience to contracts and clients:
-- a floating composer with @mentions + attachments, plus a unified activity
-- feed that merges these comments with the synced sheet logs
-- (contract_sheet_logs, 0178) and contract events (contract_events).
--
-- Polymorphic over (entity_type, entity_id) so one composer/feed serves both
-- contracts and clients. Mirrors task_comments (0003) + its mention/attachment
-- side tables.
-- =========================================================================

create table if not exists public.entity_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('contract', 'client')),
  entity_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  is_internal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entity_comments_lookup_idx
  on public.entity_comments (organization_id, entity_type, entity_id, created_at desc);
create index if not exists entity_comments_author_idx
  on public.entity_comments (author_user_id);

create table if not exists public.entity_comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.entity_comments(id) on delete cascade,
  mentioned_employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.entity_comment_mentions'::regclass
      and conname = 'entity_comment_mentions_unique'
  ) then
    alter table public.entity_comment_mentions
      add constraint entity_comment_mentions_unique
      unique (comment_id, mentioned_employee_id);
  end if;
end $$;

create index if not exists entity_comment_mentions_employee_idx
  on public.entity_comment_mentions (mentioned_employee_id);

create table if not exists public.entity_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.entity_comments(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mimetype text null,
  size_bytes bigint null,
  created_at timestamptz not null default now()
);

create index if not exists entity_comment_attachments_comment_idx
  on public.entity_comment_attachments (comment_id);

alter table public.entity_comments enable row level security;
alter table public.entity_comment_mentions enable row level security;
alter table public.entity_comment_attachments enable row level security;

do $$
begin
  -- entity_comments: read within org, write your own row within org
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_comments' and policyname='entity_comments_select_org') then
    create policy entity_comments_select_org on public.entity_comments
      for select to authenticated using (public.has_org_access(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_comments' and policyname='entity_comments_insert_org') then
    create policy entity_comments_insert_org on public.entity_comments
      for insert to authenticated
      with check (public.has_org_access(organization_id) and author_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_comments' and policyname='entity_comments_update_own') then
    create policy entity_comments_update_own on public.entity_comments
      for update to authenticated
      using (public.has_org_access(organization_id) and author_user_id = auth.uid())
      with check (public.has_org_access(organization_id) and author_user_id = auth.uid());
  end if;

  -- mentions: readable when the parent comment is in your org
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_comment_mentions' and policyname='entity_comment_mentions_select_org') then
    create policy entity_comment_mentions_select_org on public.entity_comment_mentions
      for select to authenticated using (exists (
        select 1 from public.entity_comments c
        where c.id = comment_id and public.has_org_access(c.organization_id)
      ));
  end if;

  -- attachments: readable when the parent comment is in your org
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_comment_attachments' and policyname='entity_comment_attachments_select_org') then
    create policy entity_comment_attachments_select_org on public.entity_comment_attachments
      for select to authenticated using (exists (
        select 1 from public.entity_comments c
        where c.id = comment_id and public.has_org_access(c.organization_id)
      ));
  end if;
end $$;
