-- 0213: Incremental Odoo→Supabase sync watermarks.
--
-- The full importer re-pulls every project/task/comment each run, which blows
-- the serverless time budget (projects ~20min, tasks ~10min, comments ~7min).
-- This table lets each phase pull only what changed since the last successful
-- run: write_date-based phases (projects, tasks) advance `last_write_date`;
-- append-only comment phases keyset-advance `last_message_id`.
--
-- One row per (organization, entity_type). Written by the sync service-role
-- client (bypasses RLS); readable by org members.

create table if not exists public.sync_watermarks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 'projects' | 'tasks' | 'task_comments' | 'project_comments'
  entity_type text not null,
  -- High-water mark of Odoo write_date for write_date-filtered phases.
  last_write_date timestamptz,
  -- High-water mark of mail.message id for append-only comment phases.
  last_message_id bigint,
  updated_at timestamptz not null default now(),
  primary key (organization_id, entity_type)
);

alter table public.sync_watermarks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sync_watermarks'
      and policyname = 'sync_watermarks_read'
  ) then
    create policy sync_watermarks_read on public.sync_watermarks
      for select using (public.has_org_access(organization_id));
  end if;
end $$;
