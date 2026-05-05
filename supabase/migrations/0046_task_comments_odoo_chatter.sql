-- 0046_task_comments_odoo_chatter.sql
-- Mirror Odoo task chatter (mail.message) into task_comments so notes are
-- searchable + cached locally instead of fetched live every render.
--
-- Key changes:
--   1. Add external_source / external_id (mail.message.id) for dedup on re-sync.
--   2. Make author_user_id nullable — Odoo authors are res.partner records
--      that don't exist in auth.users.
--   3. Add display fields for the Odoo author (name + avatar URL).
--
-- Also bumps the unique-index pattern used by the importer.

-- 1. Make author optional + add Odoo dedup keys.
alter table public.task_comments
  alter column author_user_id drop not null;

alter table public.task_comments
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists external_author_name text,
  add column if not exists external_author_avatar_url text;

-- Either author_user_id (local) or external_id (Odoo) must be set, but not
-- both null — keeps the table honest.
alter table public.task_comments
  drop constraint if exists task_comments_author_check;
alter table public.task_comments
  add constraint task_comments_author_check
  check (author_user_id is not null or external_id is not null);

-- 2. Idempotent re-sync key. Same shape as projects/tasks/etc.
create unique index if not exists task_comments_org_external_uniq
  on public.task_comments(organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;
