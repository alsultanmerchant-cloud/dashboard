-- 0174_get_month_target_buckets.sql
--
-- Per-client drill-down behind the CEO dashboard's On-Target / Overdue / Renewed
-- / Lost bucket cards. The TS reader (getMonthTargetBuckets) previously built
-- these from the point-in-time `contracts.target` STRING filtered to a single
-- month's end_date — which excluded every overdue row (overdue ⇒ end_date <
-- month-start) and disagreed with the funnel counts.
--
-- This function returns the per-client lists using the SAME predicates as
-- migration 0172's count tiles, so the funnel counts (cnt_on_target/cnt_overdue)
-- and these drill-down lists agree by construction. No renewable filter (the
-- sheet applies none). on_target/overdue are the funnel; renewed/lost are
-- outcome cards keyed on renewed_status within the month.
--
-- NOTE: this recomputes from CURRENT contract state, so it is exact only for the
-- live month. `contracts.end_date` drifts forward on renewal, so a past month is
-- under-reported here; closed months should prefer the frozen monthly_target_
-- snapshot (migration 0177) when present.

create or replace function public.get_month_target_buckets(
  p_org uuid,
  p_month date
) returns table (
  bucket text,
  contract_id uuid,
  client_name text,
  client_code text,
  account_manager_name text,
  value numeric,
  status text
)
language sql stable security definer set search_path = public as $$
  with base as (
    select
      c.id,
      cl.name as client_name,
      cl.external_id as client_code,
      coalesce(ep.full_name, c.account_manager_name) as account_manager_name,
      coalesce(c.next_contract_value, c.total_value, 0) as value,
      c.status,
      c.end_date,
      c.renewed_status
    from public.contracts c
    left join public.clients cl on cl.id = c.client_id
    left join public.employee_profiles ep on ep.id = c.account_manager_id
    where c.organization_id = p_org
  ),
  bounds as (
    select date_trunc('month', p_month)::date as v_start,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date as v_end
  )
  select 'on_target', b.id, b.client_name, b.client_code, b.account_manager_name, b.value, b.status
    from base b, bounds
   where b.status not in ('closed','lost','renewed')
     and b.end_date between bounds.v_start and bounds.v_end
  union all
  select 'overdue', b.id, b.client_name, b.client_code, b.account_manager_name, b.value, b.status
    from base b, bounds
   where b.status not in ('closed','lost','renewed')
     and b.end_date is not null and b.end_date < bounds.v_start
  union all
  select 'renewed', b.id, b.client_name, b.client_code, b.account_manager_name, b.value, b.status
    from base b, bounds
   where b.renewed_status = 'YES'
     and b.end_date between bounds.v_start and bounds.v_end
  union all
  select 'lost', b.id, b.client_name, b.client_code, b.account_manager_name, b.value, b.status
    from base b, bounds
   where b.renewed_status = 'NO'
     and b.end_date between bounds.v_start and bounds.v_end;
$$;
