-- 0228 — get_stage_funnel(): server-side per-stage aggregation for the dashboard
-- "مسار التسليم" (delivery pipeline) card.
--
-- Bug it fixes: _getStageFunnel() previously did `.from("tasks").select(...)`
-- with NO limit and counted rows in JS. PostgREST caps a response at
-- ~1000 rows (content-range 0-999/1608), so with >1000 non-archived tasks the
-- per-stage open/overdue counts were computed on a silently-truncated slice
-- (in_progress showed 8/19 instead of the real 15/38, etc.). The dwell query on
-- task_stage_history (24k+ rows) was truncated the same way. Aggregating in SQL
-- removes the cap entirely.
--
-- overdue_count uses the same t.is_overdue column the /tasks `f=overdue` filter
-- (list_tasks_bundle p_overdue) selects on, so the card and its drill-down agree.

create or replace function public.get_stage_funnel(p_org_id uuid)
returns table (
  stage text,
  open_count bigint,
  overdue_count bigint,
  avg_dwell_hours double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with stage_counts as (
    select
      t.stage::text as stage,
      count(*) as open_count,
      count(*) filter (where t.is_overdue) as overdue_count
    from tasks t
    where t.organization_id = p_org_id
      and t.archived_at is null
    group by t.stage
  ),
  dwell as (
    select
      h.to_stage::text as stage,
      avg(h.duration_seconds) / 3600.0 as avg_dwell_hours
    from task_stage_history h
    where h.organization_id = p_org_id
      and h.exited_at is not null
      and h.duration_seconds > 0
    group by h.to_stage
  )
  select
    coalesce(sc.stage, d.stage) as stage,
    coalesce(sc.open_count, 0) as open_count,
    coalesce(sc.overdue_count, 0) as overdue_count,
    coalesce(d.avg_dwell_hours, 0) as avg_dwell_hours
  from stage_counts sc
  full outer join dwell d on d.stage = sc.stage;
$$;

grant execute on function public.get_stage_funnel(uuid) to authenticated, service_role;
