-- 0254 WhatsApp ingestion resilience (post-mortem of the 2026-07-14 blackout)
-- =====================================================================
-- On 2026-07-14 a transient HTTP 500 from /api/wa/webhook made the OpenWA
-- gateway exhaust WEBHOOK_MAX_RETRIES and DELETE the webhook registration.
-- Every client's WhatsApp ingestion then went dark for four days, while
-- /satisfaction reassured everyone with "no new messages since last analysis".
-- A second, independent fault hid inside it: the primary number's session sat at
-- status "ready" with lastActive frozen at 14:16 that same day (wedged browser).
--
-- Two mechanisms land here:
--   1. wa_webhook_deadletter — the receiver now ALWAYS acks 2xx and parks
--      anything it cannot process, so a bad minute can never cost us the pipe.
--   2. the wa-health cron — re-registers a missing webhook, flags a wedged
--      session (lastActive, not status) or a silent pipe, and replays the queue.
--
-- APPLY ONLY AFTER /api/cron/wa-health is deployed (the cron POSTs the live URL;
-- until the route ships it would 404). Reuses the existing sync vault secrets.
-- =====================================================================

create table if not exists public.wa_webhook_deadletter (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  account_session_id text,
  payload jsonb not null,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  replayed_at timestamptz
);

comment on table public.wa_webhook_deadletter is
  'Webhook payloads the receiver could not process. It acks 2xx regardless (a non-2xx makes the OpenWA gateway delete the registration) and parks them here; /api/cron/wa-health replays them.';

-- The replay worker only ever scans un-replayed rows.
create index if not exists wa_webhook_deadletter_pending_idx
  on public.wa_webhook_deadletter (created_at)
  where replayed_at is null;

-- Internal queue: service-role only. RLS on with NO policies means no anon/authed
-- client can read payloads (which contain raw message bodies).
alter table public.wa_webhook_deadletter enable row level security;

-- ---------------------------------------------------------------------
-- Watchdog: every 15 minutes. The incident cost four days precisely because
-- nothing was watching; a quarter-hour is the most ingestion we should ever
-- silently lose.
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('wa-health');
exception
  when others then null; -- not scheduled yet
end $$;

select cron.schedule(
  'wa-health',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := replace(
      (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_url'),
      'sync-odoo', 'wa-health'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);
