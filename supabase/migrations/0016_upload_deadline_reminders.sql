-- 0016_upload_deadline_reminders.sql
--
-- Sky Light PDF pages 21-22 require the Specialist to "upload" (rfa3)
-- the task's data into Log Note before the contract Deadline. The lead
-- time depends on the service:
--   media-buying:  writing -2d, design -3d
--   social-media:  per week (W1=2/3, W2=3/4, W3=4/5, stories=4)
--   seo:           content same day, banners -4 / -5
--
-- Migration 0009 already stores those offsets in
--   task_template_items.upload_offset_days_before_deadline
-- and migration 0014 seeded them per the PDF.
--
-- This migration emits reminders every morning so the Specialist sees
-- "you need to upload X today" the moment they open the dashboard.
-- Two windows fire:
--   * upload day:  today  = planned_date - upload_offset
--   * overdue:     today  > planned_date - upload_offset AND stage='new'
--
-- Reminders are idempotent: we use a row in ai_events with a stable
-- payload key per (task, event_type, day) so a re-run on the same day
-- doesn't double-insert.

drop function if exists public.enqueue_upload_deadline_reminders();

create function public.enqueue_upload_deadline_reminders()
returns table (out_event_type text, out_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  -- Working set: tasks that still need an upload, with a known offset.
  return query
  with candidates as (
    select
      t.id              as task_id,
      t.organization_id as org_id,
      t.title           as task_title,
      t.planned_date    as deadline,
      tti.upload_offset_days_before_deadline as offset_days,
      (t.planned_date - tti.upload_offset_days_before_deadline) as upload_due_date,
      ta.employee_id    as specialist_employee,
      ep.user_id        as specialist_user
    from public.tasks t
    join public.task_template_items tti
      on tti.id = t.created_from_template_item_id
    join public.task_assignees ta
      on ta.task_id = t.id and ta.role_type = 'specialist'
    left join public.employee_profiles ep
      on ep.id = ta.employee_id
    where t.stage = 'new'
      and t.status not in ('cancelled', 'done')
      and t.planned_date is not null
      and tti.upload_offset_days_before_deadline is not null
  ),
  -- Classify each candidate.
  classified as (
    select
      task_id, org_id, task_title, deadline, offset_days,
      upload_due_date, specialist_employee, specialist_user,
      case
        when upload_due_date = v_today then 'TASK_UPLOAD_DUE_TODAY'
        when upload_due_date < v_today then 'TASK_UPLOAD_OVERDUE'
        else null
      end as ev_type,
      case
        when upload_due_date < v_today then v_today - upload_due_date
        else 0
      end as days_late
    from candidates
  ),
  -- Drop already-emitted reminders for today (idempotency).
  fresh as (
    select c.*
      from classified c
     where c.ev_type is not null
       and not exists (
         select 1
           from public.ai_events ae
          where ae.entity_type = 'task'
            and ae.entity_id = c.task_id
            and ae.event_type = c.ev_type
            and ae.payload->>'day' = v_today::text
       )
  ),
  ev_inserts as (
    insert into public.ai_events
      (organization_id, event_type, entity_type, entity_id, payload, importance)
    select
      f.org_id, f.ev_type, 'task', f.task_id,
      jsonb_build_object(
        'day', v_today::text,
        'task_title', f.task_title,
        'deadline', f.deadline,
        'upload_offset_days', f.offset_days,
        'days_late', f.days_late,
        'specialist_employee_id', f.specialist_employee
      ),
      case f.ev_type
        when 'TASK_UPLOAD_OVERDUE' then 'high'
        else 'medium'
      end
    from fresh f
    returning event_type
  ),
  notif_inserts as (
    insert into public.notifications
      (organization_id, recipient_user_id, recipient_employee_id,
       type, title, body, entity_type, entity_id)
    select
      f.org_id,
      f.specialist_user,
      f.specialist_employee,
      f.ev_type,
      case f.ev_type
        when 'TASK_UPLOAD_DUE_TODAY' then 'موعد رفع المهمة اليوم'
        else 'تأخر رفع المهمة'
      end,
      case f.ev_type
        when 'TASK_UPLOAD_DUE_TODAY' then
          'يجب رفع بيانات المهمة "' || f.task_title || '" اليوم. الديدلاين: ' ||
          f.deadline::text
        else
          'متأخر ' || f.days_late || ' يوم/أيام عن رفع المهمة "' ||
          f.task_title || '". الديدلاين: ' || f.deadline::text
      end,
      'task', f.task_id
    from fresh f
    where f.specialist_employee is not null
    returning type
  )
  select ae.event_type::text, count(*)::bigint
    from ev_inserts ae
   group by ae.event_type;
end;
$$;

comment on function public.enqueue_upload_deadline_reminders() is
  'Daily cron — fires TASK_UPLOAD_DUE_TODAY when the Specialist upload '
  'window opens, TASK_UPLOAD_OVERDUE for each subsequent day a task is '
  'still in stage=new past its upload date. Idempotent per (task, '
  'event_type, day) via ai_events.payload->>day.';

-- Schedule: 09:00 KSA = 06:00 UTC. Replace any prior version cleanly.
do $outer$
begin
  if exists (select 1 from cron.job where jobname = 'rwasem_upload_deadline_reminders') then
    perform cron.unschedule('rwasem_upload_deadline_reminders');
  end if;
  perform cron.schedule(
    'rwasem_upload_deadline_reminders',
    '0 6 * * *',
    'select public.enqueue_upload_deadline_reminders();'
  );
end$outer$;
