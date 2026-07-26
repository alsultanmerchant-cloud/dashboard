-- 0266 Nightly full weekly re-analysis cron.
--
-- Runs the same full weekly analysis as the board's "إعادة تحليل الأسبوع"
-- button for every client with WA activity in the last 7 days, via
-- /api/cron/reanalyze. Fires every 10 minutes 01:00–02:50 UTC (04:00–05:50
-- Riyadh); the route processes the 4 stalest due clients per slot and skips
-- anything re-analyzed within 20h, so extra slots are cheap no-ops and the
-- night converges to full coverage. Complements (does not replace) the 02:30
-- status-refresh sweep from 0264.
--
-- URL derived from satisfaction_refresh_url (0264): same app domain, path
-- swapped to /api/cron/reanalyze. Auth reuses satisfaction_refresh_cron_secret
-- (= CRON_SECRET). Idempotent.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'satisfaction_reanalyze_url') then
    perform vault.create_secret(
      replace(
        (select decrypted_secret from vault.decrypted_secrets where name = 'satisfaction_refresh_url'),
        'satisfaction-refresh', 'reanalyze'),
      'satisfaction_reanalyze_url');
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'satisfaction-reanalyze-nightly') then
    perform cron.unschedule('satisfaction-reanalyze-nightly');
  end if;
end $$;

select cron.schedule(
  'satisfaction-reanalyze-nightly',
  '*/10 1-2 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'satisfaction_reanalyze_url') || '?limit=4',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'satisfaction_refresh_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  );
  $job$
);
