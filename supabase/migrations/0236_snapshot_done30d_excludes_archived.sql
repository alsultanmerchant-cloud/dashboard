-- =========================================================================
-- Migration 0236 — CEO brief section 1 ("الشركة بتتحسّن ولا بتسوء؟") false-win fix
-- =========================================================================
-- When a client is LOST, Odoo sets its tasks to active=false and our importer
-- maps that to tasks.archived_at != null. Archiving a churned client's work is a
-- business LOSS, not an operational win.
--
-- snapshot_dashboard_daily() (migration 0135) already excluded archived tasks
-- from overdue_count / open_count, but NOT from done_30d / on_time_30d. So
-- on_time_pct_30d ( = on_time_30d / done_30d ) — a FULL-weight input to the brief
-- verdict (computeVerdict in ceo-brief-signals.ts) — kept crediting deliveries to
-- clients we no longer serve. A churn event therefore read as a performance win.
--
-- Fix: add `archived_at is null` to done_30d / on_time_30d so ALL snapshot metrics
-- are measured over the CURRENT (non-archived) book of work.
--
-- NOTE (intentional divergence): the per-service "delivered" count in
-- getServiceLineHealth and the Executive-Indicators "completed" count DO include
-- archived done tasks — those answer "how much did we deliver?" (a delivery is a
-- delivery). This snapshot answers "is the trend improving?", which must track the
-- retained book only. Different question, different rule — on purpose.
--
-- Idempotent (create or replace; the history recompute + backfill are re-runnable).
-- =========================================================================

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
          and t.archived_at is null
          and t.completed_at >= (now() - interval '30 days')
          and coalesce(t.due_date, t.planned_date) is not null
      )::int as done_30d,
      count(*) filter (
        where t.stage = 'done'::public.task_stage
          and t.archived_at is null
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

-- Recompute the stored done_30d / on_time_30d for the last 45 days (the window the
-- brief reads for its week-over-week and 4-week deltas) under the new definition,
-- so the verdict compares like-for-like instead of new-def-today vs old-def-past —
-- which would otherwise spike a one-time phantom "improving". Uses the current
-- archived set as of each historical snapshot_date (churned clients removed from
-- both sides of every comparison). overdue_count/open_count are left as originally
-- snapshotted (they were already archived-excluded and are point-in-time).
update public.dashboard_daily_snapshots s
set done_30d_count = r.done_30d,
    on_time_30d_count = r.on_time_30d,
    on_time_pct_30d = case when r.done_30d = 0 then null else round(100.0 * r.on_time_30d / r.done_30d, 2) end
from (
  select
    s2.organization_id,
    s2.snapshot_date,
    count(*) filter (
      where t.stage = 'done'::public.task_stage
        and t.archived_at is null
        and (t.completed_at at time zone 'UTC')::date > (s2.snapshot_date - 30)
        and (t.completed_at at time zone 'UTC')::date <= s2.snapshot_date
        and coalesce(t.due_date, t.planned_date) is not null
    )::int as done_30d,
    count(*) filter (
      where t.stage = 'done'::public.task_stage
        and t.archived_at is null
        and (t.completed_at at time zone 'UTC')::date > (s2.snapshot_date - 30)
        and (t.completed_at at time zone 'UTC')::date <= s2.snapshot_date
        and coalesce(t.due_date, t.planned_date) is not null
        and (t.completed_at at time zone 'UTC')::date <= coalesce(t.due_date, t.planned_date)
    )::int as on_time_30d
  from public.dashboard_daily_snapshots s2
  join public.tasks t on t.organization_id = s2.organization_id
  where s2.snapshot_date >= current_date - 45
  group by s2.organization_id, s2.snapshot_date
) r
where s.organization_id = r.organization_id
  and s.snapshot_date = r.snapshot_date;

-- Recompute today's row under the corrected function (overdue/open too).
select public.snapshot_dashboard_daily();
