-- 0116_sync_odoo_phased_cron.sql
-- The :00 `?only=core` job from 0112 still timed out: the core import
-- (employees → … → projects → tasks → comments) does not fit in one 300s
-- Vercel function for Sky Light's volume. The route now exposes per-phase
-- slices (core-base / core-projects / core-tasks / core-comments) — see
-- app/api/cron/sync-odoo/route.ts — so this migration replaces the four
-- staggered jobs with seven, one phase per entry.
--
-- Hourly layout:
--   :00 core-base       :30 core-comments
--   :08 core-projects   :38 stage-history,assignee-managers
--   :16 core-tasks      :46 followers
--                       :54 members,attachments

do $$
declare
  v_jobname text;
begin
  foreach v_jobname in array array[
    'sync-odoo-core', 'sync-odoo-light', 'sync-odoo-followers', 'sync-odoo-heavy'
  ] loop
    if exists (select 1 from cron.job j where j.jobname = v_jobname) then
      perform cron.unschedule(v_jobname);
    end if;
  end loop;
end$$;

-- Helper: every job is the same net.http_post with a different ?only= slice
-- and minute. pg_cron has no parametrised schedule, so the body is repeated.

-- :00 — core phase 1: employees, departments, HR, clients, services, tags
select cron.schedule(
  'sync-odoo-core-base',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=core-base',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :08 — core phase 2: projects
select cron.schedule(
  'sync-odoo-core-projects',
  '8 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=core-projects',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :16 — core phase 3: tasks (+ assignees, tag links)
select cron.schedule(
  'sync-odoo-core-tasks',
  '16 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=core-tasks',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :30 — core phase 4: task & project comments (chatter / notes)
select cron.schedule(
  'sync-odoo-core-comments',
  '30 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=core-comments',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :38 — stage-history + assignee-managers
select cron.schedule(
  'sync-odoo-light',
  '38 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=stage-history,assignee-managers',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :46 — followers (project + task)
select cron.schedule(
  'sync-odoo-followers',
  '46 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=followers',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :54 — members + attachments
select cron.schedule(
  'sync-odoo-heavy',
  '54 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=members,attachments',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);
