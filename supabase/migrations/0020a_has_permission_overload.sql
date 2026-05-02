-- =========================================================================
-- Migration 0020a — has_permission(perm_key) 1-arg overload + fix T0 RLS
-- =========================================================================
-- T0 (0020) seeded feature_flags RLS policies that called
-- has_permission('11111111-…'::uuid, 'feature_flag.manage') with the seeded
-- organization id hardcoded inline. That couples the policy to the current
-- single-tenant seed and silently breaks the moment a second org exists.
--
-- This migration:
--   1. Adds a 1-arg has_permission(perm_key text) overload that returns
--      true iff the calling user holds perm_key in ANY org they belong to.
--      Use this for globally-scoped tables (no organization_id column),
--      such as feature_flags.
--   2. Rewrites the feature_flags RLS policies to call the new overload.
--
-- The original 2-arg has_permission(target_org, perm_key) is unchanged and
-- remains the primary check for per-org rows.
-- =========================================================================

create or replace function public.has_permission(perm_key text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and p.key = perm_key
  );
$$;

-- Re-seat feature_flags write policies onto the 1-arg form.
drop policy if exists feature_flags_insert on public.feature_flags;
create policy feature_flags_insert
  on public.feature_flags
  for insert
  to authenticated
  with check ( public.has_permission('feature_flag.manage') );

drop policy if exists feature_flags_update on public.feature_flags;
create policy feature_flags_update
  on public.feature_flags
  for update
  to authenticated
  using      ( public.has_permission('feature_flag.manage') )
  with check ( public.has_permission('feature_flag.manage') );

drop policy if exists feature_flags_delete on public.feature_flags;
create policy feature_flags_delete
  on public.feature_flags
  for delete
  to authenticated
  using ( public.has_permission('feature_flag.manage') );
