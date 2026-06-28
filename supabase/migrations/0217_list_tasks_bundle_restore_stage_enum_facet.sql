-- 0217: restore the 0212 stage-enum facet match that migration 0215 accidentally
-- reverted.
--
-- 0215 recreated list_tasks_bundle from the 0205 body to change the
-- p_critical_delay predicate — but 0205 predates 0212, so copying it dropped
-- 0212's `or t.stage::text = (f->>'value')` line from the stage search-facet.
-- That silently re-broke every dashboard drill-down that passes a raw stage enum
-- via sf=[{field:'stage',value:'<enum>'}] (top-revised, stage-flow-matrix,
-- delivery-flow, workflow-indicators) → 0 rows / empty pages again.
--
-- This recreates the function with BOTH fixes: the 0215 critical-delay predicate
-- AND the 0212 stage facet matching the Arabic label ILIKE OR the raw enum.
-- Idempotent create-or-replace; signature unchanged.

create or replace function public.list_tasks_bundle(
  p_org_id uuid,
  p_limit integer default 200,
  p_offset integer default 0,
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
  p_date_filters jsonb default null,
  p_has_start_date boolean default false,
  p_has_end_date boolean default false,
  p_no_deadline boolean default false,
  p_unassigned boolean default false,
  p_over_timesheets boolean default false,
  p_near_timesheets boolean default false,
  p_archived boolean default false,
  p_include_archived boolean default false,
  p_search_facets jsonb default null,
  p_task_ids uuid[] default null,
  -- Balanced kanban load: bucket the paged window by this dimension (whitelisted
  -- enum below) and keep the newest `p_partition_limit` per bucket. Null = flat.
  p_partition_by text default null,
  p_partition_limit integer default 40
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_today date := current_date;
  v_result jsonb;
  v_search_query tsquery := null;
begin
  if v_search is not null then
    begin
      v_search_query := websearch_to_tsquery('arabic', v_search);
    exception when others then
      v_search_query := null;
    end;
  end if;

  with filtered as (
    select t.id, t.created_at, t.stage
    from tasks t
    where t.organization_id = p_org_id
      and (
        p_task_ids is null
        or t.id = any(p_task_ids)
      )
      and (
        p_include_archived
        or (p_archived and t.archived_at is not null)
        or (not p_archived and t.archived_at is null)
      )
      and (p_status is null or cardinality(p_status) = 0 or t.status = any(p_status))
      and (p_stage is null  or cardinality(p_stage)  = 0 or t.stage::text = any(p_stage))
      and (p_priority is null or cardinality(p_priority) = 0 or t.priority = any(p_priority))
      and (p_project_id is null or t.project_id = p_project_id)
      and (not p_overdue or t.is_overdue = true)
      and (not p_due_today or (t.stage::text <> 'done' and t.planned_date = v_today))
      and (not p_behind_schedule or (t.stage::text <> 'done' and t.progress_slip_percent > 5))
      and (not p_ahead_schedule  or (t.stage::text <> 'done' and t.progress_slip_percent < -5))
      and (not p_critical_delay  or (t.stage::text <> 'done' and t.is_overdue and t.stage_entered_at < now() - interval '14 days'))
      and (
        p_progress_buckets is null
        or cardinality(p_progress_buckets) = 0
        or cardinality(p_progress_buckets) >= 3
        or ('not_started' = any(p_progress_buckets) and t.progress_percent = 0)
        or ('in_progress' = any(p_progress_buckets) and t.progress_percent > 0 and t.progress_percent < 100)
        or ('completed'   = any(p_progress_buckets) and t.progress_percent = 100)
      )
      and (not p_starred or t.priority in ('urgent', 'high'))
      and (not p_has_start_date or t.planned_date is not null)
      and (not p_has_end_date   or t.due_date is not null)
      and (
        not p_no_deadline
        or (t.planned_date is null and t.due_date is null)
      )
      and (
        not p_unassigned
        or not exists (
          select 1 from task_assignees ta where ta.task_id = t.id
        )
      )
      and (
        not p_over_timesheets
        or (
          t.allocated_time_minutes is not null
          and t.allocated_time_minutes > 0
          and (
            coalesce(
              (select sum(ts.hours) from task_timesheets ts where ts.task_id = t.id),
              0
            ) * 60.0
          ) > t.allocated_time_minutes
        )
      )
      and (
        not p_near_timesheets
        or (
          t.allocated_time_minutes is not null
          and t.allocated_time_minutes > 0
          and (
            coalesce(
              (select sum(ts.hours) from task_timesheets ts where ts.task_id = t.id),
              0
            ) * 60.0
          ) >= (0.8 * t.allocated_time_minutes)
          and (
            coalesce(
              (select sum(ts.hours) from task_timesheets ts where ts.task_id = t.id),
              0
            ) * 60.0
          ) < t.allocated_time_minutes
        )
      )
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
        p_search_facets is null or jsonb_array_length(p_search_facets) = 0
        or (
          (
            not exists (select 1 from jsonb_array_elements(p_search_facets) f where f->>'field' = 'title')
            or exists (
              select 1 from jsonb_array_elements(p_search_facets) f
              where f->>'field' = 'title'
                and t.title ilike '%' || (f->>'value') || '%'
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_search_facets) f where f->>'field' = 'tags')
            or exists (
              select 1 from jsonb_array_elements(p_search_facets) f
              where f->>'field' = 'tags'
                and exists (
                  select 1 from project_tag_assignments pta
                  join project_tags pt on pt.id = pta.tag_id
                  where pta.project_id = t.project_id
                    and pt.name ilike '%' || (f->>'value') || '%'
                )
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_search_facets) f where f->>'field' = 'assignee')
            or exists (
              select 1 from jsonb_array_elements(p_search_facets) f
              where f->>'field' = 'assignee'
                and exists (
                  select 1 from task_assignees ta
                  join employee_profiles e on e.id = ta.employee_id
                  where ta.task_id = t.id
                    and e.full_name ilike '%' || (f->>'value') || '%'
                )
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_search_facets) f where f->>'field' = 'project')
            or exists (
              select 1 from jsonb_array_elements(p_search_facets) f
              where f->>'field' = 'project'
                and exists (
                  select 1 from projects p2
                  where p2.id = t.project_id
                    and (
                      p2.name ilike '%' || (f->>'value') || '%'
                      or coalesce(p2.store_name, '') ilike '%' || (f->>'value') || '%'
                    )
                )
            )
          )
          and (
            not exists (select 1 from jsonb_array_elements(p_search_facets) f where f->>'field' = 'stage')
            or exists (
              select 1 from jsonb_array_elements(p_search_facets) f
              where f->>'field' = 'stage'
                and (
                  -- Match either the localized (Arabic) stage label typed in the
                  -- SmartSearchBar, OR the raw enum value passed by the executive
                  -- dashboard drill-down links (locale-independent). 0212 logic,
                  -- restored after 0215 dropped it.
                  (case t.stage::text
                  when 'new'               then 'جديدة'
                  when 'in_progress'       then 'قيد التنفيذ'
                  when 'manager_review'    then 'مراجعة المدير'
                  when 'specialist_review' then 'مراجعة المتخصص'
                  when 'ready_to_send'     then 'جاهزة للإرسال'
                  when 'sent_to_client'    then 'أُرسلت للعميل'
                  when 'client_changes'    then 'تعديلات العميل'
                  when 'done'              then 'مكتملة'
                  else t.stage::text
                  end) ilike '%' || (f->>'value') || '%'
                  or t.stage::text = (f->>'value')
                )
            )
          )
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
            not exists (select 1 from jsonb_array_elements(p_date_filters) f where f->>'field' = 'planned_date')
            or exists (
              select 1 from jsonb_array_elements(p_date_filters) f
              where f->>'field' = 'planned_date'
                and t.planned_date >= (f->>'from')::date
                and t.planned_date <  (f->>'to')::date
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
  ),
  paged as (
    -- When p_partition_by is null/unknown the partition key is a constant, so
    -- the window degrades to a single global ordering → identical to the old
    -- flat "newest p_limit" behavior. When set, rn restarts per bucket so each
    -- column keeps its own newest p_partition_limit. The whitelist switch means
    -- the caller value only selects a branch, never gets interpolated (no
    -- injection). Multi-valued (assignee/tags) and client-tz date group-bys are
    -- intentionally absent — callers pass null for those and get a flat load.
    select w.id, w.created_at
    from (
      select
        f.id,
        f.created_at,
        row_number() over (
          partition by case p_partition_by
            when 'stage' then t.stage::text
            when 'priority' then coalesce(t.priority::text, '__none__')
            when 'status' then coalesce(t.status::text, '__none__')
            when 'service' then coalesce(t.service_id::text, '__none__')
            when 'project' then coalesce(t.project_id::text, '__none__')
            when 'customer' then coalesce(p.client_id::text, '__none__')
            when 'progress' then case
              when t.progress_percent is null then '__none__'
              when t.progress_percent <= 0 then 'not_started'
              when t.progress_percent >= 100 then 'completed'
              else 'in_progress'
            end
            else '__all__'
          end
          order by f.created_at desc, f.id desc
        ) as rn
      from filtered f
      join tasks t on t.id = f.id
      left join projects p on p.id = t.project_id
    ) w
    where p_partition_by is null
      or p_partition_by not in (
        'stage', 'priority', 'status', 'service', 'project', 'customer', 'progress'
      )
      or w.rn <= greatest(1, coalesce(p_partition_limit, 40))
    order by w.created_at desc, w.id desc
    offset greatest(0, coalesce(p_offset, 0))
    limit greatest(1, least(coalesce(p_limit, 200), 2000))
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
      'current_stage_duration', t.current_stage_duration,
      'task_code', t.task_code,
      'priority', t.priority,
      'due_date', t.due_date,
      'completed_at', t.completed_at,
      'actual_done_date', t.actual_done_date,
      'created_at', t.created_at,
      'project_id', t.project_id,
      'external_source', t.external_source,
      'external_id', t.external_id,
      'sequence', t.sequence,
      'design_count', t.design_count,
      'closed_subtask_count', t.closed_subtask_count,
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
      'tags', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', pt.id, 'name', pt.name, 'color', pt.color)
            order by pt.name
          )
          from project_tag_assignments pta
          join project_tags pt on pt.id = pta.tag_id
          where pta.project_id = t.project_id
        ),
        '[]'::jsonb
      ),
      'task_tags', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', pt.id, 'name', pt.name, 'color', pt.color)
            order by pt.name
          )
          from task_tag_assignments tta
          join project_tags pt on pt.id = tta.tag_id
          where tta.task_id = t.id
        ),
        '[]'::jsonb
      ),
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
    pg.created_at as created_at,
    pg.id as row_id
    from paged pg
    join tasks t on t.id = pg.id
    left join projects p on p.id = t.project_id
    left join clients c on c.id = p.client_id
    left join services s on s.id = t.service_id
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(row_obj order by created_at desc, row_id desc) from rows_jsonb),
      '[]'::jsonb
    ),
    'total_count', (select count(*) from filtered),
    'group_rows', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'stage', t.stage,
            'priority', t.priority,
            'status', t.status,
            'progress_percent', t.progress_percent,
            'planned_date', t.planned_date,
            'due_date', t.due_date,
            'created_at', t.created_at,
            'stage_entered_at', t.stage_entered_at,
            'project', case when p.id is null then null else
              jsonb_build_object('id', p.id, 'name', p.name, 'client_name', c.name)
            end,
            'service', case when s.id is null then null else
              jsonb_build_object('id', s.id, 'name', s.name)
            end,
            'role_slots', coalesce(
              (
                select jsonb_object_agg(
                  x.role_type,
                  jsonb_build_object('id', x.id, 'full_name', x.full_name)
                )
                from (
                  select distinct on (ta.role_type)
                    ta.role_type, e.id, e.full_name
                  from task_assignees ta
                  join employee_profiles e on e.id = ta.employee_id
                  where ta.task_id = t.id
                  order by ta.role_type, e.id
                ) x
              ),
              '{}'::jsonb
            ),
            'tags', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object('id', pt.id, 'name', pt.name)
                  order by pt.name
                )
                from project_tag_assignments pta
                join project_tags pt on pt.id = pta.tag_id
                where pta.project_id = t.project_id
              ),
              '[]'::jsonb
            )
          )
        )
        from filtered f
        join tasks t on t.id = f.id
        left join projects p on p.id = t.project_id
        left join clients c on c.id = p.client_id
        left join services s on s.id = t.service_id
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$function$;
