-- 0172_contracts_count_tiles_endmonth_basis.sql
--
-- Fix the Account "Target Overview" count tiles (cnt_on_target / cnt_overdue)
-- in compute_monthly_dashboard. They were computed from the point-in-time
-- `contracts.target` STRING under a shared active-window filter, which was
-- doubly broken vs the sheet's "Target Overview (This Month)" counts:
--
--   1. The shared filter `start_date <= v_end and (end_date is null or
--      end_date >= v_start)` excluded EVERY overdue contract — an overdue
--      contract has end_date < month-start by definition — so cnt_overdue
--      always collapsed to 0 (sheet showed 24).
--   2. `target = 'On Target'` missed rows stored as the 'On-Target' hyphen
--      variant, undercounting on-target.
--
-- The money cells G27/H27 were already correct because they key off
-- end_date + status (not the target string), which is why their SUMs matched
-- the sheet to the riyal while the COUNT tiles did not. This migration aligns
-- the count tiles onto that same end_date-window basis so the funnel strip is
-- consistent with the money. Only the count block changes; every other line is
-- identical to 0168.

create or replace function public.compute_monthly_dashboard(
  p_org uuid,
  p_month date
) returns public.monthly_dashboard_totals
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_row   public.monthly_dashboard_totals;
  -- legacy (0142)
  v_exp_renew numeric;
  v_exp_inst  numeric;
  v_act_renew numeric;
  v_act_inst  numeric;
  v_mov_new int; v_mov_renew int; v_mov_lost int;
  v_mov_upsell int; v_mov_winback int; v_mov_closed int; v_mov_hold int;
  v_cnt_total int; v_cnt_on int; v_cnt_over int; v_cnt_sd int;
  -- account dept
  v_acc_exp_ovd numeric; v_acc_exp_inst numeric; v_acc_exp_on numeric; v_acc_exp_ovc numeric;
  v_acc_act_inst numeric; v_acc_act_on numeric; v_acc_act_ovc numeric; v_acc_sd numeric;
  v_acc_upsell numeric; v_acc_winback numeric;
  v_acc_expected numeric; v_acc_actual numeric;
  -- sales dept
  v_s_exp_ovd numeric; v_s_exp_inst numeric; v_s_act_inst numeric;
  v_s_upsell numeric; v_s_new numeric; v_s_expected numeric;
begin
  -- If frozen, return existing as-is (do not recompute history).
  select * into v_row from public.monthly_dashboard_totals
   where organization_id = p_org and month = v_start;
  if found and v_row.is_frozen then
    return v_row;
  end if;

  -- ======================= LEGACY 0142 NUMBERS (kept) =======================
  select coalesce(sum(c.next_contract_value), 0) into v_exp_renew
    from public.contracts c
    left join public.packages p on c.package_id = p.id
   where c.organization_id = p_org
     and c.end_date between v_start and v_end
     and c.target in ('On Target', 'Overdue')
     and coalesce(p.is_renewable, true);

  select coalesce(sum(i.expected_amount), 0) into v_exp_inst
    from public.installments i
    join public.contracts c on c.id = i.contract_id
   where c.organization_id = p_org
     and i.expected_date between v_start and v_end;

  select coalesce(sum(coalesce(c.renewal_paid_value, 0)), 0) into v_act_renew
    from public.contracts c
   where c.organization_id = p_org
     and c.end_date between v_start and v_end
     and c.renewed_status = 'YES';

  select coalesce(sum(i.actual_amount), 0) into v_act_inst
    from public.installments i
    join public.contracts c on c.id = i.contract_id
   where c.organization_id = p_org
     and i.status = 'received'
     and i.actual_date between v_start and v_end;

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

  -- Count tiles (Target Overview): use the SAME end_date-window basis as the
  -- money cells G27/H27, NOT the point-in-time `target` string. (See header.)
  --   total      = contracts active in the selected month
  --   on target  = open AND expected end inside the month
  --   overdue    = open AND expected end before the month
  --   sales dep. = unchanged (target label; not an end_date concept)
  select
    count(*) filter (
      where c.start_date <= v_end and (c.end_date is null or c.end_date >= v_start)),
    count(*) filter (
      where c.status not in ('closed', 'lost', 'renewed')
        and c.end_date between v_start and v_end),
    count(*) filter (
      where c.status not in ('closed', 'lost', 'renewed')
        and c.end_date is not null and c.end_date < v_start),
    count(*) filter (where c.target = 'Sales Deposit')
  into v_cnt_total, v_cnt_on, v_cnt_over, v_cnt_sd
    from public.contracts c
   where c.organization_id = p_org;

  -- ======================= ACCOUNT DEPARTMENT =======================
  -- Installment income: account types, payments seq >= 2 only.
  -- E27 overdue installments: expected before month, still open or collected
  -- this month, contract not lost before month.
  select coalesce(sum(i.expected_amount), 0) into v_acc_exp_ovd
    from public.installments i
   where i.organization_id = p_org and i.sequence >= 2
     and i.source_type_key in ('Renew', 'WinBack', 'UPSELL')
     and i.expected_date < v_start
     and (i.actual_date is null or i.actual_date between v_start and v_end)
     and (i.lost_date is null or i.lost_date >= v_start);

  -- F27 installments due this month, not collected before month.
  select coalesce(sum(i.expected_amount), 0) into v_acc_exp_inst
    from public.installments i
   where i.organization_id = p_org and i.sequence >= 2
     and i.source_type_key in ('Renew', 'WinBack', 'UPSELL')
     and i.expected_date between v_start and v_end
     and (i.actual_date is null or i.actual_date >= v_start);

  -- G27 On-Target clients: next contract value of contracts whose EXPECTED end
  -- falls in the month and are still in the renewal pool. Mirrors the sheet's
  -- Target_ByMonth='On Target' (col V): bucket by expected end vs the month,
  -- excluding closed/renewed/lost. No renewable filter (sheet doesn't apply one).
  select coalesce(sum(c.next_contract_value), 0) into v_acc_exp_on
    from public.contracts c
   where c.organization_id = p_org
     and c.status not in ('closed', 'lost', 'renewed')
     and c.end_date between v_start and v_end;

  -- H27 Overdue clients: expected end BEFORE the month, still awaiting renewal.
  select coalesce(sum(c.next_contract_value), 0) into v_acc_exp_ovc
    from public.contracts c
   where c.organization_id = p_org
     and c.status not in ('closed', 'lost', 'renewed')
     and c.end_date is not null and c.end_date < v_start;

  -- F30 installments collected this month (account types, seq >= 2).
  select coalesce(sum(i.actual_amount), 0) into v_acc_act_inst
    from public.installments i
   where i.organization_id = p_org and i.sequence >= 2
     and i.source_type_key in ('Renew', 'WinBack', 'UPSELL')
     and i.actual_date between v_start and v_end;

  -- G30 / H30 renewal payments collected this month, by bucket.
  select coalesce(sum(c.renewal_paid_value), 0) into v_acc_act_on
    from public.contracts c
   where c.organization_id = p_org and c.target = 'On Target'
     and c.actual_end_date between v_start and v_end;
  select coalesce(sum(c.renewal_paid_value), 0) into v_acc_act_ovc
    from public.contracts c
   where c.organization_id = p_org and c.target = 'Overdue'
     and c.actual_end_date between v_start and v_end;

  -- E30 S.D & Renewed: Sales-Deposit collected (renewal paid, ended this month)
  --   + #Renewal#(=Renew) repeated value started this month.
  select coalesce(sum(c.renewal_paid_value), 0) into v_acc_sd
    from public.contracts c
   where c.organization_id = p_org and c.target = 'Sales Deposit'
     and c.actual_end_date between v_start and v_end;
  v_acc_sd := v_acc_sd + coalesce((
    select sum(c.paid_value) from public.contracts c
    left join public.contract_types ct on ct.id = c.contract_type_id
    where c.organization_id = p_org and ct.key = 'Renew'
      and c.start_date between v_start and v_end), 0);

  -- F32 Upsell-Acc + G32 Win-Back: actual paid value of contracts started this month.
  select coalesce(sum(c.paid_value), 0) into v_acc_upsell
    from public.contracts c
    left join public.contract_types ct on ct.id = c.contract_type_id
   where c.organization_id = p_org and ct.key = 'UPSELL'
     and c.start_date between v_start and v_end;
  select coalesce(sum(c.paid_value), 0) into v_acc_winback
    from public.contracts c
    left join public.contract_types ct on ct.id = c.contract_type_id
   where c.organization_id = p_org and ct.key = 'WinBack'
     and c.start_date between v_start and v_end;

  v_acc_expected := v_acc_exp_ovd + v_acc_exp_inst + v_acc_exp_on + v_acc_exp_ovc;
  v_acc_actual   := v_acc_act_inst + v_acc_act_on + v_acc_act_ovc + v_acc_sd
                    + v_acc_upsell + v_acc_winback;

  -- ======================= SALES DEPARTMENT =======================
  -- E36 sales overdue installments.
  select coalesce(sum(i.expected_amount), 0) into v_s_exp_ovd
    from public.installments i
   where i.organization_id = p_org and i.sequence >= 2
     and i.source_type_key in ('New')
     and i.expected_date < v_start
     and (i.actual_date is null or i.actual_date between v_start and v_end)
     and (i.lost_date is null or i.lost_date >= v_start);

  -- F36 sales installments due this month.
  select coalesce(sum(i.expected_amount), 0) into v_s_exp_inst
    from public.installments i
   where i.organization_id = p_org and i.sequence >= 2
     and i.source_type_key in ('New')
     and i.expected_date between v_start and v_end
     and (i.actual_date is null or i.actual_date >= v_start);

  -- H36 sales installments collected this month.
  select coalesce(sum(i.actual_amount), 0) into v_s_act_inst
    from public.installments i
   where i.organization_id = p_org and i.sequence >= 2
     and i.source_type_key in ('New')
     and i.actual_date between v_start and v_end;

  -- G38 Upsell-Sales (no such type today → 0) ; H38 new-client income.
  v_s_upsell := 0;
  select coalesce(sum(c.paid_value), 0) into v_s_new
    from public.contracts c
    left join public.contract_types ct on ct.id = c.contract_type_id
   where c.organization_id = p_org and ct.key = 'New'
     and c.start_date between v_start and v_end;

  v_s_expected := v_s_exp_ovd + v_s_exp_inst;

  -- ======================= UPSERT =======================
  insert into public.monthly_dashboard_totals as t (
    organization_id, month,
    expected_renewals, expected_installments, total_expected,
    actual_renewals, actual_installments, total_actual, achievement_pct,
    mov_new, mov_renewed, mov_lost, mov_upsell, mov_winback, mov_closed, mov_hold,
    cnt_total_clients, cnt_on_target, cnt_overdue, cnt_sales_deposit,
    acc_exp_overdue_inst, acc_exp_inst, acc_exp_ontarget, acc_exp_overdue_clients, acc_expected,
    acc_act_inst, acc_act_ontarget, acc_act_overdue_clients, acc_act_sd_renewed,
    acc_upsell, acc_winback, acc_actual, acc_achievement_pct, acc_gap,
    sales_exp_overdue_inst, sales_exp_inst, sales_expected,
    sales_act_inst, sales_upsell, sales_new_income, sales_total_income,
    sales_gap, sales_achievement_pct,
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
    v_acc_exp_ovd, v_acc_exp_inst, v_acc_exp_on, v_acc_exp_ovc, v_acc_expected,
    v_acc_act_inst, v_acc_act_on, v_acc_act_ovc, v_acc_sd,
    v_acc_upsell, v_acc_winback, v_acc_actual,
    case when v_acc_expected > 0 then round(100.0 * v_acc_actual / v_acc_expected, 2) else 0 end,
    v_acc_expected - v_acc_actual,
    v_s_exp_ovd, v_s_exp_inst, v_s_expected,
    v_s_act_inst, v_s_upsell, v_s_new, v_s_act_inst + v_s_upsell + v_s_new,
    v_s_expected - v_s_act_inst,
    case when v_s_expected > 0 then round(100.0 * v_s_act_inst / v_s_expected, 2) else 0 end,
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
    acc_exp_overdue_inst = excluded.acc_exp_overdue_inst,
    acc_exp_inst = excluded.acc_exp_inst,
    acc_exp_ontarget = excluded.acc_exp_ontarget,
    acc_exp_overdue_clients = excluded.acc_exp_overdue_clients,
    acc_expected = excluded.acc_expected,
    acc_act_inst = excluded.acc_act_inst,
    acc_act_ontarget = excluded.acc_act_ontarget,
    acc_act_overdue_clients = excluded.acc_act_overdue_clients,
    acc_act_sd_renewed = excluded.acc_act_sd_renewed,
    acc_upsell = excluded.acc_upsell,
    acc_winback = excluded.acc_winback,
    acc_actual = excluded.acc_actual,
    acc_achievement_pct = excluded.acc_achievement_pct,
    acc_gap = excluded.acc_gap,
    sales_exp_overdue_inst = excluded.sales_exp_overdue_inst,
    sales_exp_inst = excluded.sales_exp_inst,
    sales_expected = excluded.sales_expected,
    sales_act_inst = excluded.sales_act_inst,
    sales_upsell = excluded.sales_upsell,
    sales_new_income = excluded.sales_new_income,
    sales_total_income = excluded.sales_total_income,
    sales_gap = excluded.sales_gap,
    sales_achievement_pct = excluded.sales_achievement_pct,
    updated_at = now()
  returning * into v_row;

  return v_row;
end $$;
