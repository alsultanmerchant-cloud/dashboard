-- 0113_progress_snaps_to_100_on_done.sql
-- Snap tasks.progress_percent to 100 when the task reaches stage='done' or
-- status='done'. Before this change the trigger left progress_percent alone
-- and only updated expected_progress_percent + progress_slip_percent. The
-- result: a task marked Done without a manual progress edit showed up as
-- "100% slip" red — visually scary and incorrect (Done implies 100%).
--
-- The slip math stays the same; we just guarantee the actual=100 floor when
-- the task is in a done state. Users can still manually set a lower progress
-- BEFORE marking done if they want to record skipped work — but the moment
-- they flip the stage, Done = 100%.

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
  -- Cancelled tasks: leave alone, keep both at 0.
  if new.status = 'cancelled' then
    new.expected_progress_percent := 0;
    new.progress_slip_percent := 0;
    return new;
  end if;

  -- Done tasks: actual + expected are both 100, no slip.
  -- (Previously left progress_percent untouched → produced 100% slip.)
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

-- Backfill: any task currently in stage=done or status=done with
-- progress_percent < 100 should be brought up to 100. The trigger
-- handles future updates; this catches existing rows so the Reports
-- and the task page stop showing red slip badges on completed work.
update public.tasks
set progress_percent = 100
where (stage = 'done' or status = 'done')
  and coalesce(progress_percent, 0) < 100;
