-- 0090_list_tasks_bundle_with_counts.sql
--
-- Adds `design_count` and `closed_subtask_count` to the list_tasks_bundle
-- RPC payload so the new task list columns (#19) can render without a
-- second round-trip. Identical to 0085 except for the two added jsonb keys.

create or replace function public.list_tasks_bundle(
  p_org_id uuid,
  p_limit int default 200,
  p_status text[] default null,
  p_stage text[] default null,
  p_priority text[] default null,
  p_project_id uuid default null,
  p_overdue boolean default false,
  p_due_today boolean default false,
  p_behind_schedule boolean default false,
  p_ahead_schedule boolean default false,
  p_critical_delay boolean default false,
  p_progress_buckets text[] default null,
  p_starred boolean default false,
  p_followed_by_user_id uuid default null,
  p_assigned_to_employee_id uuid default null,
  p_search text default null,
  p_date_filters jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_today date := current_date;
  v_result jsonb;
  v_search_query tsquery := null;
begin
  if v_search is not null then
    v_search_query := websearch_to_tsquery('arabic', v_search);
  end if;

  with filtered as (
    select t.id
    from tasks t
    where t.organization_id = p_org_id
      and (p_status is null or cardinality(p_status) = 0 or t.status = any(p_status))
      and (p_stage is null  or cardinality(p_stage)  = 0 or t.stage::text = any(p_stage))
      and (p_priority is null or cardinality(p_priority) = 0 or t.priority = any(p_priority))
      and (p_project_id is null or t.project_id = p_project_id)
      and (not p_overdue or t.is_overdue = true)
      and (not p_due_today or (t.stage::text <> 'done' and t.planned_date = v_today))
      and (not p_behind_schedule or (t.stage::text <> 'done' and t.progress_slip_percent > 5))
      and (not p_ahead_schedule  or (t.stage::text <> 'done' and t.progress_slip_percent < -5))
      and (not p_critical_delay  or (t.stage::text <> 'done' and t.delay_days > 3))
      and (
        p_progress_buckets is null
        or cardinality(p_progress_buckets) = 0
        or cardinality(p_progress_buckets) >= 3
        or ('not_started' = any(p_progress_buckets) and t.progress_percent = 0)
        or ('in_progress' = any(p_progress_buckets) and t.progress_percent > 0 and t.progress_percent < 100)
        or ('completed'   = any(p_progress_buckets) and t.progress_percent = 100)
      )
      and (not p_starred or t.priority in ('urgent', 'high'))
      and (
        p_followed_by_user_id is null
        or exists (
          select 1 from task_followers tf
          where tf.task_id = t.id and tf.user_id = p_followed_by_user_id
        )
      )
      and (
        p_assigned_to_employee_id is null
        or exists (
          select 1 from task_assignees ta
          where ta.task_id = t.id and ta.employee_id = p_assigned_to_employee_id
        )
      )
      and (
        v_search is null
        or (v_search_query is not null and t.search_tsv @@ v_search_query)
        or exists (
          select 1 from projects p
          where p.id = t.project_id
            and p.organization_id = p_org_id
            and (p.name ilike '%' || v_search || '%' or coalesce(p.store_name, '') ilike '%' || v_search || '%')
        )
      )
      and (
        p_date_filters is null or jsonb_array_length(p_date_filters) = 0
        or (
          (
            not exists (select 1 from jsonb_array_elements(p_date_filters) f where f->>'field' = 'due_date')
            or exists (
              select 1 from jsonb_array_elements(p_date_filters) f
              where f->>'field' = 'due_date'
                and t.due_date >= (f->>'from')::date
                and t.due_date <  (f->>'to')::date
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_date_filters) f where f->>'field' = 'actual_done_date')
            or exists (
              select 1 from jsonb_array_elements(p_date_filters) f
              where f->>'field' = 'actual_done_date'
                and t.actual_done_date >= (f->>'from')::date
                and t.actual_done_date <  (f->>'to')::date
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_date_filters) f where f->>'field' = 'stage_entered_at')
            or exists (
              select 1 from jsonb_array_elements(p_date_filters) f
              where f->>'field' = 'stage_entered_at'
                and t.stage_entered_at >= (f->>'from')::timestamptz
                and t.stage_entered_at <  (f->>'to')::timestamptz
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_date_filters) f where f->>'field' = 'created_at')
            or exists (
              select 1 from jsonb_array_elements(p_date_filters) f
              where f->>'field' = 'created_at'
                and t.created_at >= (f->>'from')::timestamptz
                and t.created_at <  (f->>'to')::timestamptz
            )
          )
        )
      )
    order by t.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ),
  rows_jsonb as (
    select jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'status', t.status,
      'stage', t.stage,
      'stage_entered_at', t.stage_entered_at,
      'planned_date', t.planned_date,
      'progress_percent', t.progress_percent,
      'expected_progress_percent', t.expected_progress_percent,
      'progress_slip_percent', t.progress_slip_percent,
      'allocated_time_minutes', t.allocated_time_minutes,
      'delay_days', t.delay_days,
      'task_code', t.task_code,
      'priority', t.priority,
      'due_date', t.due_date,
      'completed_at', t.completed_at,
      'actual_done_date', t.actual_done_date,
      'created_at', t.created_at,
      'project_id', t.project_id,
      -- #19: Sky Light parity columns
      'design_count', coalesce(t.design_count, 0),
      'closed_subtask_count', coalesce(t.closed_subtask_count, 0),
      'project', case when p.id is null then null else
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'project_code', p.project_code,
          'client', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end
        )
      end,
      'service', case when s.id is null then null else
        jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug)
      end,
      'task_assignees', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'role_type', ta.role_type,
              'employee', jsonb_build_object(
                'id', e.id,
                'full_name', e.full_name,
                'avatar_url', e.avatar_url
              )
            )
            order by ta.role_type
          )
          from task_assignees ta
          join employee_profiles e on e.id = ta.employee_id
          where ta.task_id = t.id
        ),
        '[]'::jsonb
      )
    ) as row_obj,
    t.created_at as created_at
    from filtered fi
    join tasks t on t.id = fi.id
    left join projects p on p.id = t.project_id
    left join clients  c on c.id = p.client_id
    left join services s on s.id = t.service_id
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(row_obj order by created_at desc) from rows_jsonb),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.list_tasks_bundle(
  uuid, int, text[], text[], text[], uuid, boolean, boolean, boolean, boolean,
  boolean, text[], boolean, uuid, uuid, text, jsonb
) to authenticated, service_role;
