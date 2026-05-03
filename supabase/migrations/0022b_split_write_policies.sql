-- =========================================================================
-- Migration 0022b — Split FOR-ALL "write" policies that re-open SELECT
-- =========================================================================
-- Follow-up to 0022. The phase T2 RLS attack test (tests/rls-attack.test.mjs)
-- caught a leak: the tightened `tasks_select` policy is permissive, but the
-- pre-existing `tasks_write` policy is `for all` (covers every command,
-- including SELECT). Postgres OR's permissive policies of the same command,
-- so the broad `has_org_access(organization_id)` USING clause on
-- `tasks_write` was re-admitting every authenticated org member to read
-- every task — defeating the entire purpose of phase T2.
--
-- Same shape on `task_mentions_write`. `task_comments` is already split
-- (insert / select / update_own) and is unaffected.
--
-- Fix: drop the FOR-ALL policy and re-create it as three separate policies
-- (INSERT / UPDATE / DELETE), so SELECT visibility is gated solely by the
-- tight `*_select` policy from 0022.
--
-- All operations are idempotent.
-- =========================================================================

-- 1. tasks ----------------------------------------------------------------
drop policy if exists tasks_write on public.tasks;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert
  on public.tasks
  for insert
  to authenticated
  with check ( public.has_org_access(organization_id) );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update
  on public.tasks
  for update
  to authenticated
  using      ( public.has_org_access(organization_id) )
  with check ( public.has_org_access(organization_id) );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete
  on public.tasks
  for delete
  to authenticated
  using ( public.has_org_access(organization_id) );

-- 2. task_mentions --------------------------------------------------------
drop policy if exists task_mentions_write on public.task_mentions;

drop policy if exists task_mentions_insert on public.task_mentions;
create policy task_mentions_insert
  on public.task_mentions
  for insert
  to authenticated
  with check ( public.has_org_access(organization_id) );

drop policy if exists task_mentions_update on public.task_mentions;
create policy task_mentions_update
  on public.task_mentions
  for update
  to authenticated
  using      ( public.has_org_access(organization_id) )
  with check ( public.has_org_access(organization_id) );

drop policy if exists task_mentions_delete on public.task_mentions;
create policy task_mentions_delete
  on public.task_mentions
  for delete
  to authenticated
  using ( public.has_org_access(organization_id) );
