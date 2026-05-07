-- 0059_tasks_actual_done_date.sql
-- Add a calendar-date completion column distinct from completed_at
-- (timestamptz). Useful for reports and date-only displays where we
-- don't want to expose the exact UTC moment.

alter table public.tasks
  add column if not exists actual_done_date date;

-- Backfill: for any task currently in stage='done' with a completed_at,
-- derive the date in UTC (matches how 0023 computed delay_days).
update public.tasks
   set actual_done_date = (completed_at at time zone 'UTC')::date
 where stage = 'done'
   and completed_at is not null
   and actual_done_date is null;

-- Extend the existing tg_task_stage_history trigger function so that
-- stamping completed_at also stamps actual_done_date (and clearing
-- completed_at clears the date). This keeps a single source of truth
-- for the done-transition.
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

    -- A task created already in 'done' stage: stamp both columns.
    if new.stage = 'done' then
      if new.completed_at is null then
        new.completed_at := now();
      end if;
      if new.actual_done_date is null then
        new.actual_done_date := (new.completed_at at time zone 'UTC')::date;
      end if;
    end if;

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

    -- bookkeeping: stamp completed_at + actual_done_date when entering done
    if new.stage = 'done' and new.completed_at is null then
      new.completed_at := now();
    elsif new.stage <> 'done' and old.stage = 'done' then
      new.completed_at := null;
    end if;

    if new.stage = 'done' and new.actual_done_date is null then
      new.actual_done_date := (coalesce(new.completed_at, now()) at time zone 'UTC')::date;
    elsif new.stage <> 'done' and old.stage = 'done' then
      new.actual_done_date := null;
    end if;
  end if;

  return new;
end;
$$;

comment on column public.tasks.actual_done_date is
  'Calendar date (UTC) the task entered stage=done. Maintained by tg_task_stage_history alongside completed_at. Cleared if the task is reopened.';
