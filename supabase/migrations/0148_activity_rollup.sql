-- =========================================================================
-- Migration 0148 — Activity rollup (employee_activity_daily) + scoring
-- =========================================================================
-- Phase 2 of the activity/audit system. Rolls ownership_episodes (0147) into a
-- per-employee daily score over a rolling working-day window, ready for the CEO
-- "نبض الفريق" board. Honest N/A: components are NULL when their denominator is
-- 0; activity_pct is NULL ("not instrumented / no duties") rather than a false 0.
--
-- activity_pct = blend(Responsiveness 0.55, Throughput 0.25, Freshness 0.20)
-- with null components dropped and remaining weights renormalized.
--   Responsiveness R = 100 * answered_within_sla / episodes_with_sla
--   Throughput     T = min(100, 100 * answered / owned)
--   Freshness      F = 100 * (1 - stale_open / open_owned)
-- Only forward-captured episodes (external_origin = false) are scored.
-- =========================================================================

create table if not exists public.employee_activity_daily (
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_id         uuid not null references public.employee_profiles(id) on delete cascade,
  activity_date       date not null,
  owned_episodes      int not null default 0,
  answered_episodes   int not null default 0,
  answered_within_sla int not null default 0,
  episodes_with_sla   int not null default 0,
  stale_open          int not null default 0,
  open_owned          int not null default 0,
  actions_count       int not null default 0,
  responsiveness      numeric(5,1),
  throughput          numeric(5,1),
  freshness           numeric(5,1),
  activity_pct        numeric(5,1),
  confidence          text not null default 'high',  -- high | low (R missing)
  status              text not null default 'not_instrumented', -- active|at_risk|idle|not_instrumented
  computed_at         timestamptz not null default now(),
  primary key (organization_id, employee_id, activity_date)
);

comment on table public.employee_activity_daily is
  'Per-employee daily activity score rolled up from ownership_episodes over a working-day window. Read by the CEO team-activity board. Populated by compute_employee_activity() via cron.';

create index if not exists idx_activity_daily_org_date on public.employee_activity_daily(organization_id, activity_date);

alter table public.employee_activity_daily enable row level security;
drop policy if exists activity_daily_select on public.employee_activity_daily;
create policy activity_daily_select on public.employee_activity_daily
  for select to authenticated using (public.has_org_access(organization_id));

-- Compute for one org as-of a given date (rolling window from activity_config).
create or replace function public.compute_employee_activity(p_org uuid, p_as_of date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window int := coalesce(
    (select window_working_days from public.activity_config where organization_id = p_org), 7);
  v_start  date := public.add_working_days(p_org, p_as_of, -v_window);
  v_rows   int := 0;
begin
  with ep as (
    select
      e.owner_employee_id as emp,
      count(*)::int as owned,
      count(*) filter (where e.answered_at is not null)::int as answered,
      count(*) filter (where e.sla_minutes is not null)::int as with_sla,
      count(*) filter (where e.within_sla is true)::int as within,
      count(*) filter (where e.closed_at is null)::int as open_owned,
      count(*) filter (
        where e.closed_at is null and e.answered_at is null and e.sla_minutes is not null
          and public.working_minutes_between(p_org, e.opened_at, now()) > e.sla_minutes
      )::int as stale
    from public.ownership_episodes e
    where e.organization_id = p_org
      and e.external_origin = false
      and e.owner_employee_id is not null
      and (e.opened_at at time zone 'Asia/Riyadh')::date >= v_start
    group by e.owner_employee_id
  ),
  scored as (
    select emp, owned, answered, with_sla, within, open_owned, stale,
      case when with_sla = 0 then null else round(100.0 * within / with_sla, 1) end as r,
      case when owned   = 0 then null else least(100, round(100.0 * answered / owned, 1)) end as t,
      case when open_owned = 0 then null else round(100.0 * (1 - stale::numeric / open_owned), 1) end as f
    from ep
  ),
  blended as (
    select *,
      (case when r is null then 0 else 0.55 end
        + case when t is null then 0 else 0.25 end
        + case when f is null then 0 else 0.20 end) as wsum,
      (coalesce(r,0)*0.55 + coalesce(t,0)*0.25 + coalesce(f,0)*0.20) as wval
    from scored
  )
  insert into public.employee_activity_daily (
    organization_id, employee_id, activity_date,
    owned_episodes, answered_episodes, answered_within_sla, episodes_with_sla,
    stale_open, open_owned, actions_count,
    responsiveness, throughput, freshness, activity_pct, confidence, status
  )
  select
    p_org, emp, p_as_of,
    owned, answered, within, with_sla, stale, open_owned, answered,
    r, t, f,
    case when wsum = 0 then null else round(wval / wsum, 1) end as activity_pct,
    case when r is null then 'low' else 'high' end as confidence,
    case
      when wsum = 0 then 'not_instrumented'
      when answered = 0 and owned > 0 then 'idle'
      when round(wval / wsum, 1) >= 55 then 'active'
      else 'at_risk'
    end as status
  from blended
  on conflict (organization_id, employee_id, activity_date) do update
    set owned_episodes = excluded.owned_episodes,
        answered_episodes = excluded.answered_episodes,
        answered_within_sla = excluded.answered_within_sla,
        episodes_with_sla = excluded.episodes_with_sla,
        stale_open = excluded.stale_open,
        open_owned = excluded.open_owned,
        actions_count = excluded.actions_count,
        responsiveness = excluded.responsiveness,
        throughput = excluded.throughput,
        freshness = excluded.freshness,
        activity_pct = excluded.activity_pct,
        confidence = excluded.confidence,
        status = excluded.status,
        computed_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.compute_employee_activity(uuid, date) is
  'Rolls ownership_episodes into employee_activity_daily for one org/day. Idempotent upsert.';

-- All-orgs wrapper for the cron.
create or replace function public.compute_employee_activity_all()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_total int := 0;
begin
  for v_org in select id from public.organizations loop
    v_total := v_total + public.compute_employee_activity(v_org, current_date);
  end loop;
  return v_total;
end;
$$;

-- Daily at 05:45 UTC (after dashboard snapshot 05:30).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'compute-employee-activity') then
    perform cron.schedule(
      'compute-employee-activity',
      '45 5 * * *',
      $cron$ select public.compute_employee_activity_all(); $cron$
    );
  end if;
end$$;

-- Backfill today so the table exists with current data after deploy.
select public.compute_employee_activity_all();
