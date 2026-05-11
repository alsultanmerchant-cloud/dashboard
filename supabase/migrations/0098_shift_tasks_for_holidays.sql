-- 0098_shift_tasks_for_holidays.sql
-- When a holiday day lands inside an active task's [planned_date, due_date]
-- range, push the due_date forward to the next working day. Returns a
-- summary the UI can show as a toast.
--
-- Conventions:
--   • Completed tasks (stage = 'done') are left alone — they happened in
--     real time and shifting their dates retroactively would lie.
--   • Holiday rows already encode the working-calendar — no need to also
--     skip weekends here; add_working_days() handles both.
--   • One holiday day → at most one calendar-day shift per task, computed
--     as add_working_days(org, current_due, 1). Adding two holidays inside
--     the same window shifts the task twice; this matches the user's
--     example (deadline 12 + holiday 11 → deadline 13).

create or replace function public.shift_tasks_for_holidays(
  p_org uuid,
  p_dates date[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
  rec record;
  new_due date;
  affected_tasks int := 0;
  affected_projects int := 0;
  proj_ids uuid[] := '{}';
begin
  if p_dates is null or array_length(p_dates, 1) is null then
    return jsonb_build_object(
      'affected_tasks', 0,
      'affected_projects', 0
    );
  end if;

  foreach d in array p_dates loop
    for rec in
      select id, due_date, project_id
      from public.tasks
      where organization_id = p_org
        and stage <> 'done'
        and due_date is not null
        and planned_date is not null
        and d between planned_date and due_date
    loop
      new_due := public.add_working_days(p_org, rec.due_date, 1);
      update public.tasks
      set due_date = new_due
      where id = rec.id;
      affected_tasks := affected_tasks + 1;
      if rec.project_id is not null and not (rec.project_id = any(proj_ids)) then
        proj_ids := array_append(proj_ids, rec.project_id);
        affected_projects := affected_projects + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'affected_tasks', affected_tasks,
    'affected_projects', affected_projects
  );
end;
$$;
