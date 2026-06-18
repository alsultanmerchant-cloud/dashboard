-- 0202 Per-group coverage: how many connected numbers have contributed messages.
--
-- With multi-number support, a group's transcript can be fed by several numbers.
-- This counts the DISTINCT connected numbers that delivered messages to each
-- group (via wa_messages.first_seen_account_id, stamped from migration 0200).
-- Legacy rows with null provenance are ignored, so the count reflects numbers
-- that have actually contributed since provenance existed.

create or replace function public.get_wa_group_coverage(p_org uuid)
returns table (chat_id text, account_count integer)
language sql
security definer
set search_path = public
as $$
  select m.chat_id,
         count(distinct m.first_seen_account_id)::int as account_count
  from public.wa_messages m
  where m.organization_id = p_org
    and m.first_seen_account_id is not null
  group by m.chat_id
$$;

grant execute on function public.get_wa_group_coverage(uuid) to authenticated, service_role;
