-- 0154 · Persist WhatsApp group member counts
-- The OpenWA gateway caps concurrency on its per-group endpoint (~3-4) and
-- returns 429 beyond that. Fetching member counts live for ~368 groups on every
-- page load is therefore unreliable (most return blank) and slow. Persist the
-- counts on the link row instead; they're refreshed (throttled) during Sync.

alter table public.wa_group_links
  add column if not exists member_count integer,
  add column if not exists admin_count integer,
  add column if not exists members_synced_at timestamptz;

comment on column public.wa_group_links.member_count is
  'Participant count from OpenWA, refreshed during Sync (null = not yet fetched).';
comment on column public.wa_group_links.admin_count is
  'Admin/super-admin participant count from OpenWA.';
