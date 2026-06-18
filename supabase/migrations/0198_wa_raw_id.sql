-- 0198 Preserve the original serialized WA message id for debugging.
--
-- Phase 0 of multi-number support: dedup now keys on the STABLE bare id (id.id)
-- instead of the `_serialized` form (`<fromMe>_<jid>_<bareid>[_<participant>]`),
-- whose fromMe prefix differs per receiving number. We keep the original
-- serialized string here purely for inspection — it never participates in dedup.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wa_messages'
      and column_name = 'wa_raw_id'
  ) then
    alter table public.wa_messages add column wa_raw_id text;
  end if;
end $$;
