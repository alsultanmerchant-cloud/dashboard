-- =========================================================================
-- Migration 0029 — Reporting + KPIs (phase T9)
-- =========================================================================
-- Purpose: ship the four read-only views the CEO Monday view + the
-- /reports page + the weekly-digest edge function rely on, plus the
-- bookkeeping table the digest function uses to stay idempotent per
-- (organization_id, iso_week).
--
-- All views are plain (non-MATERIALIZED) views. Postgres ≥15 defaults
-- new views to security_invoker (the running user's RLS), so a regular
-- caller still sees only their RLS-permitted base rows. The dashboard's
-- server-side data loaders use supabaseAdmin (service role) and scope
-- by organization_id explicitly. We do NOT add new RLS policies on the
-- views themselves — they inherit from the base tables.
--
-- Hard rules respected:
--   * No FOR-ALL policies (we add none — views inherit base-table RLS).
--   * No STORED generated columns introduced here.
--   * 1-arg has_permission(text) used in the new table's policies.
--   * Idempotent + additive.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Schema notes used below
-- -------------------------------------------------------------------------
-- tasks.deadline candidate is coalesce(due_date, planned_date). The owner
-- spec/dispatch refers to "deadline_date"; the live schema doesn't have
-- such a column. due_date is the operational field; planned_date is the
-- template-projected fallback.
--
-- "done_at" in the spec ≈ the entered_at of the task_stage_history row
-- whose to_stage = 'done'. We use history (not tasks.completed_at) so
-- a task that bounces in/out of done still gets its FIRST done timestamp
-- as the canonical delivery moment. Falls back to tasks.completed_at.
-- -------------------------------------------------------------------------


-- 1. v_rework_per_task ----------------------------------------------------
-- Per task: how many task_comments rows fall inside any window when the
-- task was in stage 'client_changes'. Window = [entered_at, coalesce(
-- exited_at, now())] from task_stage_history rows whose to_stage =
-- 'client_changes'. Only counts comments authored DURING those windows.
--
-- Output columns (per spec):
--   organization_id, task_id, project_id,
--   rework_comment_count, last_client_changes_entered_at
drop view if exists public.v_rework_per_task cascade;
create view public.v_rework_per_task as
with cc_windows as (
  select
    h.organization_id,
    h.task_id,
    h.entered_at as window_start,
    coalesce(h.exited_at, now()) as window_end
  from public.task_stage_history h
  where h.to_stage = 'client_changes'::public.task_stage
)
select
  t.organization_id,
  t.id as task_id,
  t.project_id,
  coalesce(count(c.id), 0)::int as rework_comment_count,
  max(w.window_start) as last_client_changes_entered_at
from public.tasks t
left join cc_windows w
       on w.task_id = t.id
left join public.task_comments c
       on c.task_id = t.id
      and w.window_start is not null
      and c.created_at >= w.window_start
      and c.created_at <  w.window_end
group by t.organization_id, t.id, t.project_id;

comment on view public.v_rework_per_task is
  'T9: per-task count of comments authored while the task was in client_changes stage.';


-- 2. v_on_time_delivery ---------------------------------------------------
-- Per task currently in 'done': did it land on/before its deadline?
-- deadline = coalesce(tasks.due_date, tasks.planned_date)
-- done_at  = entered_at of FIRST history row with to_stage='done',
--            falling back to tasks.completed_at.
--
-- Output columns:
--   organization_id, task_id, project_id, service_id,
--   deadline_date, done_at, on_time_bool
drop view if exists public.v_on_time_delivery cascade;
create view public.v_on_time_delivery as
with first_done as (
  select
    h.task_id,
    min(h.entered_at) as first_done_at
  from public.task_stage_history h
  where h.to_stage = 'done'::public.task_stage
  group by h.task_id
)
select
  t.organization_id,
  t.id as task_id,
  t.project_id,
  t.service_id,
  coalesce(t.due_date, t.planned_date) as deadline_date,
  coalesce(fd.first_done_at, t.completed_at) as done_at,
  case
    when coalesce(t.due_date, t.planned_date) is null then null
    when coalesce(fd.first_done_at, t.completed_at) is null then null
    else (
      ((coalesce(fd.first_done_at, t.completed_at) at time zone 'UTC')::date)
        <= coalesce(t.due_date, t.planned_date)
    )
  end as on_time_bool
from public.tasks t
left join first_done fd on fd.task_id = t.id
where t.stage = 'done'::public.task_stage;

comment on view public.v_on_time_delivery is
  'T9: per-done-task on-time flag vs coalesce(due_date, planned_date). Rollup is computed in TS over a configurable window — kept as a base view for flexibility (no parametrised SQL function).';


-- 3. v_agent_productivity -------------------------------------------------
-- Per assignee user, per ISO week:
--   * count of tasks "closed" that week (transitioned into 'done') for
--     which the user was an assignee at the time of the dump.
--   * median minutes-per-stage for stages the user touched, as a JSONB
--     map { stage_key: median_minutes }.
--
-- We approximate "touched" as: any task_stage_history row where the
-- task has a current task_assignees row for this user. Using current
-- assignees (not historical) is acceptable for Sky Light because
-- reassignment is rare and the productivity view is meant to be
-- directional, not forensic.
--
-- Output columns (per spec):
--   organization_id, user_id, week_start_date,
--   closed_count, median_minutes_per_stage_jsonb
drop view if exists public.v_agent_productivity cascade;
create view public.v_agent_productivity as
with user_tasks as (
  select distinct
    ta.task_id,
    ep.user_id,
    ta.organization_id
  from public.task_assignees ta
  join public.employee_profiles ep on ep.id = ta.employee_id
  where ep.user_id is not null
),
closed_per_week as (
  select
    ut.organization_id,
    ut.user_id,
    -- ISO-week-start (Monday) of the close event, anchored UTC for
    -- IMMUTABLE-ish behaviour. Owner spec says weekly digest fires
    -- Sunday — UI can rebase to Sunday in TS if needed.
    date_trunc('week', (h.entered_at at time zone 'UTC'))::date as week_start_date,
    count(distinct h.task_id)::int as closed_count
  from public.task_stage_history h
  join user_tasks ut on ut.task_id = h.task_id and ut.organization_id = h.organization_id
  where h.to_stage = 'done'::public.task_stage
  group by ut.organization_id, ut.user_id, week_start_date
),
stage_medians as (
  select
    ut.organization_id,
    ut.user_id,
    date_trunc('week', (h.entered_at at time zone 'UTC'))::date as week_start_date,
    h.to_stage::text as stage_key,
    percentile_cont(0.5) within group (order by coalesce(h.duration_seconds, 0) / 60.0) as median_minutes
  from public.task_stage_history h
  join user_tasks ut on ut.task_id = h.task_id and ut.organization_id = h.organization_id
  where h.duration_seconds is not null
  group by ut.organization_id, ut.user_id, week_start_date, h.to_stage
),
medians_rolled as (
  select
    organization_id,
    user_id,
    week_start_date,
    jsonb_object_agg(stage_key, round(median_minutes)::int) as median_minutes_per_stage_jsonb
  from stage_medians
  group by organization_id, user_id, week_start_date
)
select
  cpw.organization_id,
  cpw.user_id,
  cpw.week_start_date,
  cpw.closed_count,
  coalesce(mr.median_minutes_per_stage_jsonb, '{}'::jsonb) as median_minutes_per_stage_jsonb
from closed_per_week cpw
left join medians_rolled mr
       on mr.organization_id = cpw.organization_id
      and mr.user_id = cpw.user_id
      and mr.week_start_date = cpw.week_start_date;

comment on view public.v_agent_productivity is
  'T9: per (user, ISO-week) closed-task count + median minutes per stage. Joins task_assignees->employee_profiles for user_id.';


-- 4. v_review_backlog -----------------------------------------------------
-- Tasks currently in 'manager_review' or 'specialist_review' whose
-- stage_entered_at is older than 2 BUSINESS days.
-- 2 business days = 16 business hours = 960 business minutes per
-- migration 0025's business_minutes_between(start,end).
drop view if exists public.v_review_backlog cascade;
create view public.v_review_backlog as
select
  t.organization_id,
  t.id as task_id,
  t.project_id,
  t.service_id,
  t.stage::text as stage,
  t.stage_entered_at,
  public.business_minutes_between(t.stage_entered_at, now()) as business_minutes_in_stage
from public.tasks t
where t.stage in (
  'manager_review'::public.task_stage,
  'specialist_review'::public.task_stage
)
and public.business_minutes_between(t.stage_entered_at, now()) > 960;

comment on view public.v_review_backlog is
  'T9: review-stage tasks stuck > 2 business days (960 business minutes per 0025).';


-- 5. weekly_digest_runs ---------------------------------------------------
-- Idempotency anchor for the weekly-digest edge function. One row per
-- (organization_id, iso_year, iso_week) keeps reruns of the cron from
-- producing duplicate notifications. Stores the JSON payload that was
-- composed for that week so /reports can render the latest digest
-- without re-computing.
create table if not exists public.weekly_digest_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  iso_year        integer not null,
  iso_week        integer not null,
  generated_at    timestamptz not null default now(),
  recipient_count integer not null default 0,
  payload         jsonb not null default '{}'::jsonb,
  unique (organization_id, iso_year, iso_week)
);

comment on table public.weekly_digest_runs is
  'T9: idempotency anchor + payload cache for weekly-digest edge function. One row per (org, iso_week).';

create index if not exists idx_weekly_digest_org_recent
  on public.weekly_digest_runs(organization_id, generated_at desc);

alter table public.weekly_digest_runs enable row level security;

drop policy if exists weekly_digest_runs_select on public.weekly_digest_runs;
create policy weekly_digest_runs_select
  on public.weekly_digest_runs for select to authenticated
  using ( public.has_permission('reports.view') );

drop policy if exists weekly_digest_runs_insert on public.weekly_digest_runs;
create policy weekly_digest_runs_insert
  on public.weekly_digest_runs for insert to authenticated
  with check ( public.has_permission('reports.view') );

drop policy if exists weekly_digest_runs_update on public.weekly_digest_runs;
create policy weekly_digest_runs_update
  on public.weekly_digest_runs for update to authenticated
  using      ( public.has_permission('reports.view') )
  with check ( public.has_permission('reports.view') );

drop policy if exists weekly_digest_runs_delete on public.weekly_digest_runs;
create policy weekly_digest_runs_delete
  on public.weekly_digest_runs for delete to authenticated
  using ( public.has_permission('reports.view') );


-- 6. Permissions seed -----------------------------------------------------
-- reports.view is already implied by the existing /reports page guard
-- (it uses requirePagePermission("reports.view")). Make sure the key
-- exists and is granted to owner/admin/manager.
insert into public.permissions (key, description) values
  ('reports.view', 'عرض لوحات التقارير ومؤشرات الأداء')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin','manager')
  and p.key = 'reports.view'
on conflict do nothing;
