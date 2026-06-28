-- 0216 Performance snapshots (time-series trend cache)
-- =====================================================================
-- Powers the "قارن بالسابق" employee trend modal and (later) the CEO
-- trends page. The accountability_scorecard cache (0193) holds only the
-- CURRENT 30-day window — it is overwritten every 10 min and carries no
-- history. This table freezes per-period operational metrics so trend
-- surfaces read a tiny indexed table instead of recomputing 8+ historical
-- windows live (which would blow the 12s RPC timeout and kill the
-- animate-on-filter UX).
--
-- Grain: one row per (scope, period). scope = company | department |
-- employee. period = an ISO week (Sunday-start, Saudi) or a calendar
-- month. Metrics mirror the verified 0193 semantics exactly, but the
-- measurement window is the period itself (intervals ENTERED in
-- [period_start, period_end)) rather than "last 30 days".
--
-- Operational-only (v1). on_time_pct is null when no SLA-decidable
-- interval fell in the period (honest N/A, never 0). Company/department
-- rollups exclude leadership (agents-only, mirroring the board); the
-- employee grain includes everyone so the CEO can open any person.
--
-- Full recompute on a daily cron — the whole history is one grouped scan
-- of task_stage_history (~37k rows), trivially under the 120s budget, so
-- no incremental machinery is needed (mirrors refresh_accountability_scorecard).
-- =====================================================================

create table if not exists public.performance_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type   text not null,            -- 'company' | 'department' | 'employee'
  scope_id     uuid not null,            -- employee_id | department_id | (org id for company)
  grain        text not null,            -- 'week' | 'month'
  period_start date not null,            -- inclusive
  period_end   date not null,            -- exclusive
  on_time_pct  numeric,                  -- null when sla_n = 0
  avg_dwell    numeric,                  -- business minutes, closed intervals; null when unmeasured
  completed_count int not null default 0,
  rework_count    int not null default 0,
  sla_n        int not null default 0,   -- SLA-decidable intervals in the period
  sla_ok       int not null default 0,
  sample_size  int not null default 0,   -- closed intervals in the period
  refreshed_at timestamptz not null default now(),
  primary key (organization_id, scope_type, scope_id, grain, period_start)
);

alter table public.performance_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'performance_snapshots'
       and policyname = 'performance_snapshots_read'
  ) then
    create policy performance_snapshots_read
      on public.performance_snapshots
      for select
      using (public.has_org_access(organization_id));
  end if;
end $$;

create index if not exists performance_snapshots_scope_idx
  on public.performance_snapshots (organization_id, scope_type, scope_id, grain, period_start);

-- Recompute the whole trend cache atomically. Single function = single txn,
-- so readers see the prior snapshot until commit (never a partial state).
create or replace function public.refresh_performance_snapshots()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
  set statement_timeout to '120s'
as $$
declare
  v_total int := 0;
  v_n int;
  g record;
begin
  -- Base intervals: every accountable (employee, stage) interval across all
  -- history, with holiday-aware dwell (from the 0163 cache, live fallback)
  -- and the matching SLA rule. Mirrors the 0193 `intervals` CTE minus the
  -- 30-day filter (we bucket by entered_at instead).
  create temp table _iv on commit drop as
  with attrib as (
    select ta.organization_id org, ta.task_id, ta.employee_id emp, 'agent'::text role
      from public.task_assignees ta where ta.role_type = 'agent'
    union
    select ta.organization_id, ta.task_id, ta.employee_id, 'account_manager'
      from public.task_assignees ta where ta.role_type = 'account_manager'
    union
    select ta.organization_id, ta.task_id, ta.team_manager_employee_id, 'team_manager'
      from public.task_assignees ta where ta.team_manager_employee_id is not null
  )
  select a.org, a.emp, h.entered_at::date entered_d, h.to_stage::text stage_key,
         h.exited_at,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) dwell_min,
         s.max_minutes
    from attrib a
    join public.task_stage_history h on h.task_id = a.task_id
    left join public.task_stage_dwell d on d.history_id = h.id
    left join public.sla_rules s on s.organization_id = a.org and s.stage_key = h.to_stage::text
   where (
       (a.role = 'agent' and h.to_stage in ('in_progress','client_changes'))
    or (a.role = 'team_manager' and h.to_stage in ('manager_review'))
    or (a.role = 'account_manager' and h.to_stage in ('ready_to_send','sent_to_client'))
   )
     and a.emp is not null;

  -- Task completions (throughput), attributed to agent assignees.
  create temp table _done on commit drop as
  select ta.organization_id org, ta.employee_id emp,
         coalesce(t.actual_done_date, t.completed_at::date) done_d
    from public.tasks t
    join public.task_assignees ta on ta.task_id = t.id and ta.role_type = 'agent'
   where coalesce(t.actual_done_date, t.completed_at::date) is not null
     and ta.employee_id is not null;

  delete from public.performance_snapshots;

  -- One pass per grain. bucket_start() differs (Sunday-aligned week vs month).
  for g in
    select 'month'::text grain, '1 month'::text step union all
    select 'week', '7 days'
  loop
    execute format($f$
      insert into public.performance_snapshots
        (organization_id, scope_type, scope_id, grain, period_start, period_end,
         on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sla_ok, sample_size)
      with iv as (
        select org, emp,
               case when %1$L = 'month'
                    then date_trunc('month', entered_d)::date
                    else entered_d - extract(dow from entered_d)::int end as bstart,
               exited_at, dwell_min, max_minutes, stage_key
          from _iv
      ),
      dn as (
        select org, emp,
               case when %1$L = 'month'
                    then date_trunc('month', done_d)::date
                    else done_d - extract(dow from done_d)::int end as bstart,
               count(*) done
          from _done group by 1,2,3
      ),
      im as (
        select org, emp, bstart,
               avg(dwell_min) filter (where exited_at is not null) avg_dwell,
               count(*) filter (where exited_at is not null) sample_size,
               count(*) filter (where max_minutes is not null
                                  and (exited_at is not null or dwell_min > max_minutes)) sla_n,
               count(*) filter (where max_minutes is not null
                                  and exited_at is not null and dwell_min <= max_minutes) sla_ok,
               count(*) filter (where stage_key = 'client_changes') rework
          from iv group by 1,2,3
      ),
      k as (
        select org, emp, bstart from im
        union
        select org, emp, bstart from dn
      )
      select k.org, 'employee', k.emp, %1$L, k.bstart, (k.bstart + %2$L::interval)::date,
             case when im.sla_n > 0 then round(im.sla_ok::numeric / im.sla_n * 100) end,
             im.avg_dwell, coalesce(dn.done,0), coalesce(im.rework,0),
             coalesce(im.sla_n,0), coalesce(im.sla_ok,0), coalesce(im.sample_size,0)
        from k
        left join im on im.org=k.org and im.emp=k.emp and im.bstart=k.bstart
        left join dn on dn.org=k.org and dn.emp=k.emp and dn.bstart=k.bstart
        join public.employee_profiles e on e.id = k.emp and e.organization_id = k.org
    $f$, g.grain, g.step);
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- Department rollup (agents-only) from the freshly-inserted employee rows.
    insert into public.performance_snapshots
      (organization_id, scope_type, scope_id, grain, period_start, period_end,
       on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sla_ok, sample_size)
    select ps.organization_id, 'department', e.department_id, g.grain,
           ps.period_start, ps.period_end,
           case when sum(ps.sla_n) > 0 then round(sum(ps.sla_ok)::numeric / sum(ps.sla_n) * 100) end,
           case when sum(ps.sample_size) > 0
                then sum(ps.avg_dwell * ps.sample_size) / sum(ps.sample_size) end,
           sum(ps.completed_count), sum(ps.rework_count),
           sum(ps.sla_n), sum(ps.sla_ok), sum(ps.sample_size)
      from public.performance_snapshots ps
      join public.employee_profiles e on e.id = ps.scope_id and e.organization_id = ps.organization_id
      left join public.positions pp on pp.id = e.position_id
     where ps.scope_type = 'employee' and ps.grain = g.grain
       and e.department_id is not null
       and coalesce(
             (pp.role in ('manager','team_lead','supporting_lead')
              or trim(pp.name) in ('مدير القسم التقني','مدير القسم الرئيسي',
                 'مدير القسم المساند','مدير قسم إدارة المبيعات',
                 'مدير قسم إدارة الحسابات','CSO')), false) = false
     group by ps.organization_id, e.department_id, g.grain, ps.period_start, ps.period_end;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- Company rollup (agents-only).
    insert into public.performance_snapshots
      (organization_id, scope_type, scope_id, grain, period_start, period_end,
       on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sla_ok, sample_size)
    select ps.organization_id, 'company', ps.organization_id, g.grain,
           ps.period_start, ps.period_end,
           case when sum(ps.sla_n) > 0 then round(sum(ps.sla_ok)::numeric / sum(ps.sla_n) * 100) end,
           case when sum(ps.sample_size) > 0
                then sum(ps.avg_dwell * ps.sample_size) / sum(ps.sample_size) end,
           sum(ps.completed_count), sum(ps.rework_count),
           sum(ps.sla_n), sum(ps.sla_ok), sum(ps.sample_size)
      from public.performance_snapshots ps
      join public.employee_profiles e on e.id = ps.scope_id and e.organization_id = ps.organization_id
      left join public.positions pp on pp.id = e.position_id
     where ps.scope_type = 'employee' and ps.grain = g.grain
       and coalesce(
             (pp.role in ('manager','team_lead','supporting_lead')
              or trim(pp.name) in ('مدير القسم التقني','مدير القسم الرئيسي',
                 'مدير القسم المساند','مدير قسم إدارة المبيعات',
                 'مدير قسم إدارة الحسابات','CSO')), false) = false
     group by ps.organization_id, g.grain, ps.period_start, ps.period_end;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end loop;

  return v_total;
end;
$$;

-- Daily full recompute at 05:30 UTC (before the 06:00 overdue cron).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'performance-snapshots-refresh') then
    perform cron.schedule(
      'performance-snapshots-refresh',
      '30 5 * * *',
      $cron$select public.refresh_performance_snapshots()$cron$
    );
  end if;
end $$;

-- Populate immediately.
select public.refresh_performance_snapshots();
