-- 0122_odoo_progress_and_stage_duration.sql
--
-- Sky Light feedback — task cards showed different "Behind %" and "Duration"
-- than Rwasem for the same task.
--
-- Cause 1: `compute_task_progress()` (trigger `trg_tasks_compute_progress`)
-- recomputes `expected_progress_percent` / `progress_slip_percent` from the
-- dashboard's own created_at→planned_date elapsed-time formula, overwriting
-- the values the Odoo importer just wrote. Odoo computes its own
-- `expected_progress` / `progress_slip` from the real engagement timeline, so
-- the two diverge (e.g. 85% here vs 30% in Rwasem). Odoo is the source of
-- truth for synced tasks → the trigger now early-returns for them, keeping
-- the imported values untouched.
--
-- Cause 2: Rwasem's card "Duration" is Odoo's pre-formatted
-- `current_stage_duration` string ("2d 22h 47m"). We never stored it. Add a
-- text column so the importer can mirror it verbatim.

alter table public.tasks
  add column if not exists current_stage_duration text;

create or replace function public.compute_task_progress()
returns trigger
language plpgsql
as $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := now();
  v_expected numeric(6,2);
begin
  -- Odoo is the source of truth for synced tasks: keep the
  -- expected_progress / progress_slip values the importer wrote, do not
  -- recompute them from dashboard-local dates.
  if new.external_source = 'odoo' then
    return new;
  end if;

  -- Cancelled tasks: leave alone, keep both at 0.
  if new.status = 'cancelled' then
    new.expected_progress_percent := 0;
    new.progress_slip_percent := 0;
    return new;
  end if;

  -- Done tasks: actual + expected are both 100, no slip.
  if new.stage = 'done' or new.status = 'done' then
    if coalesce(new.progress_percent, 0) < 100 then
      new.progress_percent := 100;
    end if;
    new.expected_progress_percent := 100;
    new.progress_slip_percent := 0;
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
$function$;
