-- 0267 wa_accounts.last_auto_restart_at — cooldown stamp for the wa-health
-- watchdog's automatic session restarts.
--
-- Context (2026-07-26): WhatsApp hot-updates a RUNNING web session past the
-- gateway's pinned build, so every session has a fuse of hours-to-days before
-- its store breaks (wedged page or groups-500). The watchdog already detects
-- both modes every 15 minutes; this column lets it force-restart the session
-- itself (the same recovery as the إعادة الربط button — LocalAuth survives,
-- no QR) at most once per cooldown window, escalating to a human alert only
-- when a recent restart didn't stick. Idempotent.

alter table public.wa_accounts
  add column if not exists last_auto_restart_at timestamptz;
