-- 0187_contracts_roster_sheet_parity.sql
-- Make the live CEO-dashboard roster (get_contracts_roster) match the sheet's
-- "Client Status Overview (Today)" exactly.
--
-- Two drifts vs the sheet, both now fixed:
--   1. The sync keeps pre-renewal contract versions the sheet has dropped
--      (see 0186 `sheet_present`). They were inflating the live roster.
--   2. "Current client" was defined on the derived `status` enum
--      (status not in closed/lost), which disagrees with the sheet's
--      "Contract Status" column: held-but-closed and renewed-installment rows
--      read as live under the enum but are Closed in the sheet.
--
-- New definition mirrors the grid: a contract is a current client when it is
-- still present in the sheet AND its sheet "Contract Status" label is not a
-- Closed variant (falling back to the status enum only when the label is null,
-- e.g. an in-app contract created before its first sheet sync).
-- Result on today's data: 85 (47 Active + 22 Expired + 16 SOON) — the sheet's number.

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
    and c.sheet_present
    and case
      when c.contract_status_label is not null
        then c.contract_status_label not ilike 'Closed%'
      else c.status not in ('closed', 'lost')
    end
$$;

grant execute on function public.get_contracts_roster(uuid) to authenticated, service_role;
