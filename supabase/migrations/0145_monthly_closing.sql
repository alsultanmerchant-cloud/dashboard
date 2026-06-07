-- =========================================================================
-- Migration 0145 — Monthly closing (الإقفال الشهري) per employee
-- =========================================================================
-- Frozen monthly aggregate per (organization, employee, month) read by the
-- Department-Head dashboard. Mirrors the dashboard_daily_snapshots pattern:
-- a snapshot table + an idempotent populate function + a pg_cron job that
-- closes the previous month on the 1st + an immediate backfill.
--
-- Notes on data sources (see project memory — Odoo-synced gaps):
--   completed_tasks/designs : tasks completed in month (stage='done'),
--                             scoped via task_assignees(role_type='agent').
--   revision_count          : derived from task_stage_history transitions
--                             into 'client_changes' (raw tasks.revision_count
--                             is sparse for synced rows); design_count IS used
--                             directly (populated by sync).
--   target/achievement      : left-joined from employee_targets (NULL → N/A).
-- =========================================================================

create table if not exists public.employee_monthly_closing (
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_profile_id uuid not null references public.employee_profiles(id) on delete cascade,
  department_id       uuid references public.departments(id) on delete set null,
  month               date not null,
  completed_tasks     int not null default 0,
  designs_count       int not null default 0,
  completed_projects  int not null default 0,
  overdue_tasks       int not null default 0,
  revision_count      int not null default 0,
  avg_completion_hours numeric(8,2),
  on_time_pct         numeric(5,2),
  target_completed_tasks int,
  achievement_pct     numeric(6,2),
  created_at          timestamptz not null default now(),
  primary key (organization_id, employee_profile_id, month)
);

comment on table public.employee_monthly_closing is
  'Frozen per-employee monthly closing metrics. Populated by compute_monthly_closing() via pg_cron on the 1st of each month for the prior month.';

create index if not exists idx_monthly_closing_org_month on public.employee_monthly_closing(organization_id, month);
create index if not exists idx_monthly_closing_dept       on public.employee_monthly_closing(department_id, month);

alter table public.employee_monthly_closing enable row level security;

drop policy if exists monthly_closing_select on public.employee_monthly_closing;
create policy monthly_closing_select on public.employee_monthly_closing
  for select to authenticated
  using (public.has_org_access(organization_id));
-- No public write policy: populated only by the security-definer function below.

create or replace function public.compute_monthly_closing(p_month date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_rows  int := 0;
begin
  with done_tasks as (
    select
      t.id,
      t.organization_id,
      ta.employee_id,
      ep.department_id,
      t.project_id,
      t.completed_at,
      t.created_at,
      coalesce(t.design_count, 0) as design_count,
      coalesce(t.due_date, t.planned_date) as planned,
      ( (t.completed_at at time zone 'UTC')::date
          <= coalesce(t.due_date, t.planned_date) ) as on_time
    from public.tasks t
    join public.task_assignees ta
      on ta.task_id = t.id and ta.role_type = 'agent'
    join public.employee_profiles ep
      on ep.id = ta.employee_id
    where t.stage = 'done'::public.task_stage
      and t.completed_at >= v_start
      and t.completed_at <  v_end
  ),
  revisions as (
    select ta.employee_id, count(*)::int as rev
    from public.task_stage_history h
    join public.task_assignees ta
      on ta.task_id = h.task_id and ta.role_type = 'agent'
    where h.to_stage = 'client_changes'::public.task_stage
      and h.entered_at >= v_start
      and h.entered_at <  v_end
    group by ta.employee_id
  ),
  agg as (
    select
      d.organization_id,
      d.employee_id,
      d.department_id,
      count(*)::int as completed_tasks,
      sum(d.design_count)::int as designs_count,
      count(distinct d.project_id)::int as completed_projects,
      count(*) filter (where d.planned is not null and not d.on_time)::int as overdue_tasks,
      count(*) filter (where d.planned is not null)::int as decided,
      count(*) filter (where d.planned is not null and d.on_time)::int as on_time_cnt,
      round(avg(extract(epoch from (d.completed_at - d.created_at)) / 3600.0)
              filter (where d.completed_at >= d.created_at)::numeric, 2) as avg_hours
    from done_tasks d
    group by d.organization_id, d.employee_id, d.department_id
  )
  insert into public.employee_monthly_closing (
    organization_id, employee_profile_id, department_id, month,
    completed_tasks, designs_count, completed_projects, overdue_tasks,
    revision_count, avg_completion_hours, on_time_pct,
    target_completed_tasks, achievement_pct
  )
  select
    a.organization_id,
    a.employee_id,
    a.department_id,
    v_start,
    a.completed_tasks,
    a.designs_count,
    a.completed_projects,
    a.overdue_tasks,
    coalesce(r.rev, 0),
    a.avg_hours,
    case when a.decided = 0 then null else round(100.0 * a.on_time_cnt / a.decided, 2) end,
    et.target_completed_tasks,
    case
      when et.target_completed_tasks is null or et.target_completed_tasks = 0 then null
      else round(100.0 * a.completed_tasks / et.target_completed_tasks, 2)
    end
  from agg a
  left join revisions r on r.employee_id = a.employee_id
  left join public.employee_targets et
    on et.organization_id = a.organization_id
   and et.employee_profile_id = a.employee_id
   and et.month = v_start
  on conflict (organization_id, employee_profile_id, month) do update
    set department_id         = excluded.department_id,
        completed_tasks        = excluded.completed_tasks,
        designs_count          = excluded.designs_count,
        completed_projects     = excluded.completed_projects,
        overdue_tasks          = excluded.overdue_tasks,
        revision_count         = excluded.revision_count,
        avg_completion_hours   = excluded.avg_completion_hours,
        on_time_pct            = excluded.on_time_pct,
        target_completed_tasks = excluded.target_completed_tasks,
        achievement_pct        = excluded.achievement_pct;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.compute_monthly_closing(date) is
  'Upserts employee_monthly_closing rows for the month containing p_month. Idempotent; safe to re-run. Scheduled monthly via pg_cron for the prior month.';

-- Schedule on the 1st of each month at 06:00 UTC for the PRIOR month.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'compute-monthly-closing') then
    perform cron.schedule(
      'compute-monthly-closing',
      '0 6 1 * *',
      $cron$ select public.compute_monthly_closing((date_trunc('month', current_date) - interval '1 day')::date); $cron$
    );
  end if;
end$$;

-- Backfill the current month immediately so the table is non-empty after deploy.
select public.compute_monthly_closing(date_trunc('month', current_date)::date);
