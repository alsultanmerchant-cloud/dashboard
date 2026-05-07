-- 0052_user_task_filters.sql
-- Per-user saved filters for the tasks list. Owner-only RLS — each user
-- sees and writes only their own. The shape of `definition` is:
--   { filter?: string, q?: string, view?: string, groupBy?: string,
--     projectId?: uuid, ... }
-- intentionally loose to evolve with the UI without schema churn.

create table if not exists public.user_task_filters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  definition jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_task_filters_name_unique unique (user_id, organization_id, name)
);

create index if not exists idx_user_task_filters_owner
  on public.user_task_filters(user_id, organization_id);

create unique index if not exists user_task_filters_one_default
  on public.user_task_filters(user_id, organization_id)
  where is_default = true;

alter table public.user_task_filters enable row level security;

drop policy if exists user_task_filters_select on public.user_task_filters;
create policy user_task_filters_select
  on public.user_task_filters
  for select
  to authenticated
  using (user_id = auth.uid() and public.has_org_access(organization_id));

drop policy if exists user_task_filters_write on public.user_task_filters;
create policy user_task_filters_write
  on public.user_task_filters
  for all
  to authenticated
  using (user_id = auth.uid() and public.has_org_access(organization_id))
  with check (user_id = auth.uid() and public.has_org_access(organization_id));

create or replace function public.tg_touch_user_task_filter()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_user_task_filters_touch on public.user_task_filters;
create trigger trg_user_task_filters_touch
  before update on public.user_task_filters
  for each row execute function public.tg_touch_user_task_filter();
