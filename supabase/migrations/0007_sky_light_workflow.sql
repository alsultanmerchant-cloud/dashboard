-- 0007_sky_light_workflow.sql
-- Phase 1 of Sky Light customization: Rwasem 8-stage workflow + per-stage history
-- and per-task progress/timing fields.
--
-- Adds:
--   * task_stage enum (the 8 named columns from the manual)
--   * tasks.stage + tasks.stage_entered_at
--   * tasks.planned_date, tasks.allocated_time_minutes,
--     tasks.progress_percent, tasks.expected_progress_percent, tasks.progress_slip_percent
--   * task_stage_history table (audit trail; closes prior row + opens new on transition)
--   * helpers to read delay_days and current-stage duration
--
-- Backfills existing tasks.status -> tasks.stage and seeds an initial history row.
-- Keeps tasks.status for now (deprecated; will drop in a later migration once UI is migrated).

-- =========================================================================
-- 1. Enum: task_stage
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_stage') then
    create type public.task_stage as enum (
      'new',
      'in_progress',
      'manager_review',
      'specialist_review',
      'ready_to_send',
      'sent_to_client',
      'client_changes',
      'done'
    );
  end if;
end$$;

-- =========================================================================
-- 2. tasks: new columns
-- =========================================================================
alter table public.tasks
  add column if not exists stage public.task_stage not null default 'new',
  add column if not exists stage_entered_at timestamptz not null default now(),
  add column if not exists planned_date date,
  add column if not exists allocated_time_minutes integer,
  add column if not exists progress_percent numeric(5,2) not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),
  add column if not exists expected_progress_percent numeric(5,2) not null default 0
    check (expected_progress_percent >= 0 and expected_progress_percent <= 100),
  add column if not exists progress_slip_percent numeric(6,2) not null default 0;

-- planned_date defaults to due_date when missing (preserves existing behavior).
update public.tasks
   set planned_date = due_date
 where planned_date is null
   and due_date is not null;

-- Backfill stage from legacy status.
update public.tasks
   set stage = case status
     when 'todo'        then 'new'::public.task_stage
     when 'in_progress' then 'in_progress'::public.task_stage
     when 'review'      then 'manager_review'::public.task_stage
     when 'blocked'     then 'in_progress'::public.task_stage
     when 'done'        then 'done'::public.task_stage
     when 'cancelled'   then 'done'::public.task_stage
     else 'new'::public.task_stage
   end
 where stage = 'new' and status is not null;

create index if not exists idx_tasks_stage on public.tasks(organization_id, stage);
create index if not exists idx_tasks_planned_date on public.tasks(organization_id, planned_date) where planned_date is not null;

-- =========================================================================
-- 3. task_stage_history
-- =========================================================================
create table if not exists public.task_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  from_stage public.task_stage,
  to_stage public.task_stage not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  duration_seconds integer,
  moved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tsh_org on public.task_stage_history(organization_id);
create index if not exists idx_tsh_task on public.task_stage_history(task_id, entered_at desc);
create index if not exists idx_tsh_open on public.task_stage_history(task_id) where exited_at is null;

alter table public.task_stage_history enable row level security;

create policy "tsh_select"
  on public.task_stage_history for select to authenticated
  using (public.has_org_access(organization_id));
create policy "tsh_write"
  on public.task_stage_history for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- =========================================================================
-- 4. Trigger: on tasks.stage change -> close prior open row + open new one
-- =========================================================================
create or replace function public.tg_task_stage_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_stage_history (organization_id, task_id, from_stage, to_stage, entered_at, moved_by)
    values (new.organization_id, new.id, null, new.stage, new.stage_entered_at, v_actor);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    -- close any open history row for this task
    update public.task_stage_history
       set exited_at = now(),
           duration_seconds = greatest(0, extract(epoch from (now() - entered_at))::int)
     where task_id = new.id
       and exited_at is null;

    -- open a new one
    insert into public.task_stage_history (organization_id, task_id, from_stage, to_stage, entered_at, moved_by)
    values (new.organization_id, new.id, old.stage, new.stage, now(), v_actor);

    new.stage_entered_at := now();

    -- bookkeeping: stamp completed_at when entering done
    if new.stage = 'done' and new.completed_at is null then
      new.completed_at := now();
    elsif new.stage <> 'done' and old.stage = 'done' then
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_stage_history on public.tasks;
create trigger trg_tasks_stage_history
before insert or update of stage on public.tasks
for each row execute function public.tg_task_stage_history();

-- =========================================================================
-- 5. Backfill: seed an initial history row for every existing task
-- =========================================================================
insert into public.task_stage_history (organization_id, task_id, from_stage, to_stage, entered_at, moved_by)
select t.organization_id, t.id, null, t.stage, t.stage_entered_at, t.created_by
  from public.tasks t
 where not exists (
   select 1 from public.task_stage_history h where h.task_id = t.id
 );

-- =========================================================================
-- 6. Helpers
-- =========================================================================

-- Days late vs planned_date. Negative when ahead of schedule. Null when no planned date.
-- Once stage = done, freezes at the actual completion delay.
create or replace function public.task_delay_days(t public.tasks)
returns integer
language sql
stable
as $$
  select case
    when t.planned_date is null then null
    when t.stage = 'done' and t.completed_at is not null
      then (t.completed_at::date - t.planned_date)
    else (current_date - t.planned_date)
  end;
$$;

-- Seconds spent in the current stage so far.
create or replace function public.task_current_stage_seconds(t public.tasks)
returns integer
language sql
stable
as $$
  select greatest(0, extract(epoch from (now() - t.stage_entered_at))::int);
$$;

-- =========================================================================
-- 7. Convenience view (tasks + computed metrics)
-- =========================================================================
create or replace view public.tasks_with_metrics as
select
  t.*,
  public.task_delay_days(t)            as delay_days,
  public.task_current_stage_seconds(t) as current_stage_seconds
from public.tasks t;
