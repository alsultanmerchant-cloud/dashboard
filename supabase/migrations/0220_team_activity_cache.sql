-- 0218 Team activity cache (نبض الفريق "is the team working now")
-- =====================================================================
-- The live نبض الفريق query (per-agent Rwasem actions over task_stage_history
-- + task_comments) is fast warm (~0.7s) but spikes to 5-6s cold and can cross
-- the 12s agent_run_readonly_sql cap under load → the page error boundary.
-- Mirror the accountability_scorecard (0193) / task_stage_dwell (0163) pattern:
-- precompute per-agent activity into a cache, refreshed by pg_cron, and let the
-- page read a trivial indexed join. 10-min staleness is fine for a "pulse"
-- (the UI shows a "last action from Rwasem" freshness stamp). Status / load /
-- momentum are still derived live in TS from these cached counters.
-- =====================================================================

create table if not exists public.team_activity_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id   uuid not null,
  last_action   timestamptz,  -- most recent stage move OR Log Note
  last_move     timestamptz,
  last_update   timestamptz,  -- most recent Log Note
  actions_today int not null default 0, -- stage moves + Log Notes in last 24h
  actions7      int not null default 0, -- in last 7 days
  actions_prev  int not null default 0, -- in the prior 7 days
  open_wip      int not null default 0,
  stalled       int not null default 0, -- open tasks no stage move in 3+ days
  done7         int not null default 0,
  updates7      int not null default 0, -- Log Notes in last 7 days
  no_update     int not null default 0, -- open tasks no Log Note in 3+ days
  refreshed_at  timestamptz not null default now(),
  primary key (organization_id, employee_id)
);

alter table public.team_activity_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='team_activity_cache'
       and policyname='team_activity_cache_read'
  ) then
    create policy team_activity_cache_read on public.team_activity_cache
      for select using (public.has_org_access(organization_id));
  end if;
end $$;

create or replace function public.refresh_team_activity()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
  set statement_timeout to '120s'
as $$
declare v_n int;
begin
  delete from public.team_activity_cache;

  insert into public.team_activity_cache
    (organization_id, employee_id, last_action, last_move, last_update,
     actions_today, actions7, actions_prev, open_wip, stalled, done7,
     updates7, no_update, refreshed_at)
  with agent_live as (
    select distinct ta.organization_id org, ta.employee_id, ta.task_id, t.stage,
           coalesce(t.actual_done_date, t.completed_at::date) done_date
      from public.task_assignees ta
      join public.tasks t on t.id = ta.task_id
     where ta.role_type = 'agent' and ta.employee_id is not null
       and t.archived_at is null
  ),
  relevant as (select distinct task_id from agent_live),
  tmove as (
    select h.task_id, max(h.entered_at) last_move,
           count(*) filter (where h.entered_at >= now() - interval '24 hours') m_today,
           count(*) filter (where h.entered_at >= now() - interval '7 days') m7,
           count(*) filter (where h.entered_at >= now() - interval '14 days'
                              and h.entered_at <  now() - interval '7 days') mprev
      from public.task_stage_history h
     where h.task_id in (select task_id from relevant)
     group by 1
  ),
  tnote as (
    select c.task_id, max(c.created_at) last_c,
           count(*) filter (where c.created_at >= now() - interval '24 hours') c_today,
           count(*) filter (where c.created_at >= now() - interval '7 days') c7,
           count(*) filter (where c.created_at >= now() - interval '14 days'
                              and c.created_at <  now() - interval '7 days') cprev
      from public.task_comments c
     where c.task_id in (select task_id from relevant)
     group by 1
  ),
  per as (
    select al.org, al.employee_id,
           greatest(max(tm.last_move), max(tn.last_c)) last_action,
           max(tm.last_move) last_move,
           max(tn.last_c) last_update,
           sum(coalesce(tm.m_today,0)) + sum(coalesce(tn.c_today,0)) actions_today,
           sum(coalesce(tm.m7,0)) + sum(coalesce(tn.c7,0)) actions7,
           sum(coalesce(tm.mprev,0)) + sum(coalesce(tn.cprev,0)) actions_prev,
           count(*) filter (where al.stage <> 'done') open_wip,
           count(*) filter (where al.stage <> 'done'
             and (tm.last_move is null or tm.last_move < now() - interval '3 days')) stalled,
           count(*) filter (where al.done_date >= current_date - 7) done7,
           sum(coalesce(tn.c7,0)) updates7,
           count(*) filter (where al.stage <> 'done'
             and (tn.last_c is null or tn.last_c < now() - interval '3 days')) no_update
      from agent_live al
      left join tmove tm on tm.task_id = al.task_id
      left join tnote tn on tn.task_id = al.task_id
     group by al.org, al.employee_id
  )
  select org, employee_id, last_action, last_move, last_update,
         actions_today, actions7, actions_prev, open_wip, stalled, done7,
         updates7, no_update, now()
    from per;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'team-activity-refresh') then
    perform cron.schedule(
      'team-activity-refresh',
      '*/10 * * * *',
      $cron$select public.refresh_team_activity()$cron$
    );
  end if;
end $$;

select public.refresh_team_activity();
