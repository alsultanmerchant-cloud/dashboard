-- 0208_realign_task_code_prefixes.sql
--
-- task_code is defined as `<project_code>-<seq>` (migration 0050). But ~17% of
-- tasks carry a STALE prefix: their project's `project_code` was later changed
-- (the Odoo importer renumbered projects from the standard "PRJ-026" form to an
-- Odoo-id-based "PRJ-01765" form) while the tasks kept the prefix from when they
-- were first coded. The importer preserves each existing task's task_code
-- (it only assigns codes to NEW tasks, using the current project_code), so the
-- drift is frozen historical data — not re-introduced on sync — and a one-time
-- realignment is durable.
--
-- Fix: re-prefix every drifted task to its project's current project_code while
-- PRESERVING the numeric suffix (the task's number is unchanged). Verified safe:
-- 0 within-project duplicate target codes and 0 collisions with non-changing
-- tasks across the 2,140 affected rows, so the (project_id, task_code) unique
-- index cannot be violated. Idempotent: a second run matches nothing.

update public.tasks t
   set task_code = p.project_code || substring(t.task_code from '-\d+$')
  from public.projects p
 where t.project_id = p.id
   and t.task_code is not null
   and t.task_code ~ '-\d+$'              -- only well-formed "<prefix>-<n>" codes
   and p.project_code is not null
   and p.project_code <> ''
   and regexp_replace(t.task_code, '-\d+$', '') <> p.project_code;
