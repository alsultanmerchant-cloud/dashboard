-- 0013_progress_refresh_cron.sql
--
-- 0012 introduced the trigger that recomputes expected_progress_percent
-- and progress_slip_percent on every write. But "expected" is a function
-- of clock time — so on a quiet day where no task is touched, the values
-- go stale. 0012 conditionally scheduled a pg_cron job to fix this, but
-- pg_cron wasn't installed yet so the DO block no-op'd. Now that
-- pg_cron is on, register the job for real.

-- Idempotent named-function we can also call manually from a server
-- action or an edge function if we ever want a forced refresh.
create or replace function public.refresh_task_progress()
returns integer
language sql
security definer
set search_path = public
as $$
  with bumped as (
    update public.tasks
       set progress_percent = progress_percent
     where status not in ('done', 'cancelled')
       and stage <> 'done'
    returning 1
  )
  select count(*)::int from bumped;
$$;

comment on function public.refresh_task_progress() is
  'Touches every active task to fire trg_tasks_compute_progress. Scheduled '
  'daily via pg_cron and callable on demand. Returns row count.';

-- Schedule (replace any prior version cleanly).
do $outer$
begin
  if exists (select 1 from cron.job where jobname = 'rwasem_refresh_task_progress') then
    perform cron.unschedule('rwasem_refresh_task_progress');
  end if;
  perform cron.schedule(
    'rwasem_refresh_task_progress',
    '5 0 * * *',
    'select public.refresh_task_progress();'
  );
end$outer$;
