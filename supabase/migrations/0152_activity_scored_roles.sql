-- =========================================================================
-- Migration 0150 — Activity scoring scoped to AGENTS only
-- =========================================================================
-- Business rule (owner directive): the activity/overdue audit holds the
-- EXECUTORS accountable, not the account managers or heads/team-leads. AMs own
-- the late client-facing stages and heads own review, but they are NOT the
-- people we measure for "how many tasks overdue / responsiveness".
--
-- Episodes are still CAPTURED for every role (0147) for context/timeline, but
-- compute_employee_activity only SCORES owner roles in activity_config.scored_roles
-- (default: agent, specialist, supporting_agent). Account_manager + manager
-- (head/team-lead) are excluded from the board.
-- =========================================================================

alter table public.activity_config
  add column if not exists scored_roles text[] not null
    default array['agent','specialist','supporting_agent'];

-- Make sure existing config rows pick up the default explicitly.
update public.activity_config
   set scored_roles = array['agent','specialist','supporting_agent']
 where scored_roles is null;

create or replace function public.compute_employee_activity(p_org uuid, p_as_of date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window int := coalesce(
    (select window_working_days from public.activity_config where organization_id = p_org), 7);
  v_roles text[] := coalesce(
    (select scored_roles from public.activity_config where organization_id = p_org),
    array['agent','specialist','supporting_agent']);
  v_start date := public.add_working_days(p_org, p_as_of, -v_window);
  v_rows  int := 0;
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
      and e.owner_role = any(v_roles)   -- AGENTS ONLY (exclude AM + head)
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

-- Clear stale rows (which may include now-excluded AM/head rows) and recompute.
delete from public.employee_activity_daily where activity_date = current_date;
select public.compute_employee_activity_all();
