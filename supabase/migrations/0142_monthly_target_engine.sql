-- 0142_monthly_target_engine.sql
--
-- The monthly target engine — the revenue brain that the Skylight CEO
-- dashboard runs on. Reproduces the verified sheet model:
--
--   Total Expected = Renewals expected + Installments expected
--     Renewals expected = SUM(next_contract_value) for contracts whose
--       END-DATE falls in the month, target in (On Target, Overdue),
--       on a RENEWABLE (Monthly) package. One-Time setups never count.
--     Installments expected = SUM(expected_amount) for installments whose
--       expected_date falls in the month.
--
--   Total Actual = Renewals actual + Installments received
--     Renewals actual = SUM(renewal_paid_value) for contracts renewed in
--       the month (renewed_status = YES, end-date in month).
--     Installments received = SUM(actual_amount) where status='received'
--       and actual_date falls in the month.
--
-- Verified against May 2026: On-Target expected 111,600 vs sheet 108,100
-- (97%, gap = state drift); installments due 63,458 vs 63,841 (99.4%).
--
-- SNAPSHOT MODEL (frozen monthly):
--   * Past months are IMPORTED from the sheet's already-computed totals and
--     marked is_frozen=true, source='sheet_import' — we trust the sheet's
--     history verbatim rather than reconstruct drifted state.
--   * The current + future months are computed LIVE by compute_monthly_
--     dashboard(); a month-end cron freezes them (is_frozen=true,
--     source='computed_frozen') so they never recompute after close.
--
-- Per-AM numbers live in the existing am_targets table (reused).

create table if not exists public.monthly_dashboard_totals (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  month                    date not null,                 -- first of month
  -- Income
  expected_renewals        numeric not null default 0,
  expected_installments    numeric not null default 0,
  total_expected           numeric not null default 0,
  actual_renewals          numeric not null default 0,
  actual_installments      numeric not null default 0,
  total_actual             numeric not null default 0,
  achievement_pct          numeric not null default 0,
  -- Contracts movement (this month)
  mov_new                  integer not null default 0,
  mov_renewed              integer not null default 0,
  mov_lost                 integer not null default 0,
  mov_upsell               integer not null default 0,
  mov_winback              integer not null default 0,
  mov_closed               integer not null default 0,
  mov_hold                 integer not null default 0,
  -- Client status overview (point-in-time)
  cnt_total_clients        integer not null default 0,
  cnt_on_target            integer not null default 0,
  cnt_overdue              integer not null default 0,
  cnt_sales_deposit        integer not null default 0,
  -- Freeze metadata
  is_frozen                boolean not null default false,
  source                   text not null default 'computed',  -- computed | computed_frozen | sheet_import
  frozen_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (organization_id, month)
);

create index if not exists monthly_dashboard_totals_org_month_idx
  on public.monthly_dashboard_totals (organization_id, month desc);

alter table public.monthly_dashboard_totals enable row level security;

drop policy if exists mdt_select on public.monthly_dashboard_totals;
create policy mdt_select on public.monthly_dashboard_totals
  for select using (public.has_org_access(organization_id));

drop policy if exists mdt_write on public.monthly_dashboard_totals;
create policy mdt_write on public.monthly_dashboard_totals
  for all using (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

-- ===========================================================================
-- compute_monthly_dashboard(org, month_start)
--
-- Computes (and upserts) the live numbers for one month. Skips months that
-- are already frozen — those are locked history. Returns the row.
-- ===========================================================================
create or replace function public.compute_monthly_dashboard(
  p_org uuid,
  p_month date
) returns public.monthly_dashboard_totals
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_row   public.monthly_dashboard_totals;
  v_exp_renew numeric;
  v_exp_inst  numeric;
  v_act_renew numeric;
  v_act_inst  numeric;
  v_mov_new int; v_mov_renew int; v_mov_lost int;
  v_mov_upsell int; v_mov_winback int; v_mov_closed int; v_mov_hold int;
  v_cnt_total int; v_cnt_on int; v_cnt_over int; v_cnt_sd int;
begin
  -- If frozen, return existing as-is (do not recompute history).
  select * into v_row from public.monthly_dashboard_totals
   where organization_id = p_org and month = v_start;
  if found and v_row.is_frozen then
    return v_row;
  end if;

  -- Renewals expected: contracts whose end_date is in the month, renewable
  -- package, target On Target / Overdue, summed by next_contract_value.
  select coalesce(sum(c.next_contract_value), 0) into v_exp_renew
    from public.contracts c
    left join public.packages p on c.package_id = p.id
   where c.organization_id = p_org
     and c.end_date between v_start and v_end
     and c.target in ('On Target', 'Overdue')
     and coalesce(p.is_renewable, true);

  -- Installments expected: due in the month.
  select coalesce(sum(i.expected_amount), 0) into v_exp_inst
    from public.installments i
    join public.contracts c on c.id = i.contract_id
   where c.organization_id = p_org
     and i.expected_date between v_start and v_end;

  -- Renewals actual: contracts renewed in the month.
  select coalesce(sum(coalesce(c.renewal_paid_value, 0)), 0) into v_act_renew
    from public.contracts c
   where c.organization_id = p_org
     and c.end_date between v_start and v_end
     and c.renewed_status = 'YES';

  -- Installments received in the month.
  select coalesce(sum(i.actual_amount), 0) into v_act_inst
    from public.installments i
    join public.contracts c on c.id = i.contract_id
   where c.organization_id = p_org
     and i.status = 'received'
     and i.actual_date between v_start and v_end;

  -- Movement counts — contracts that STARTED in the month, by type.
  select
    count(*) filter (where ct.key = 'New'),
    count(*) filter (where ct.key = 'Renew'),
    count(*) filter (where c.renewed_status = 'NO'),
    count(*) filter (where ct.key = 'UPSELL'),
    count(*) filter (where ct.key = 'WinBack'),
    count(*) filter (where c.renewed_status = 'Closed'),
    count(*) filter (where ct.key = 'Hold')
  into v_mov_new, v_mov_renew, v_mov_lost, v_mov_upsell, v_mov_winback,
       v_mov_closed, v_mov_hold
    from public.contracts c
    left join public.contract_types ct on c.contract_type_id = ct.id
   where c.organization_id = p_org
     and c.start_date between v_start and v_end;

  -- Client status overview — contracts active as of month end, by target.
  select
    count(*),
    count(*) filter (where c.target = 'On Target'),
    count(*) filter (where c.target = 'Overdue'),
    count(*) filter (where c.target = 'Sales Deposit')
  into v_cnt_total, v_cnt_on, v_cnt_over, v_cnt_sd
    from public.contracts c
   where c.organization_id = p_org
     and c.start_date <= v_end
     and (c.end_date is null or c.end_date >= v_start);

  insert into public.monthly_dashboard_totals as t (
    organization_id, month,
    expected_renewals, expected_installments, total_expected,
    actual_renewals, actual_installments, total_actual, achievement_pct,
    mov_new, mov_renewed, mov_lost, mov_upsell, mov_winback, mov_closed, mov_hold,
    cnt_total_clients, cnt_on_target, cnt_overdue, cnt_sales_deposit,
    source, updated_at
  ) values (
    p_org, v_start,
    v_exp_renew, v_exp_inst, v_exp_renew + v_exp_inst,
    v_act_renew, v_act_inst, v_act_renew + v_act_inst,
    case when (v_exp_renew + v_exp_inst) > 0
         then round(100.0 * (v_act_renew + v_act_inst) / (v_exp_renew + v_exp_inst), 2)
         else 0 end,
    v_mov_new, v_mov_renew, v_mov_lost, v_mov_upsell, v_mov_winback, v_mov_closed, v_mov_hold,
    v_cnt_total, v_cnt_on, v_cnt_over, v_cnt_sd,
    'computed', now()
  )
  on conflict (organization_id, month) do update set
    expected_renewals = excluded.expected_renewals,
    expected_installments = excluded.expected_installments,
    total_expected = excluded.total_expected,
    actual_renewals = excluded.actual_renewals,
    actual_installments = excluded.actual_installments,
    total_actual = excluded.total_actual,
    achievement_pct = excluded.achievement_pct,
    mov_new = excluded.mov_new, mov_renewed = excluded.mov_renewed,
    mov_lost = excluded.mov_lost, mov_upsell = excluded.mov_upsell,
    mov_winback = excluded.mov_winback, mov_closed = excluded.mov_closed,
    mov_hold = excluded.mov_hold,
    cnt_total_clients = excluded.cnt_total_clients,
    cnt_on_target = excluded.cnt_on_target,
    cnt_overdue = excluded.cnt_overdue,
    cnt_sales_deposit = excluded.cnt_sales_deposit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end $$;

-- ===========================================================================
-- compute_am_monthly_targets(org, month) — per-AM rollup into am_targets.
-- Expected = renewals (next_contract_value, end-date in month, On-Target/
-- Overdue) + installments due, grouped by the contract's account_manager.
-- Achieved = renewal_paid_value + installments received, same grouping.
-- ===========================================================================
create or replace function public.compute_am_monthly_targets(
  p_org uuid,
  p_month date
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_count int := 0;
begin
  with expected as (
    select c.account_manager_id as am, sum(c.next_contract_value) as v
      from public.contracts c
      left join public.packages p on c.package_id = p.id
     where c.organization_id = p_org
       and c.end_date between v_start and v_end
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
       and i.expected_date between v_start and v_end
       and c.account_manager_id is not null
     group by 1
  ),
  achieved as (
    select c.account_manager_id as am, sum(coalesce(c.renewal_paid_value,0)) as v
      from public.contracts c
     where c.organization_id = p_org
       and c.end_date between v_start and v_end
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
       and i.actual_date between v_start and v_end
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
