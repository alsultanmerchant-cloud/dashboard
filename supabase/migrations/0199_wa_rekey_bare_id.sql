-- 0199 Re-key wa_messages from the serialized id → stable bare id (id.id).
--
-- Old key: `<fromMe>_<remoteJid>_<bareId>[_<participant>]`. The fromMe prefix
-- (and participant suffix) differ depending on WHICH connected number received
-- the message, so two numbers in the same group would store the same message
-- twice. We collapse onto the bare id — the 3rd "_"-segment. The remoteJid
-- contains no "_", so split_part(...,3) is exact for both the 3-segment
-- (no participant) and 4-segment (with participant) shapes. Strings already
-- bare (no leading true_/false_) are left untouched.
--
-- The unique constraint (organization_id, chat_id, wa_message_id) stays
-- account-blind: chat_id is in the key, so (chat_id, bareId) is globally unique
-- even though bareId alone is only unique within a chat.

do $$
begin
  -- 0. Preserve the original serialized id for any rows not yet backfilled.
  update public.wa_messages
     set wa_raw_id = wa_message_id
   where wa_raw_id is null;

  -- 1. Drop collisions FIRST (before the value rewrite) so the unique
  --    constraint never sees two identical bare keys mid-update. Keep the
  --    earliest row per (org, chat, bare id); stable tiebreak on id.
  with normalized as (
    select
      id, organization_id, chat_id, created_at,
      case
        when wa_message_id like 'true\_%' or wa_message_id like 'false\_%'
          then split_part(wa_message_id, '_', 3)
        else wa_message_id
      end as bare_id
    from public.wa_messages
  ),
  ranked as (
    select id,
      row_number() over (
        partition by organization_id, chat_id, bare_id
        order by created_at asc, id asc
      ) as rn
    from normalized
  )
  delete from public.wa_messages m
  using ranked r
  where m.id = r.id and r.rn > 1;

  -- 2. Rewrite the survivors to the bare id (no-op for already-bare rows).
  update public.wa_messages
     set wa_message_id = split_part(wa_message_id, '_', 3)
   where wa_message_id like 'true\_%'
      or wa_message_id like 'false\_%';

  -- 3. Recompute each link's cached message_count from the source of truth.
  update public.wa_group_links l
     set message_count = sub.c
    from (
      select organization_id, chat_id, count(*) c
      from public.wa_messages group by 1, 2
    ) sub
   where l.organization_id = sub.organization_id
     and l.chat_id = sub.chat_id;
end $$;
