-- 0077_user_task_filters_shared.sql
-- Rwasem parity: saved searches gain a Shared toggle (visible to all users in
-- the same org) alongside the existing private + Default flags. Owners can
-- still only WRITE their own; SELECT now widens to org-scoped shared rows.

alter table public.user_task_filters
  add column if not exists is_shared boolean not null default false;

create index if not exists idx_user_task_filters_shared_org
  on public.user_task_filters(organization_id)
  where is_shared = true;

drop policy if exists user_task_filters_select on public.user_task_filters;
create policy user_task_filters_select
  on public.user_task_filters
  for select
  to authenticated
  using (
    public.has_org_access(organization_id)
    and (user_id = auth.uid() or is_shared = true)
  );

-- WRITE policy unchanged — only owners modify their own rows.
