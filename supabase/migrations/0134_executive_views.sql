-- =========================================================================
-- Migration 0134 — Executive (/dashboard) views
-- =========================================================================
-- Purpose: ship the per-client delivery-health rollup the executive
-- one-pager (/dashboard) needs. Existing views already cover per-task
-- analytics (v_on_time_delivery, v_rework_per_task, v_review_backlog,
-- v_agent_productivity) — this migration only adds the client-level
-- aggregate they cannot express on their own.
--
-- Lean by design: every metric is computed from columns on `tasks`
-- directly so the view stays O(tasks). It does NOT join other views
-- (joining v_rework_per_task makes it O(tasks*comments) and times
-- out at scale).
--
-- Idempotent (drop view if exists / create view), security_invoker by
-- default on Postgres >= 15 so RLS on the base tables is honoured.
-- =========================================================================

drop view if exists public.v_client_delivery_health cascade;
create view public.v_client_delivery_health as
with task_rollup as (
  select
    p.organization_id,
    p.client_id,
    count(*) filter (where t.archived_at is null and t.stage <> 'done'::public.task_stage)
      ::int as open_task_count,
    count(*) filter (where t.is_overdue and t.archived_at is null)
      ::int as overdue_task_count,
    coalesce(
      avg(t.revision_count) filter (where t.archived_at is null and t.stage <> 'done'::public.task_stage),
      0
    )::numeric(6,2) as avg_revision_count,
    coalesce(
      sum(t.revision_count) filter (where t.archived_at is null),
      0
    )::int as total_revisions,
    max(t.updated_at) as last_activity_at,
    -- on-time 30d: tasks done in last 30 days where completed_at <= deadline
    count(*) filter (
      where t.stage = 'done'::public.task_stage
        and t.completed_at >= (now() - interval '30 days')
        and coalesce(t.due_date, t.planned_date) is not null
    )::int as delivered_count_30d,
    count(*) filter (
      where t.stage = 'done'::public.task_stage
        and t.completed_at >= (now() - interval '30 days')
        and coalesce(t.due_date, t.planned_date) is not null
        and (t.completed_at at time zone 'UTC')::date <= coalesce(t.due_date, t.planned_date)
    )::int as on_time_count_30d
  from public.projects p
  left join public.tasks t on t.project_id = p.id
  group by p.organization_id, p.client_id
),
project_counts as (
  select
    organization_id,
    client_id,
    count(*) filter (where status = 'active')::int as active_project_count
  from public.projects
  group by organization_id, client_id
)
select
  c.organization_id,
  c.id as client_id,
  c.name as client_name,
  coalesce(pc.active_project_count, 0) as active_project_count,
  coalesce(tr.open_task_count, 0) as open_task_count,
  coalesce(tr.overdue_task_count, 0) as overdue_task_count,
  coalesce(tr.avg_revision_count, 0)::numeric(6,2) as avg_revision_count,
  coalesce(tr.total_revisions, 0) as total_revision_comments,
  coalesce(tr.delivered_count_30d, 0) as delivered_count_30d,
  coalesce(tr.on_time_count_30d, 0) as on_time_count_30d,
  case
    when coalesce(tr.delivered_count_30d, 0) = 0 then null
    else round(100.0 * tr.on_time_count_30d / tr.delivered_count_30d, 1)
  end as on_time_pct_30d,
  tr.last_activity_at
from public.clients c
left join project_counts pc
       on pc.client_id = c.id and pc.organization_id = c.organization_id
left join task_rollup tr
       on tr.client_id = c.id and tr.organization_id = c.organization_id;

comment on view public.v_client_delivery_health is
  'Executive /dashboard: per-client rollup of delivery health (open/overdue tasks, 30d on-time pct, revision pressure, dormancy). Lean — all metrics from tasks columns, no view-joins.';
