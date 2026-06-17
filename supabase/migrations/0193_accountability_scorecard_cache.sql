-- 0193 Accountability scorecard cache
-- =====================================================================
-- The /accountability scorecard aggregated ~30 days of stage-history per
-- (employee, role) across the WHOLE org in one live statement run through
-- agent_run_readonly_sql, which caps each statement at 12s. On a cold cache
-- the single aggregate spilled to disk (the attribution fan-out materialized
-- ~70k rows including assignees of ~10.5k ARCHIVED tasks) and tripped
-- Postgres statement_timeout 57014 → the page error boundary.
--
-- Fix: precompute the per-(employee, role) rollup into a cache table,
-- refreshed by pg_cron every 10 min — mirroring task_stage_dwell (0163).
-- loadScorecard() now reads the cache (a trivial indexed select) instead of
-- recomputing live. The heavy query still runs, but off the request path and
-- under the cron role's 120s timeout, not the 12s RPC cap.
--
-- The rollup query is the live-filtered rewrite: the live (non-archived)
-- task set is pushed into the attribution CTE so only ~12k assignee rows are
-- processed instead of ~70k (no disk spill). Verified bit-for-bit identical
-- to the previous live output (counts/sums across all 85 rows match).
-- =====================================================================

create table if not exists public.accountability_scorecard (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null,
  role            text not null,            -- agent | account_manager | team_manager
  open_tasks      int  not null default 0,
  overdue_owned   int  not null default 0,
  avg_dwell       numeric,                  -- business minutes, closed intervals; null when unmeasured
  sample_size     int  not null default 0,  -- closed stage intervals in the 30d window
  sla_n           int  not null default 0,  -- SLA-decidable intervals
  sla_ok          int  not null default 0,  -- decidable intervals within their stage SLA
  rework_30d      int  not null default 0,
  refreshed_at    timestamptz not null default now(),
  primary key (organization_id, employee_id, role)
);

alter table public.accountability_scorecard enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'accountability_scorecard'
       and policyname = 'accountability_scorecard_read'
  ) then
    create policy accountability_scorecard_read
      on public.accountability_scorecard
      for select
      using (public.has_org_access(organization_id));
  end if;
end $$;

-- Recompute the whole cache atomically (single function = single txn, so
-- readers see the previous snapshot until commit — never a partial state).
-- Org-agnostic: carries organization_id through every CTE so a future tenant
-- is covered for free. Each component mirrors the verified live semantics.
create or replace function public.refresh_accountability_scorecard()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
  set statement_timeout to '120s'
as $$
declare
  v_n int;
begin
  delete from public.accountability_scorecard;

  insert into public.accountability_scorecard
    (organization_id, employee_id, role, open_tasks, overdue_owned, avg_dwell,
     sample_size, sla_n, sla_ok, rework_30d, refreshed_at)
  with live as (
    select id, organization_id, is_overdue, stage
      from public.tasks
     where archived_at is null
  ),
  attrib as (
    -- one (org, task, employee, role) row per accountable relationship,
    -- restricted to live tasks up front so we never fan out over archived
    -- assignees (the cold-run disk-spill killer).
    select ta.organization_id, ta.task_id, ta.employee_id, 'agent'::text as role
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
     where ta.role_type = 'agent'
    union
    select ta.organization_id, ta.task_id, ta.employee_id, 'account_manager'
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
     where ta.role_type = 'account_manager'
    union
    select ta.organization_id, ta.task_id, ta.team_manager_employee_id, 'team_manager'
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
     where ta.team_manager_employee_id is not null
  ),
  open_counts as (
    select a.organization_id, a.employee_id, a.role,
           count(distinct a.task_id) filter (where lt.stage <> 'done') as open_tasks,
           count(distinct a.task_id) filter (where lt.stage <> 'done' and lt.is_overdue) as overdue_owned
      from attrib a
      join live lt on lt.id = a.task_id
     group by 1, 2, 3
  ),
  intervals as (
    -- dwell from the task_stage_dwell cache (0163); live business_minutes_between
    -- only as fallback for rows rewritten since the last dwell refresh.
    select a.organization_id, a.employee_id, a.role, h.to_stage::text as stage_key, h.exited_at,
           coalesce(d.dwell_business_minutes::numeric,
                    public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min
      from attrib a
      join public.task_stage_history h on h.task_id = a.task_id
      left join public.task_stage_dwell d on d.history_id = h.id
     where (
         (a.role = 'agent' and h.to_stage in ('in_progress', 'client_changes'))
      or (a.role = 'team_manager' and h.to_stage in ('manager_review'))
      or (a.role = 'account_manager' and h.to_stage in ('ready_to_send', 'sent_to_client'))
     )
       and h.entered_at >= now() - interval '30 days'
  ),
  measured as (
    select i.organization_id, i.employee_id, i.role,
           avg(i.dwell_min) filter (where i.exited_at is not null) as avg_dwell,
           count(*) filter (where i.exited_at is not null) as sample_size,
           count(*) filter (where s.max_minutes is not null
                              and (i.exited_at is not null or i.dwell_min > s.max_minutes)) as sla_n,
           count(*) filter (where s.max_minutes is not null
                              and i.exited_at is not null
                              and i.dwell_min <= s.max_minutes) as sla_ok,
           count(*) filter (where i.role = 'agent' and i.stage_key = 'client_changes') as rework_30d
      from intervals i
      left join public.sla_rules s
        on s.organization_id = i.organization_id and s.stage_key = i.stage_key
     group by 1, 2, 3
  ),
  keys as (
    select organization_id, employee_id, role from open_counts
    union
    select organization_id, employee_id, role from measured
  )
  select k.organization_id, k.employee_id, k.role,
         coalesce(oc.open_tasks, 0)::int,
         coalesce(oc.overdue_owned, 0)::int,
         m.avg_dwell,
         coalesce(m.sample_size, 0)::int,
         coalesce(m.sla_n, 0)::int,
         coalesce(m.sla_ok, 0)::int,
         coalesce(m.rework_30d, 0)::int,
         now()
    from keys k
    -- drop attribution rows whose employee no longer exists in this org
    -- (mirrors the inner join the live scorecard query did).
    join public.employee_profiles e
      on e.id = k.employee_id and e.organization_id = k.organization_id
    left join open_counts oc
      on oc.organization_id = k.organization_id and oc.employee_id = k.employee_id and oc.role = k.role
    left join measured m
      on m.organization_id = k.organization_id and m.employee_id = k.employee_id and m.role = k.role;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Refresh every 10 minutes, mirroring task-stage-dwell-refresh.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'accountability-scorecard-refresh') then
    perform cron.schedule(
      'accountability-scorecard-refresh',
      '*/10 * * * *',
      $cron$select public.refresh_accountability_scorecard()$cron$
    );
  end if;
end $$;

-- Populate immediately so the page has data before the first scheduled run.
select public.refresh_accountability_scorecard();
