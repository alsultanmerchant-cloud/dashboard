-- 0167_contracts_roster_snapshot.sql
-- Live, month-INDEPENDENT snapshot of the current client roster, by contract
-- type. Powers the top "current client status" strip on the Contracts CEO
-- dashboard (mirrors the Skylight sheet's general overview, which is tied to
-- the live roster — NOT the selected month).
--
-- "Current client" = any contract whose status is not closed/lost
-- (active + hold + expired + renewed). Hold is shown as its own pill; held
-- contracts carry contract_type = 'Hold', so they are not re-attributed to
-- their base type here. Untyped contracts count only toward the total.

create or replace function public.get_contracts_roster(p_org uuid)
returns table (
  total       int,
  cnt_new     int,
  cnt_renew   int,
  cnt_upsell  int,
  cnt_winback int,
  cnt_hold    int,
  cnt_switch  int,
  cnt_untyped int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::int,
    count(*) filter (where ct.key = 'New')::int,
    count(*) filter (where ct.key = 'Renew')::int,
    count(*) filter (where ct.key = 'UPSELL')::int,
    count(*) filter (where ct.key = 'WinBack')::int,
    count(*) filter (where ct.key = 'Hold')::int,
    count(*) filter (where ct.key = 'Switch')::int,
    count(*) filter (where ct.key is null)::int
  from public.contracts c
  left join public.contract_types ct on c.contract_type_id = ct.id
  where c.organization_id = p_org
    and c.status not in ('closed', 'lost')
$$;

grant execute on function public.get_contracts_roster(uuid) to authenticated, service_role;
