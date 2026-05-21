-- =========================================================================
-- Migration 0135 — Dashboard daily snapshots
-- =========================================================================
-- Stores one row per (organization, day) with the headline KPIs the
-- executive /dashboard needs historical lookups for. Populated by a
-- daily cron job. The hero card's WoW overdue delta reads
-- snapshot for (today - 7 days) instead of trying to reconstruct
-- "was this task overdue 7 days ago" from sparse due_date columns.
--
-- Truth source for overdue is `tasks.is_overdue` (mirrored from Odoo).
-- We snapshot it once per day so we have history.
-- =========================================================================

create table if not exists public.dashboard_daily_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_date date not null,
  overdue_count int not null default 0,
  open_count int not null default 0,
  done_30d_count int not null default 0,
  on_time_30d_count int not null default 0,
  on_time_pct_30d numeric(5,2),
  created_at timestamptz not null default now(),
  primary key (organization_id, snapshot_date)
);

comment on table public.dashboard_daily_snapshots is
  'Daily KPI snapshot per organization. Populated by snapshot_dashboard_daily() cron at ~05:30 UTC. Used for WoW deltas on /dashboard hero card.';

alter table public.dashboard_daily_snapshots enable row level security;

drop policy if exists "dashboard_daily_snapshots_read" on public.dashboard_daily_snapshots;
create policy "dashboard_daily_snapshots_read"
  on public.dashboard_daily_snapshots for select
  using (public.has_org_access(organization_id));

-- Writer: one row per active org for today. Idempotent via upsert so
-- the cron can safely re-run intra-day if it failed earlier.
create or replace function public.snapshot_dashboard_daily()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_inserted int := 0;
begin
  with rollup as (
    select
      t.organization_id,
      count(*) filter (where t.is_overdue and t.archived_at is null and t.stage <> 'done'::public.task_stage)::int as overdue_count,
      count(*) filter (where t.archived_at is null and t.stage <> 'done'::public.task_stage)::int as open_count,
      count(*) filter (
        where t.stage = 'done'::public.task_stage
          and t.completed_at >= (now() - interval '30 days')
          and coalesce(t.due_date, t.planned_date) is not null
      )::int as done_30d,
      count(*) filter (
        where t.stage = 'done'::public.task_stage
          and t.completed_at >= (now() - interval '30 days')
          and coalesce(t.due_date, t.planned_date) is not null
          and (t.completed_at at time zone 'UTC')::date <= coalesce(t.due_date, t.planned_date)
      )::int as on_time_30d
    from public.tasks t
    group by t.organization_id
  )
  insert into public.dashboard_daily_snapshots
    (organization_id, snapshot_date, overdue_count, open_count, done_30d_count, on_time_30d_count, on_time_pct_30d)
  select
    organization_id,
    v_today,
    overdue_count,
    open_count,
    done_30d,
    on_time_30d,
    case when done_30d = 0 then null else round(100.0 * on_time_30d / done_30d, 2) end
  from rollup
  on conflict (organization_id, snapshot_date) do update
    set overdue_count = excluded.overdue_count,
        open_count = excluded.open_count,
        done_30d_count = excluded.done_30d_count,
        on_time_30d_count = excluded.on_time_30d_count,
        on_time_pct_30d = excluded.on_time_pct_30d;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.snapshot_dashboard_daily() is
  'Writes one dashboard_daily_snapshots row per organization for today. Idempotent (upsert). Scheduled via pg_cron at 05:30 UTC, before /dashboard hero cards are read in working hours.';

-- Schedule daily at 05:30 UTC (08:30 KSA) — runs after the Odoo sync
-- so is_overdue reflects today's truth before agency starts work.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'snapshot-dashboard-daily') then
    perform cron.schedule(
      'snapshot-dashboard-daily',
      '30 5 * * *',
      $cron$ select public.snapshot_dashboard_daily(); $cron$
    );
  end if;
end$$;

-- Backfill today's row immediately so the table is non-empty after deploy.
select public.snapshot_dashboard_daily();
