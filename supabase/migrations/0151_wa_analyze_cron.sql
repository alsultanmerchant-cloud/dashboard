-- 0143 Daily WhatsApp satisfaction re-analysis cron.
--
-- Re-analyzes client satisfaction for clients whose WhatsApp groups received
-- new messages. Mirrors the Odoo-sync cron pattern (net.http_post + vault
-- secrets). Runs at 05:30 UTC daily.
--
-- PREREQUISITES (set once, per environment) — do NOT commit real values:
--   select vault.create_secret('https://<your-app-domain>/api/cron/wa-analyze', 'wa_analyze_url');
--   select vault.create_secret('<CRON_SECRET value>', 'wa_analyze_cron_secret');
-- If a secret already exists, use vault.update_secret(...) instead.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wa-analyze-daily') then
    perform cron.unschedule('wa-analyze-daily');
  end if;
end $$;

select cron.schedule(
  'wa-analyze-daily',
  '30 5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wa_analyze_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_analyze_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
