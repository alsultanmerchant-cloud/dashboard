-- 0108_split_attachments_cron.sql
-- Carve attachments sync out of the hourly Odoo sync into its own daily job.
--
-- Why: ir.attachment is the slowest Odoo model and changes infrequently.
-- Keeping it inside the hourly /api/cron/sync-odoo run wastes Odoo round-trips
-- and risks the Vercel 5-min cap. Pull it onto its own endpoint + schedule.
--
-- Prereqs (run ONCE before applying this migration):
--   select vault.create_secret(
--     'https://<your-app>/api/cron/sync-attachments',
--     'sync_attachments_url'
--   );
--   -- (CRON_SECRET reuses the existing 'sync_odoo_cron_secret' vault entry.)
--
-- This migration is idempotent — re-running unschedules + reschedules both jobs.

-- Make sure extensions are present (already enabled on Sky Light).
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1. Re-point the hourly job to skip attachments (it now runs separately).
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'sync-odoo-hourly';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'sync-odoo-hourly',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url')
           || '?skip=attachments',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 280000
  );
  $cron$
);

-- 2. Schedule attachments-only sync once a day at 03:00 UTC (≈06:00 KSA,
--    before the workday so refreshes are visible from morning onwards).
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'sync-attachments-daily';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'sync-attachments-daily',
  '0 3 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_attachments_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 280000
  );
  $cron$
);
