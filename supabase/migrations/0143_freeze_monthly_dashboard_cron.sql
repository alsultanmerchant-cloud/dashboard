-- 0143_freeze_monthly_dashboard_cron.sql
--
-- Month-end freeze for the revenue dashboard. Without this, a past month's
-- totals would silently recompute (and drift) every time someone opens the
-- dashboard — exactly the thing that makes the sheet's frozen history
-- trustworthy and a live recompute not. This locks each month once it ends.
--
-- freeze_month_dashboards(month) — for every org:
--   1. final recompute of the org-level totals + per-AM targets,
--   2. flip is_frozen=true so compute_monthly_dashboard() becomes a no-op
--      for that month forever after (the RPC already guards on is_frozen).
-- sheet_import rows (e.g. May 2026) are left as-is — they're already frozen
-- authoritative history; we never overwrite their source tag.
--
-- Cron: 02:00 on the 1st of each month, freezing the month that just ended.

create or replace function public.freeze_month_dashboards(p_month date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_org uuid;
  v_count int := 0;
begin
  for v_org in select id from public.organizations loop
    -- Final recompute while still unfrozen (RPC no-ops if already frozen).
    perform public.compute_monthly_dashboard(v_org, v_start);
    perform public.compute_am_monthly_targets(v_org, v_start);
    -- Freeze the org-level totals. Per-AM rows in am_targets are now locked
    -- implicitly: getAmTargets() / compute only recompute for non-frozen
    -- months, so the values just written are their final state.
    update public.monthly_dashboard_totals
       set is_frozen = true,
           source = case when source = 'sheet_import' then source
                         else 'computed_frozen' end,
           frozen_at = now(),
           updated_at = now()
     where organization_id = v_org
       and month = v_start
       and is_frozen = false;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

comment on function public.freeze_month_dashboards(date) is
  'Final-recompute + lock monthly_dashboard_totals for the given month across all orgs. Idempotent (skips already-frozen).';

-- Schedule: 1st of each month at 02:00, freeze the previous month.
-- Unschedule first so re-applying the migration doesn't duplicate the job.
do $$
begin
  perform cron.unschedule('freeze-monthly-dashboard');
exception when others then null;
end $$;

select cron.schedule(
  'freeze-monthly-dashboard',
  '0 2 1 * *',
  $$ select public.freeze_month_dashboards((date_trunc('month', current_date) - interval '1 day')::date); $$
);
