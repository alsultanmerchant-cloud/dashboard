-- 0112_sync_odoo_staggered_cron.sql
-- Split the single hourly Odoo sync (jobid 9 / sync-odoo-hourly) into four
-- staggered cron entries. The single-job version was timing out at 280s
-- because the full pipeline (core → stage-history → assignee-managers →
-- followers → members → attachments) exceeded the Vercel 300s function
-- budget for Sky Light's data volume. Each staggered job runs a subset and
-- fits comfortably under 280s.
--
-- Companion code change: app/api/cron/sync-odoo/route.ts now accepts a
-- ?only=<csv> query param to run a subset (core is conditional).

-- Drop the old all-in-one schedule.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-odoo-hourly') then
    perform cron.unschedule('sync-odoo-hourly');
  end if;
end$$;

-- :00 — core import (heaviest: employees/depts/clients/projects/tasks)
select cron.schedule(
  'sync-odoo-core',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url') || '?only=core',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $cron$
);

-- :15 — stage-history + assignee-managers
select cron.schedule(
  'sync-odoo-light',
  '15 * * * *',
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

-- :30 — followers (project + task)
select cron.schedule(
  'sync-odoo-followers',
  '30 * * * *',
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

-- :45 — members + attachments
select cron.schedule(
  'sync-odoo-heavy',
  '45 * * * *',
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
