-- 0268 get_recent_wa_clients — deterministic eligibility for the nightly
-- weekly re-analysis batch.
--
-- The reanalyze route derived "clients with WA activity in the last 7 days"
-- by selecting raw wa_messages rows through PostgREST and de-duplicating in
-- JS. PostgREST caps result sets (max-rows), so the scan silently truncated:
-- eligibleTotal read 20 before the 2026-07-26 backfill and 6 after it (the
-- fresh bulk rows dominated the capped window), while the true count was 49.
-- Do the DISTINCT in SQL where it belongs. Idempotent.

create or replace function public.get_recent_wa_clients(p_org uuid, p_since timestamptz)
returns table (client_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct m.client_id
  from wa_messages m
  where m.organization_id = p_org
    and m.client_id is not null
    and m.group_kind is not null
    and m.sent_at >= p_since
$$;
