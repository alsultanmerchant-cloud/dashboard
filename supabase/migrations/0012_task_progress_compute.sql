-- 0012_task_progress_compute.sql
--
-- Mirrors the rwasem_project_task_progress Odoo addon's compute logic
-- (skylight_addons-master/addons/17.0/rwasem_project_task_progress/
--  models/project_task.py:90-126) directly in Postgres.
--
-- Formula:
--   start    = tasks.created_at
--   end      = tasks.planned_date at end-of-day  (the contract deadline)
--   if now < start            → expected = 0
--   if now >= end             → expected = 100
--   else                      → expected = (now - start) / (end - start) * 100
--   slip = expected - progress_percent           (positive = behind schedule)
--
-- Stages 'done' force expected to 100 (and slip is recomputed).
-- Stages 'cancelled' leave both fields at 0.
-- Tasks with no planned_date have expected = 0 (we can't compute against
-- an unknown deadline; the dashboard can fall back on `progress_percent`).

create or replace function public.compute_task_progress()
returns trigger
language plpgsql
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := now();
  v_expected numeric(6,2);
begin
  -- Cancelled tasks: leave alone, keep both at 0.
  if new.status = 'cancelled' then
    new.expected_progress_percent := 0;
    new.progress_slip_percent := 0;
    return new;
  end if;

  -- Done tasks: expected is fully complete, slip = 100 - actual.
  if new.stage = 'done' or new.status = 'done' then
    new.expected_progress_percent := 100;
    new.progress_slip_percent := 100 - coalesce(new.progress_percent, 0);
    return new;
  end if;

  -- Need a deadline to compute expected progress.
  if new.planned_date is null then
    new.expected_progress_percent := 0;
    new.progress_slip_percent := 0 - coalesce(new.progress_percent, 0);
    return new;
  end if;

  v_start := coalesce(new.created_at, v_now);
  -- Treat planned_date as end-of-day (23:59:59) — gives the assignee the
  -- full contract day before the task is "expected" to be 100%.
  v_end := (new.planned_date::timestamptz + interval '1 day' - interval '1 second');

  if v_now <= v_start then
    v_expected := 0;
  elsif v_now >= v_end then
    v_expected := 100;
  else
    v_expected := least(
      100,
      greatest(
        0,
        extract(epoch from (v_now - v_start))
          / nullif(extract(epoch from (v_end - v_start)), 0)
          * 100
      )
    );
  end if;

  new.expected_progress_percent := round(v_expected, 2);
  new.progress_slip_percent := round(
    new.expected_progress_percent - coalesce(new.progress_percent, 0),
    2
  );
  return new;
end;
$$;

drop trigger if exists trg_tasks_compute_progress on public.tasks;
create trigger trg_tasks_compute_progress
  before insert or update of
    progress_percent, planned_date, created_at, stage, status
  on public.tasks
  for each row
  execute function public.compute_task_progress();

-- Backfill existing rows (no-op for fresh databases).
update public.tasks
   set progress_percent = progress_percent
 where true;

-- Schedule: a daily refresh keeps `expected_progress_percent` accurate as
-- time advances even if no row is touched. Uses pg_cron if available;
-- callers without pg_cron can hit the same logic from a Vercel cron.
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'rwasem_refresh_task_progress') then
      perform cron.unschedule('rwasem_refresh_task_progress');
    end if;
    perform cron.schedule(
      'rwasem_refresh_task_progress',
      '5 0 * * *',
      $cron$
        update public.tasks
           set progress_percent = progress_percent
         where status not in ('done', 'cancelled')
           and stage <> 'done'
      $cron$
    );
  end if;
end$outer$;
