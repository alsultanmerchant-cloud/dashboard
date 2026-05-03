-- =========================================================================
-- Migration 0023b — Split task_followers FOR-ALL write policy
-- =========================================================================
-- 0023a fixed task_followers_select but the recursion kept firing because
-- 0023's task_followers_write was declared FOR ALL — Postgres applies it
-- to SELECT as well, OR'ing it with task_followers_select. Its USING
-- clause queries public.tasks, which re-triggers tasks_select, which
-- queries public.task_followers… → infinite loop.
--
-- Same fix shape as 0022b (which already split tasks_write and
-- task_mentions_write for identical reasons): drop the FOR ALL policy and
-- recreate it as separate INSERT / UPDATE / DELETE policies. SELECT is
-- then governed solely by task_followers_select (no parent-table lookup).
--
-- Idempotent.
-- =========================================================================

drop policy if exists task_followers_write on public.task_followers;

drop policy if exists task_followers_insert on public.task_followers;
create policy task_followers_insert
  on public.task_followers
  for insert
  to authenticated
  with check (
    public.has_permission('task.view_all')
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and t.created_by = auth.uid()
    )
  );

drop policy if exists task_followers_update on public.task_followers;
create policy task_followers_update
  on public.task_followers
  for update
  to authenticated
  using (
    public.has_permission('task.view_all')
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and t.created_by = auth.uid()
    )
  )
  with check (
    public.has_permission('task.view_all')
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and t.created_by = auth.uid()
    )
  );

drop policy if exists task_followers_delete on public.task_followers;
create policy task_followers_delete
  on public.task_followers
  for delete
  to authenticated
  using (
    public.has_permission('task.view_all')
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and t.created_by = auth.uid()
    )
  );
