-- 0101_task_followers_allow_employee.sql
--
-- Sky Light feedback §8.1: followers dropdown only shows ~2 people. Root
-- cause: `task_followers.user_id` is NOT NULL and links to auth.users, but
-- 113 of 115 active employee_profiles have user_id IS NULL (Odoo-imported
-- employees who never logged into the dashboard). The picker query filters
-- to `user_id IS NOT NULL`, so it can only ever show those 2.
--
-- Fix: let any active employee be a follower.
--   • Add task_followers.employee_id (uuid, references employee_profiles).
--   • Make user_id nullable.
--   • Require at least one of (user_id, employee_id) via a CHECK.
--   • Backfill employee_id from existing rows.
--   • Replace the pkey-on-(task,user) with a pkey on a new `id` column and
--     add two partial unique indexes so each (task, user) and (task, employee)
--     combo stays unique.
--
-- Notifications still target user_id where present; followers without a
-- user_id are tracked for visibility but won't receive in-app pushes (they
-- don't have a dashboard login). This matches the Sky Light/Rwasem behaviour
-- where the follower list mirrors Odoo's mail.followers (partner-level).

begin;

-- 1. Drop the existing composite pkey so user_id can become nullable.
alter table public.task_followers drop constraint if exists task_followers_pkey;

-- 2. Allow null user_id.
alter table public.task_followers alter column user_id drop not null;

-- 3. Add employee_id and id columns.
alter table public.task_followers
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists employee_id uuid references public.employee_profiles(id) on delete cascade;

-- 4. Backfill employee_id from user_id where possible.
update public.task_followers tf
set employee_id = ep.id
from public.employee_profiles ep
where tf.employee_id is null
  and tf.user_id is not null
  and ep.user_id = tf.user_id;

-- 5. New primary key on id.
alter table public.task_followers add primary key (id);

-- 6. Require at least one identifier (defensive — every row coming in via the
-- action will set both, but a manual insert shouldn't be able to write a
-- meaningless row).
alter table public.task_followers
  drop constraint if exists task_followers_identifier_present;
alter table public.task_followers
  add constraint task_followers_identifier_present
  check (user_id is not null or employee_id is not null);

-- 7. Unique on (task, user) when user_id is set — replaces the prior pkey
-- semantics so the action stays idempotent for users who DO have a login.
drop index if exists public.task_followers_task_user_uniq;
create unique index task_followers_task_user_uniq
  on public.task_followers (task_id, user_id)
  where user_id is not null;

-- 8. Unique on (task, employee) when employee_id is set — same idempotence
-- guarantee for the non-user path.
drop index if exists public.task_followers_task_employee_uniq;
create unique index task_followers_task_employee_uniq
  on public.task_followers (task_id, employee_id)
  where employee_id is not null;

-- 9. Index by employee_id for follower-lookup queries.
create index if not exists task_followers_employee_idx
  on public.task_followers (employee_id)
  where employee_id is not null;

commit;
