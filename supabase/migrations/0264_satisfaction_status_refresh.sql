-- 0264 Nightly satisfaction status-refresh cron + refresh bookkeeping.
--
-- The status-refresh pass (machine-verified closures of open satisfaction
-- findings) used to run only when an operator clicked "تحديث". This migration
-- (a) adds client_satisfaction_analyses.status_refreshed_at so the sweep can
-- walk clients least-recently-refreshed first, and (b) registers a nightly
-- pg_cron job hitting /api/cron/satisfaction-refresh at 02:30 UTC. Mirrors the
-- wa-analyze cron pattern (net.http_post + vault secrets). Idempotent.
--
-- PREREQUISITES (set once, per environment) — do NOT commit real values:
--   select vault.create_secret('https://<your-app-domain>/api/cron/satisfaction-refresh', 'satisfaction_refresh_url');
--   select vault.create_secret('<CRON_SECRET value>', 'satisfaction_refresh_cron_secret');
-- If a secret already exists, use vault.update_secret(...) instead.

alter table public.client_satisfaction_analyses
  add column if not exists status_refreshed_at timestamptz;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'satisfaction-status-refresh') then
    perform cron.unschedule('satisfaction-status-refresh');
  end if;
end $$;

select cron.schedule(
  'satisfaction-status-refresh',
  '30 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'satisfaction_refresh_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'satisfaction_refresh_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
