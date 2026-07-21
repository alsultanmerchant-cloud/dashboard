-- 0256 Cron: generate the monthly executive report automatically
-- =====================================================================
-- /reports freezes one report per period. Without a schedule someone has to
-- remember to open the page and click "generate" — so the 1st-of-month report
-- only exists if a human made it. This runs at 05:30 UTC (08:30 Riyadh) on the
-- 1st and generates the PREVIOUS calendar month, so the report is waiting
-- (and printable) when the CEO looks.
--
-- Deliberately monthly, not daily: a run costs four Gemini calls plus a wide
-- facts fan-out, and a period report only becomes final once its month closes.
--
-- APPLY ONLY AFTER /api/cron/executive-report is deployed (the cron calls the
-- live URL; until the route ships it would 404). Reuses the existing sync vault
-- secrets (same app host + CRON_SECRET) exactly like 0226.
-- =====================================================================
select cron.schedule(
  'executive-report-monthly',
  '30 5 1 * *',
  $$
  select net.http_post(
    url := replace(
      (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url'),
      'sync-odoo', 'executive-report'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  )
  $$
);
