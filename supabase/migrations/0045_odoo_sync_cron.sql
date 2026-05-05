-- 0045_odoo_sync_cron.sql
-- Hourly Odoo → Supabase sync via pg_cron + pg_net.
--
-- Prereqs (run ONCE after deploying the dashboard):
--   1. Vault secrets:
--        select vault.create_secret('<your-cron-secret>', 'sync_odoo_cron_secret');
--        select vault.create_secret('https://<your-app>/api/cron/sync-odoo', 'sync_odoo_url');
--   2. The dashboard must export CRON_SECRET equal to sync_odoo_cron_secret.
--
-- This migration is idempotent — re-running unschedules + reschedules.

-- Make sure required extensions are present (already enabled on Sky Light).
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Unschedule any prior job with the same name so re-runs don't duplicate.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'sync-odoo-hourly';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

-- Schedule: every hour on the minute. Posts to the dashboard's
-- /api/cron/sync-odoo route with x-cron-secret header.
select cron.schedule(
  'sync-odoo-hourly',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 280000
  );
  $cron$
);
