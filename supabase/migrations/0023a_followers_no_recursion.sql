-- =========================================================================
-- Migration 0023a — Break tasks ↔ task_followers RLS recursion
-- =========================================================================
-- Follow-up to 0023. The RLS attack test surfaced
--   ERROR 42P17: infinite recursion detected in policy for relation "tasks"
--
-- Cause: tasks_select consults task_followers (followers branch added in
-- 0023), and task_followers_select consulted tasks (parent-task visibility
-- check). Postgres cycles between the two policies.
--
-- Fix: make task_followers_select self-contained. A follower row exposes
-- (task_id, user_id) only — leaking that a user follows a task is the same
-- information as the join result the user already has on their own dashboard.
-- We drop the cross-table check and gate visibility on:
--   • own follower row, OR
--   • caller has task.view_all (admins / heads / account managers).
--
-- The tighter "you must be able to see the parent task to see its followers"
-- policy is enforced at the application layer (server actions filter by
-- viewable tasks before reading the followers list). Net security loss is
-- nil: anyone able to call the followers list already has the task ids in
-- hand from tasks_select.
--
-- Idempotent.
-- =========================================================================

drop policy if exists task_followers_select on public.task_followers;
create policy task_followers_select
  on public.task_followers
  for select
  to authenticated
  using (
    task_followers.user_id = auth.uid()
    or public.has_permission('task.view_all')
  );
