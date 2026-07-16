-- 0253 — Resolved WhatsApp identities for the employees-page linker
-- =====================================================================
-- After the @lid → phone backfill (scripts/backfill-wa-lid-identity.ts),
-- wa_messages.sender_id holds real phone JIDs (966…@c.us) plus a display name
-- in `sender`. The /organization/employees page grows a "واتساب" column that
-- lets the team link each employee to the WhatsApp identity that posts in
-- client groups — populating employee_profiles.phone so the satisfaction
-- transcript tagger's byPhone match attributes their messages to staff instead
-- of reading them as client voice. See memory: project_wa_sender_identity_lid.
--
-- The resolved-identity pool is a DISTINCT aggregate over up to ~70k @c.us
-- rows; a plain PostgREST select would truncate at 1000 and can't group, so we
-- aggregate server-side in one round-trip. Returns the most-recent non-null
-- display name per number, plus activity (message + group counts) so the picker
-- can rank and the team can recognise who each number is.
-- =====================================================================

create or replace function public.wa_resolved_identities(p_org uuid)
returns table (
  phone_jid     text,
  display_name  text,
  message_count bigint,
  group_count   bigint,
  last_sent_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.sender_id as phone_jid,
    (array_agg(m.sender order by m.sent_at desc nulls last)
       filter (where m.sender is not null and m.sender <> ''))[1] as display_name,
    count(*)                       as message_count,
    count(distinct m.chat_id)      as group_count,
    max(m.sent_at)                 as last_sent_at
  from public.wa_messages m
  where m.organization_id = p_org
    and m.sender_id like '%@c.us'
  group by m.sender_id
$$;

grant execute on function public.wa_resolved_identities(uuid)
  to anon, authenticated, service_role;
