-- 0176_backfill_dept_split_frozen_sheet_import.sql
--
-- Frozen sheet_import months (e.g. May 2026) were imported before migration 0168
-- added the Account/Sales department-split columns, so their acc_*/sales_* are
-- all 0 and the dashboard's department income cards render blank. The dept-split
-- engine (compute_monthly_dashboard) early-returns for frozen months, so it
-- never fills them.
--
-- backfill_frozen_dept_split computes ONLY the acc_*/sales_* columns using the
-- exact same SELECT blocks as migration 0172, and updates them onto the existing
-- frozen row WITHOUT touching total_*, cnt_*, mov_*, is_frozen or source — the
-- frozen legacy totals stay authoritative.
--
-- CAVEAT: installment-based components (acc_exp_inst, acc_act_inst, sales
-- installments) are exact because installment expected/actual dates do not
-- drift. The next_contract_value On-Target/Overdue CLIENT buckets under-report,
-- because contracts.end_date moves forward on renewal — any contract that has
-- since renewed has moved its end_date out of the month. This is best-effort
-- reconstruction; exact parity needs the sheet's Edits-Updates-log archive.

create or replace function public.backfill_frozen_dept_split(p_org uuid, p_month date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_acc_exp_ovd numeric; v_acc_exp_inst numeric; v_acc_exp_on numeric; v_acc_exp_ovc numeric;
  v_acc_act_inst numeric; v_acc_act_on numeric; v_acc_act_ovc numeric; v_acc_sd numeric;
  v_acc_upsell numeric; v_acc_winback numeric; v_acc_expected numeric; v_acc_actual numeric;
  v_s_exp_ovd numeric; v_s_exp_inst numeric; v_s_act_inst numeric;
  v_s_upsell numeric; v_s_new numeric; v_s_expected numeric;
begin
  -- ACCOUNT DEPARTMENT (identical SELECT blocks to migration 0172) -----------
  select coalesce(sum(i.expected_amount),0) into v_acc_exp_ovd from public.installments i
   where i.organization_id=p_org and i.sequence>=2 and i.source_type_key in ('Renew','WinBack','UPSELL')
     and i.expected_date < v_start and (i.actual_date is null or i.actual_date between v_start and v_end)
     and (i.lost_date is null or i.lost_date >= v_start);
  select coalesce(sum(i.expected_amount),0) into v_acc_exp_inst from public.installments i
   where i.organization_id=p_org and i.sequence>=2 and i.source_type_key in ('Renew','WinBack','UPSELL')
     and i.expected_date between v_start and v_end and (i.actual_date is null or i.actual_date >= v_start);
  select coalesce(sum(c.next_contract_value),0) into v_acc_exp_on from public.contracts c
   where c.organization_id=p_org and c.status not in ('closed','lost','renewed')
     and c.end_date between v_start and v_end;
  select coalesce(sum(c.next_contract_value),0) into v_acc_exp_ovc from public.contracts c
   where c.organization_id=p_org and c.status not in ('closed','lost','renewed')
     and c.end_date is not null and c.end_date < v_start;
  select coalesce(sum(i.actual_amount),0) into v_acc_act_inst from public.installments i
   where i.organization_id=p_org and i.sequence>=2 and i.source_type_key in ('Renew','WinBack','UPSELL')
     and i.actual_date between v_start and v_end;
  select coalesce(sum(c.renewal_paid_value),0) into v_acc_act_on from public.contracts c
   where c.organization_id=p_org and c.target='On Target' and c.actual_end_date between v_start and v_end;
  select coalesce(sum(c.renewal_paid_value),0) into v_acc_act_ovc from public.contracts c
   where c.organization_id=p_org and c.target='Overdue' and c.actual_end_date between v_start and v_end;
  select coalesce(sum(c.renewal_paid_value),0) into v_acc_sd from public.contracts c
   where c.organization_id=p_org and c.target='Sales Deposit' and c.actual_end_date between v_start and v_end;
  v_acc_sd := v_acc_sd + coalesce((select sum(c.paid_value) from public.contracts c
     left join public.contract_types ct on ct.id=c.contract_type_id
     where c.organization_id=p_org and ct.key='Renew' and c.start_date between v_start and v_end),0);
  select coalesce(sum(c.paid_value),0) into v_acc_upsell from public.contracts c
     left join public.contract_types ct on ct.id=c.contract_type_id
   where c.organization_id=p_org and ct.key='UPSELL' and c.start_date between v_start and v_end;
  select coalesce(sum(c.paid_value),0) into v_acc_winback from public.contracts c
     left join public.contract_types ct on ct.id=c.contract_type_id
   where c.organization_id=p_org and ct.key='WinBack' and c.start_date between v_start and v_end;
  v_acc_expected := v_acc_exp_ovd + v_acc_exp_inst + v_acc_exp_on + v_acc_exp_ovc;
  v_acc_actual := v_acc_act_inst + v_acc_act_on + v_acc_act_ovc + v_acc_sd + v_acc_upsell + v_acc_winback;

  -- SALES DEPARTMENT --------------------------------------------------------
  select coalesce(sum(i.expected_amount),0) into v_s_exp_ovd from public.installments i
   where i.organization_id=p_org and i.sequence>=2 and i.source_type_key in ('New')
     and i.expected_date < v_start and (i.actual_date is null or i.actual_date between v_start and v_end)
     and (i.lost_date is null or i.lost_date >= v_start);
  select coalesce(sum(i.expected_amount),0) into v_s_exp_inst from public.installments i
   where i.organization_id=p_org and i.sequence>=2 and i.source_type_key in ('New')
     and i.expected_date between v_start and v_end and (i.actual_date is null or i.actual_date >= v_start);
  select coalesce(sum(i.actual_amount),0) into v_s_act_inst from public.installments i
   where i.organization_id=p_org and i.sequence>=2 and i.source_type_key in ('New')
     and i.actual_date between v_start and v_end;
  v_s_upsell := 0;
  select coalesce(sum(c.paid_value),0) into v_s_new from public.contracts c
     left join public.contract_types ct on ct.id=c.contract_type_id
   where c.organization_id=p_org and ct.key='New' and c.start_date between v_start and v_end;
  v_s_expected := v_s_exp_ovd + v_s_exp_inst;

  -- Write ONLY the dept-split columns; never touch frozen totals/cnt/mov/source.
  update public.monthly_dashboard_totals set
    acc_exp_overdue_inst=v_acc_exp_ovd, acc_exp_inst=v_acc_exp_inst,
    acc_exp_ontarget=v_acc_exp_on, acc_exp_overdue_clients=v_acc_exp_ovc, acc_expected=v_acc_expected,
    acc_act_inst=v_acc_act_inst, acc_act_ontarget=v_acc_act_on, acc_act_overdue_clients=v_acc_act_ovc,
    acc_act_sd_renewed=v_acc_sd, acc_upsell=v_acc_upsell, acc_winback=v_acc_winback, acc_actual=v_acc_actual,
    acc_achievement_pct=case when v_acc_expected>0 then round(100.0*v_acc_actual/v_acc_expected,2) else 0 end,
    acc_gap=v_acc_expected - v_acc_actual,
    sales_exp_overdue_inst=v_s_exp_ovd, sales_exp_inst=v_s_exp_inst, sales_expected=v_s_expected,
    sales_act_inst=v_s_act_inst, sales_upsell=v_s_upsell, sales_new_income=v_s_new,
    sales_total_income=v_s_act_inst + v_s_upsell + v_s_new, sales_gap=v_s_expected - v_s_act_inst,
    sales_achievement_pct=case when v_s_expected>0 then round(100.0*v_s_act_inst/v_s_expected,2) else 0 end,
    updated_at=now()
  where organization_id=p_org and month=v_start;
end $$;

-- One-time backfill: only frozen sheet_import months that never got a split.
-- Idempotent: re-running skips rows whose acc_expected/sales_expected are now
-- non-zero.
do $$
declare r record;
begin
  for r in select organization_id, month from public.monthly_dashboard_totals
            where source='sheet_import' and is_frozen=true
              and coalesce(acc_expected,0)=0 and coalesce(sales_expected,0)=0 loop
    perform public.backfill_frozen_dept_split(r.organization_id, r.month);
  end loop;
end $$;
