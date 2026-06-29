-- 0226 Cron: keep tasks.stage_owner_positions template-accurate
-- =====================================================================
-- Re-derives each task's owner map from the team's /task-templates so
-- accountability stays accurate as new tasks sync from Odoo (the backfill, but
-- ongoing). Hits POST /api/cron/refresh-task-owners hourly at :35 — after
-- core-tasks (:16) lands new rows, before the next accountability-scorecard
-- refresh (every :10) reads them.
--
-- APPLY ONLY AFTER the /api/cron/refresh-task-owners route is deployed (the cron
-- POSTs the live URL; until the route ships it would 404). Reuses the existing
-- sync vault secrets (same app host + CRON_SECRET).
-- =====================================================================
select cron.schedule(
  'refresh-task-owners',
  '35 * * * *',
  $$
  select net.http_post(
    url := replace(
      (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url'),
      'sync-odoo', 'refresh-task-owners'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  )
  $$
);
