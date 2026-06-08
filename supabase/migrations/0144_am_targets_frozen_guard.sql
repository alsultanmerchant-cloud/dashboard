-- 0144_am_targets_frozen_guard.sql
--
-- Make compute_am_monthly_targets() a no-op for months that are already
-- frozen, mirroring the guard compute_monthly_dashboard() already has.
--
-- Why: frozen months (e.g. May 2026, imported from the sheet) must show the
-- sheet's authoritative per-AM numbers, not a live recompute that drifts as
-- contract state changes. getAmTargets() already skips recompute on reads;
-- this protects the values from the freeze cron / any manual recompute too,
-- so the imported per-AM rows stay put once a month is locked.

create or replace function public.compute_am_monthly_targets(
  p_org uuid,
  p_month date
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_count int := 0;
  v_frozen boolean;
begin
  -- Locked month → leave am_targets exactly as they are (sheet-imported or
  -- last-computed-then-frozen). Return 0 to signal "nothing recomputed".
  select is_frozen into v_frozen
    from public.monthly_dashboard_totals
   where organization_id = p_org and month = v_start;
  if v_frozen then
    return 0;
  end if;

  with expected as (
    select c.account_manager_id as am, sum(c.next_contract_value) as v
      from public.contracts c
      left join public.packages p on c.package_id = p.id
     where c.organization_id = p_org
       and c.end_date between v_start and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       and c.target in ('On Target', 'Overdue')
       and coalesce(p.is_renewable, true)
       and c.account_manager_id is not null
     group by 1
  ),
  exp_inst as (
    select c.account_manager_id as am, sum(i.expected_amount) as v
      from public.installments i
      join public.contracts c on c.id = i.contract_id
     where c.organization_id = p_org
       and i.expected_date between v_start and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       and c.account_manager_id is not null
     group by 1
  ),
  achieved as (
    select c.account_manager_id as am, sum(coalesce(c.renewal_paid_value,0)) as v
      from public.contracts c
     where c.organization_id = p_org
       and c.end_date between v_start and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       and c.renewed_status = 'YES'
       and c.account_manager_id is not null
     group by 1
  ),
  ach_inst as (
    select c.account_manager_id as am, sum(i.actual_amount) as v
      from public.installments i
      join public.contracts c on c.id = i.contract_id
     where c.organization_id = p_org
       and i.status = 'received'
       and i.actual_date between v_start and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       and c.account_manager_id is not null
     group by 1
  ),
  ams as (
    select am from expected union
    select am from exp_inst union
    select am from achieved union
    select am from ach_inst
  ),
  rolled as (
    select a.am,
      coalesce(e.v,0) + coalesce(ei.v,0) as expected_total,
      coalesce(ac.v,0) + coalesce(ai.v,0) as achieved_total,
      jsonb_build_object(
        'expected_renewals', coalesce(e.v,0),
        'expected_installments', coalesce(ei.v,0),
        'achieved_renewals', coalesce(ac.v,0),
        'achieved_installments', coalesce(ai.v,0)
      ) as breakdown
    from ams a
    left join expected e on e.am = a.am
    left join exp_inst ei on ei.am = a.am
    left join achieved ac on ac.am = a.am
    left join ach_inst ai on ai.am = a.am
  )
  insert into public.am_targets as t
    (organization_id, account_manager_id, month, expected_total, achieved_total, achievement_pct, breakdown_json)
  select p_org, r.am, v_start, r.expected_total, r.achieved_total,
         case when r.expected_total > 0
              then round(100.0 * r.achieved_total / r.expected_total, 2) else 0 end,
         r.breakdown
    from rolled r
  on conflict (organization_id, account_manager_id, month) do update set
    expected_total = excluded.expected_total,
    achieved_total = excluded.achieved_total,
    achievement_pct = excluded.achievement_pct,
    breakdown_json = excluded.breakdown_json,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;
