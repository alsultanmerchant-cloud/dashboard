-- 0214: Switch Odoo→Supabase sync to incremental + business-hours cadence.
--
-- Replaces the 7 hourly staggered jobs from 0116 (which ran full re-imports
-- 24/7 and timed out on projects/tasks/comments every hour) with:
--   • Incremental core every 2h during Saudi business hours (Sun–Thu,
--     08:00–18:00 KSA = 05/07/09/11/13/15 UTC). Pulls only rows changed since
--     the sync_watermarks high-water mark (migration 0213) → finishes in ~2min.
--   • Supplementary syncs staggered after core in the same slots.
--   • A nightly job (23:00 UTC = 02:00 KSA) that runs an incremental core AND
--     the cheap delete-reconcile pass (reaps rows hard-deleted in Odoo, which
--     the incremental upserts never remove).
--
-- IMPORTANT: apply this ONLY AFTER the route changes (mode=incremental +
-- ?only=reconcile) are deployed. Against the old route these jobs would run in
-- full mode and time out exactly like before.
--
-- All jobs POST to the dashboard route via pg_net, reading the URL + shared
-- secret from Vault (set up in 0116). dow 0–4 = Sunday–Thursday.

do $$
declare
  jid bigint;
  base_url text;
  secret text;
begin
  -- Drop the old sync-odoo* jobs.
  for jid in select jobid from cron.job where jobname like 'sync-odoo%'
  loop
    perform cron.unschedule(jid);
  end loop;

  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'sync_odoo_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret';

  -- Helper inline: each job posts to base_url || query with the cron secret.
  -- Business-hours incremental core (base+projects+tasks+comments).
  perform cron.schedule(
    'sync-odoo-core', '0 5,7,9,11,13,15 * * 0-4',
    format($cmd$select net.http_post(url := %L || '?only=core', headers := jsonb_build_object('content-type','application/json','x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 295000)$cmd$, base_url, secret)
  );

  -- Supplementary syncs, staggered after core in the same 2h slots.
  perform cron.schedule(
    'sync-odoo-light', '3 5,7,9,11,13,15 * * 0-4',
    format($cmd$select net.http_post(url := %L || '?only=stage-history,assignee-managers', headers := jsonb_build_object('content-type','application/json','x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 295000)$cmd$, base_url, secret)
  );
  perform cron.schedule(
    'sync-odoo-followers', '7 5,7,9,11,13,15 * * 0-4',
    format($cmd$select net.http_post(url := %L || '?only=followers', headers := jsonb_build_object('content-type','application/json','x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 295000)$cmd$, base_url, secret)
  );
  perform cron.schedule(
    'sync-odoo-heavy', '10 5,7,9,11,13,15 * * 0-4',
    format($cmd$select net.http_post(url := %L || '?only=members,attachments', headers := jsonb_build_object('content-type','application/json','x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 295000)$cmd$, base_url, secret)
  );

  -- Nightly: incremental core + delete-reconcile (daily, incl. weekend, so
  -- deleted rows are reaped within 24h even on non-working days).
  perform cron.schedule(
    'sync-odoo-nightly-reconcile', '0 23 * * *',
    format($cmd$select net.http_post(url := %L || '?only=core,reconcile', headers := jsonb_build_object('content-type','application/json','x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 295000)$cmd$, base_url, secret)
  );
end $$;
