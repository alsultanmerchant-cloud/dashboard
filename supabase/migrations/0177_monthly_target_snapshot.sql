-- 0177_monthly_target_snapshot.sql
--
-- Forward-correct history for the CEO dashboard drill-down. get_month_target_
-- buckets (0174) recomputes from CURRENT contract state, which is exact only for
-- the live month — `contracts.end_date` drifts forward on renewal, so a past
-- month's per-client On-Target/Overdue lists under-report once contracts renew.
--
-- This table captures the per-contract bucket membership at the moment a month
-- is frozen (before any drift), so closed months read an authoritative snapshot
-- instead of a drifted live recompute. The dept money already lives frozen in
-- monthly_dashboard_totals; this owns the per-client lists.
--
-- PK includes `bucket` because a contract can legitimately appear in both a
-- funnel card (on_target/overdue) and an outcome card (renewed/lost).
--
-- NOTE: only months frozen AFTER this ships get a snapshot. Pre-existing frozen
-- months (e.g. May 2026, source='sheet_import') have none and fall back to the
-- live recompute; exact parity for those needs the sheet's Edits-Updates-log
-- archive (out of scope).

create table if not exists public.monthly_target_snapshot (
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  month                    date not null,
  contract_id              uuid not null references public.contracts(id) on delete cascade,
  bucket                   text not null,
  client_name              text,
  client_code              text,
  account_manager_name     text,
  value                    numeric not null default 0,
  end_date_at_freeze       date,
  status_at_freeze         text,
  renewed_status_at_freeze text,
  frozen_at                timestamptz not null default now(),
  primary key (organization_id, month, contract_id, bucket)
);

create index if not exists idx_mts_org_month_bucket
  on public.monthly_target_snapshot (organization_id, month, bucket);

comment on table public.monthly_target_snapshot is
  'Per-contract, per-month bucket membership captured at month freeze. Makes the CEO dashboard drill-down exact for closed months (immune to end_date drift on renewal). Populated by freeze_month_dashboards.';

-- Extend the freeze routine to capture the snapshot at lock time. Contract
-- end_date has not yet drifted for the just-closed month, so this is the
-- authoritative per-client bucket membership for that month.
create or replace function public.freeze_month_dashboards(p_month date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_org uuid;
  v_count int := 0;
begin
  for v_org in select id from public.organizations loop
    perform public.compute_monthly_dashboard(v_org, v_start);
    perform public.compute_am_monthly_targets(v_org, v_start);
    update public.monthly_dashboard_totals
       set is_frozen = true,
           source = case when source = 'sheet_import' then source
                         else 'computed_frozen' end,
           frozen_at = now(),
           updated_at = now()
     where organization_id = v_org
       and month = v_start
       and is_frozen = false;
    if found then
      v_count := v_count + 1;
      -- Snapshot the per-client bucket membership for this just-frozen month.
      insert into public.monthly_target_snapshot (
        organization_id, month, contract_id, bucket,
        client_name, client_code, account_manager_name, value,
        end_date_at_freeze, status_at_freeze, renewed_status_at_freeze
      )
      select v_org, v_start, b.contract_id, b.bucket,
             b.client_name, b.client_code, b.account_manager_name, b.value,
             c.end_date, c.status, c.renewed_status
        from public.get_month_target_buckets(v_org, v_start) b
        join public.contracts c on c.id = b.contract_id
      on conflict (organization_id, month, contract_id, bucket) do nothing;
    end if;
  end loop;
  return v_count;
end $$;

comment on function public.freeze_month_dashboards(date) is
  'Final-recompute + lock monthly_dashboard_totals AND capture monthly_target_snapshot for the given month across all orgs. Idempotent (skips already-frozen; snapshot uses on conflict do nothing).';
