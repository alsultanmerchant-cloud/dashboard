-- =========================================================================
-- Migration 0163 — TASK STAGE DWELL CACHE (accountability page performance)
-- =========================================================================
-- The /accountability loaders computed business_minutes_between() per
-- (attribution × interval) row at request time — a day-iterating plpgsql
-- function fired 10-20k times per page load, intermittently crossing the
-- 12s agent_run_readonly_sql statement timeout (verified in prod console).
-- This precomputes dwell once per history row into a cache refreshed by
-- pg_cron, so page queries become plain joins. The refresh is incremental:
-- it only recomputes NEW rows, OPEN intervals (their dwell grows with
-- time), and rows whose exited_at changed. The FK cascade handles the
-- Odoo sync's delete-then-insert history rewrites; vanished rows drop
-- automatically and reappear on the next refresh.
-- =========================================================================

create table if not exists public.task_stage_dwell (
  history_id uuid primary key references public.task_stage_history(id) on delete cascade,
  organization_id uuid not null,
  task_id uuid not null,
  stage text not null,
  entered_at timestamptz not null,
  exited_at timestamptz,
  dwell_business_minutes integer not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists idx_task_stage_dwell_org_entered
  on public.task_stage_dwell (organization_id, entered_at desc);
create index if not exists idx_task_stage_dwell_task
  on public.task_stage_dwell (task_id);

alter table public.task_stage_dwell enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'task_stage_dwell'
      and policyname = 'task_stage_dwell_read'
  ) then
    create policy task_stage_dwell_read on public.task_stage_dwell
      for select using (public.has_org_access(organization_id));
  end if;
end $$;

-- Incremental refresh. Default window covers the entire history mirror
-- (oldest row 2025-10): closed intervals are computed once and never again
-- (their dwell can't change), so steady-state cost = open intervals only
-- (~1.8k rows, ~3s). The wide window matters because the reviewer-rigor
-- fallback aggregates unwindowed history.
create or replace function public.refresh_task_stage_dwell(p_window_days int default 730)
returns int
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_n int;
begin
  insert into public.task_stage_dwell
    (history_id, organization_id, task_id, stage, entered_at, exited_at,
     dwell_business_minutes, refreshed_at)
  select h.id, h.organization_id, h.task_id, h.to_stage::text,
         h.entered_at, h.exited_at,
         public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))::int,
         now()
    from public.task_stage_history h
    left join public.task_stage_dwell d on d.history_id = h.id
   where h.entered_at >= now() - make_interval(days => p_window_days)
     and (
       d.history_id is null                          -- not cached yet
       or d.exited_at is null                        -- open interval: dwell keeps growing
       or d.exited_at is distinct from h.exited_at   -- interval changed (re-entry fold)
     )
  on conflict (history_id) do update
    set exited_at = excluded.exited_at,
        dwell_business_minutes = excluded.dwell_business_minutes,
        refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Refresh every 10 minutes — open-interval dwell staleness of ≤10 min is
-- immaterial on a 30-day window metric.
do $$
begin
  perform cron.unschedule('task-stage-dwell-refresh')
  where exists (select 1 from cron.job where jobname = 'task-stage-dwell-refresh');
exception when others then null;
end $$;

select cron.schedule(
  'task-stage-dwell-refresh',
  '*/10 * * * *',
  $$select public.refresh_task_stage_dwell()$$
);

-- Initial fill.
select public.refresh_task_stage_dwell();
