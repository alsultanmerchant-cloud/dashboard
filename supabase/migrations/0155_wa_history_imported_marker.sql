-- 0155: wa_group_links.history_imported_at — proper "history seeded" marker.
--
-- The OpenWA history importer used to skip groups with message_count = 0 to be
-- resumable. But a group that received a single stray LIVE webhook message
-- (message_count = 1) was then treated as "already seeded" and never backfilled
-- — e.g. the TNH client group sat at 1 message while its full chat history was
-- never imported. This column tracks seeding explicitly, independent of count.

alter table public.wa_group_links
  add column if not exists history_imported_at timestamptz;

comment on column public.wa_group_links.history_imported_at is
  'When OpenWA history was successfully seeded for this group; null = not yet backfilled (import target). Distinct from message_count, which can be >0 from stray live webhook messages before a full backfill.';

-- Backfill: groups that already hold a meaningful number of messages are treated
-- as already seeded so the importer does not needlessly re-pull them. Groups with
-- 0–9 messages (unseeded or only stray live messages) stay null → import targets.
update public.wa_group_links
  set history_imported_at = coalesce(last_message_at, now())
  where history_imported_at is null
    and message_count >= 10;
