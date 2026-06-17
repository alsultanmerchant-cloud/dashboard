-- 0193_ceo_insights_renewal_status_fix.sql
--
-- Sky Light feedback (2026-06-17, round 2): ركن المحرك (C113) was badged «On
-- target» — the team says it is NOT on target. Checking the live sheet:
--   • Contract Type (col F) = 'Hold'
--   • Contract Status (col N) = 'Closed'
--   • Target (col E) = 'On Target'   <-- STALE: col E is the AM-health column,
--     never cleared when the contract was held/closed.
-- 0191 had renewal_status follow col E `target`, so it inherited that stale
-- 'On Target'. (The sync also maps a Hold-type contract to status='hold',
-- masking the underlying 'Closed' — a known data quirk we are NOT touching here.)
--
-- Correct reading: a HELD contract's renewal clock is PAUSED — it is not in the
-- renewal pipeline at all (neither on-target nor overdue). C113 should carry no
-- renewal badge, only its overdue-payment badge.
--
-- Fix: renewal_status no longer reads the stale col E `target`. It now uses the
-- SAME month-aware end_date logic as the renewal funnel (0172/0174), restricted
-- to genuinely in-pipeline contracts — status in ('active','expired') only
-- (hold = paused, renewed/closed/lost = out):
--   end_date < month_start            => 'overdue'
--   end_date within the month         => 'on_target'
--   future / none / held / closed     => null
-- payment_status and the closed/lost exclusion (0192) are unchanged.
--
-- Return type unchanged from 0191/0192 → CREATE OR REPLACE (no drop).

create or replace function public.get_ceo_client_insights(
  p_org uuid,
  p_month date,
  p_limit integer default 12
) returns table (
  client_id uuid,
  client_name text,
  client_code text,
  account_manager_name text,
  active_contracts integer,
  total_contract_value numeric,
  month_expected numeric,
  month_collected numeric,
  overdue_installments numeric,
  renewal_value_due numeric,
  next_renewal_date date,
  satisfaction_score integer,
  sentiment text,
  satisfaction_summary text,
  top_risk text,
  open_task_count integer,
  overdue_task_count integer,
  on_time_pct_30d numeric,
  health_score numeric,
  health_label text,
  renewal_status text,
  payment_status text
)
language sql
stable
security definer
set search_path = public
as $$
with bounds as (
  select
    date_trunc('month', p_month)::date as month_start,
    (date_trunc('month', p_month) + interval '1 month - 1 day')::date as month_end
),
contract_rollup as (
  select
    c.client_id,
    count(*) filter (where c.status in ('active', 'hold', 'expired', 'renewed'))::int as active_contracts,
    coalesce(sum(c.total_value) filter (where c.status in ('active', 'hold', 'expired', 'renewed')), 0) as total_contract_value,
    coalesce(sum(coalesce(c.next_contract_value, c.total_value)) filter (
      where c.end_date between b.month_start and b.month_end
        and c.target in ('On Target', 'On-Target', 'Overdue')
    ), 0) as renewal_value_due,
    min(c.end_date) filter (
      where c.end_date >= b.month_start
        and c.status in ('active', 'hold', 'expired', 'renewed')
    ) as next_renewal_date,
    -- Renewal pipeline = genuinely in-play contracts only. 'hold' is PAUSED, so
    -- it is excluded (a held contract is neither on-target nor overdue). Overdue
    -- vs on-target follows the selected month's end_date, matching funnel 0172/0174.
    bool_or(
      c.status in ('active', 'expired')
      and c.end_date is not null and c.end_date < b.month_start
    ) as has_overdue_renewal,
    bool_or(
      c.status in ('active', 'expired')
      and c.end_date between b.month_start and b.month_end
    ) as has_on_target_renewal,
    (array_remove(array_agg(ep.full_name order by c.total_value desc nulls last), null))[1] as account_manager_name
  from public.contracts c
  cross join bounds b
  left join public.employee_profiles ep on ep.id = c.account_manager_id
  where c.organization_id = p_org
  group by c.client_id
),
installment_rollup as (
  select
    c.client_id,
    coalesce(sum(i.expected_amount) filter (where i.expected_date between b.month_start and b.month_end), 0) as expected_this_month,
    coalesce(sum(i.actual_amount) filter (where i.actual_date between b.month_start and b.month_end), 0) as collected_this_month,
    coalesce(sum(greatest(i.expected_amount - coalesce(i.actual_amount, 0), 0)) filter (
      where i.status = 'overdue'
         or (i.expected_date < current_date and coalesce(i.status, 'pending') not in ('received', 'waived'))
    ), 0) as overdue_installments,
    coalesce(sum(greatest(i.expected_amount - coalesce(i.actual_amount, 0), 0)) filter (
      where i.expected_date between b.month_start and b.month_end
        and coalesce(i.status, 'pending') not in ('received', 'waived')
    ), 0) as due_this_month
  from public.installments i
  join public.contracts c on c.id = i.contract_id
  cross join bounds b
  where c.organization_id = p_org
  group by c.client_id
),
satisfaction as (
  select distinct on (client_id)
    client_id,
    satisfaction_score,
    sentiment,
    summary,
    case
      when jsonb_typeof(risks) = 'array' and jsonb_array_length(risks) > 0 then
        coalesce(
          risks->0->>'title',
          risks->0->>'risk',
          trim(both '"' from (risks->0)::text)
        )
      else null
    end as top_risk
  from public.client_satisfaction_analyses
  where organization_id = p_org
    and is_current = true
  order by client_id, created_at desc
),
base as (
  select
    cl.id as client_id,
    cl.name as client_name,
    cl.external_id as client_code,
    cr.account_manager_name,
    coalesce(cr.active_contracts, 0) as active_contracts,
    coalesce(cr.total_contract_value, 0) as total_contract_value,
    coalesce(ir.expected_this_month, 0) + coalesce(cr.renewal_value_due, 0) as month_expected,
    coalesce(ir.collected_this_month, 0) as month_collected,
    coalesce(ir.overdue_installments, 0) as overdue_installments,
    coalesce(ir.due_this_month, 0) as due_this_month,
    coalesce(cr.renewal_value_due, 0) as renewal_value_due,
    cr.next_renewal_date,
    coalesce(cr.has_overdue_renewal, false) as has_overdue_renewal,
    coalesce(cr.has_on_target_renewal, false) as has_on_target_renewal,
    s.satisfaction_score,
    s.sentiment,
    s.summary as satisfaction_summary,
    s.top_risk,
    coalesce(dh.open_task_count, 0) as open_task_count,
    coalesce(dh.overdue_task_count, 0) as overdue_task_count,
    dh.on_time_pct_30d,
    greatest(
      0,
      least(
        100,
        coalesce(s.satisfaction_score, 72)
        - case when coalesce(ir.overdue_installments, 0) > 0 then 14 else 0 end
        - least(18, coalesce(dh.overdue_task_count, 0) * 4)
        + case when coalesce(dh.on_time_pct_30d, 100) >= 85 then 5 else 0 end
      )
    )::numeric(6,2) as health_score
  from public.clients cl
  left join contract_rollup cr on cr.client_id = cl.id
  left join installment_rollup ir on ir.client_id = cl.id
  left join satisfaction s on s.client_id = cl.id
  left join public.v_client_delivery_health dh
    on dh.organization_id = cl.organization_id
   and dh.client_id = cl.id
  where cl.organization_id = p_org
),
renewal_window as (
  select (date_trunc('month', p_month) + interval '1 month - 1 day' + interval '45 days')::date as soon_by
)
select
  b.client_id,
  b.client_name,
  b.client_code,
  b.account_manager_name,
  b.active_contracts,
  b.total_contract_value,
  b.month_expected,
  b.month_collected,
  b.overdue_installments,
  b.renewal_value_due,
  b.next_renewal_date,
  b.satisfaction_score,
  b.sentiment,
  b.satisfaction_summary,
  b.top_risk,
  b.open_task_count,
  b.overdue_task_count,
  b.on_time_pct_30d,
  b.health_score,
  case
    when b.health_score >= 80 then 'healthy'
    when b.health_score >= 60 then 'watch'
    else 'risk'
  end as health_label,
  case
    when b.has_overdue_renewal then 'overdue'
    when b.has_on_target_renewal then 'on_target'
    else null
  end as renewal_status,
  case
    when b.overdue_installments > 0 then 'overdue'
    when b.due_this_month > 0 then 'due'
    else null
  end as payment_status
from base b
cross join renewal_window rw
-- Must be a CURRENT client — at least one contract not closed/lost (0192).
where b.active_contracts > 0
  and (
    b.top_risk is not null
    or b.overdue_installments > 0
    or (b.satisfaction_score is not null
        and (b.sentiment = 'negative' or b.satisfaction_score < 70))
    or (b.next_renewal_date is not null and b.next_renewal_date <= rw.soon_by)
  )
order by
  case
    when b.satisfaction_score is not null
      and (b.sentiment = 'negative' or b.satisfaction_score < 55) then 0
    when b.overdue_installments > 0 then 1
    when b.satisfaction_score is not null and b.satisfaction_score < 70 then 2
    when b.next_renewal_date is not null and b.next_renewal_date <= rw.soon_by then 3
    else 4
  end,
  b.overdue_installments desc,
  b.next_renewal_date asc nulls last,
  b.month_collected desc,
  b.client_name
limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

comment on function public.get_ceo_client_insights(uuid, date, integer) is
  'CEO dashboard action list: current clients (>=1 contract not closed/lost) needing attention for the selected month, by severity. renewal_status uses month-aware end_date (matching funnel 0172/0174) over in-pipeline contracts only — status in (active,expired); held/renewed/closed are NOT renewal targets (0193, replaces the stale col E target read from 0191). payment_status (overdue/due/null) is a separate collections signal.';
