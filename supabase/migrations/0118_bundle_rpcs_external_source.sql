-- 0118_bundle_rpcs_external_source.sql
--
-- Sky Light feedback #3 (PR-F): "origin badge — show whether a row came from
-- Odoo or was created in the dashboard."
--
-- We already store `external_source` on tasks / projects / clients /
-- employee_profiles (migration 0011). The Employees admin list reads it
-- directly via PostgREST, but the Tasks list and Projects card are served by
-- the bundle RPCs (`list_tasks_bundle`, `list_projects_page_bundle`) whose
-- jsonb row payloads did NOT include the column — so the UI had no way to
-- surface origin.
--
-- This migration recreates both bundle RPCs with `external_source` added to
-- their per-row jsonb payload. Signatures are unchanged, so every existing
-- caller keeps working; `create or replace` is sufficient (no parameter list
-- change). Bodies are verbatim from the latest *applied* definitions (0106
-- for tasks, 0114 for projects) with a single new key on the row object.
--
-- CROSS-PR NOTE: PR-C ships migration 0117 which ALSO recreates
-- `list_tasks_bundle` to add a pg_trgm `similarity()` fallback in the search
-- clause. 0118 deliberately does NOT depend on 0117 (pg_trgm may not be
-- enabled) — it rebuilds from the 0106 body so it applies cleanly on its own.
-- When both land, the higher-numbered migration wins on the live DB; PR-C's
-- 0117 must be re-checked to ensure it also carries the `external_source`
-- row key. If 0118 applies last, the trigram fallback is preserved at runtime
-- only if 0117 ran first — the merge owner should confirm ordering.

-- ── list_tasks_bundle — add external_source to the row payload ────────────
-- Same signature as 0106. Only change: the `rows_jsonb` CTE now emits
-- `external_source` from the tasks row.
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
  p_date_filters jsonb default null,
  p_has_start_date boolean default false,
  p_has_end_date boolean default false,
  p_unassigned boolean default false,
  p_over_timesheets boolean default false,
  p_near_timesheets boolean default false,
  p_archived boolean default false,
  p_include_archived boolean default false
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
    begin
      v_search_query := websearch_to_tsquery('arabic', v_search);
    exception when others then
      v_search_query := null;
    end;
  end if;

  with filtered as (
    select t.id
    from tasks t
    where t.organization_id = p_org_id
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
      and (not p_has_start_date or t.planned_date is not null)
      and (not p_has_end_date   or t.due_date is not null)
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
          ) <  t.allocated_time_minutes
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
      'archived_at', t.archived_at,
      'project_id', t.project_id,
      -- PR-F (#3): origin so the UI can render the "أودو" badge.
      'external_source', t.external_source,
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
      'tags', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', pt.id,
              'name', pt.name,
              'color', pt.color
            )
            order by pt.name
          )
          from project_tag_assignments pta
          join project_tags pt on pt.id = pta.tag_id
          where pta.project_id = t.project_id
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
  boolean, text[], boolean, uuid, uuid, text, jsonb, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean
) to authenticated, service_role;

-- ── list_projects_page_bundle — add external_source to the row payload ────
-- Same signature as 0114. Only change: `page_rows` now selects
-- `p.external_source` so the projects card can render the origin badge.
create or replace function public.list_projects_page_bundle(
  p_org_id uuid,
  p_page int default 1,
  p_page_size int default 25,
  p_search text default null,
  p_only_favorites boolean default false,
  p_only_with_manager boolean default false,
  p_only_unassigned boolean default false,
  p_archived boolean default false,
  p_only_with_categories boolean default false,
  p_start_date_from date default null,
  p_start_date_to date default null,
  p_end_date_from date default null,
  p_end_date_to date default null,
  p_only_mine_employee_id uuid default null,
  p_all_categories_archived boolean default false,
  p_over_timesheets boolean default false,
  p_id_whitelist uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offset int := greatest(0, (p_page - 1) * p_page_size);
  v_result jsonb;
begin
  with filtered as (
    select
      p.id,
      p.external_id
    from projects p
    where p.organization_id = p_org_id
      and (
        case
          when p_archived then (p.held_at is not null or p.status = 'archived')
          else p.status is distinct from 'archived'
        end
      )
      and (
        p_search is null
        or p.name ilike '%' || p_search || '%'
        or coalesce(p.store_name, '') ilike '%' || p_search || '%'
      )
      and (not p_only_favorites or p.is_favorite = true)
      and (not p_only_with_manager or p.project_manager_employee_id is not null)
      and (
        not p_only_unassigned
        or (p.project_manager_employee_id is null and p.account_manager_employee_id is null)
      )
      and (p_start_date_from is null or p.start_date >= p_start_date_from)
      and (p_start_date_to is null or p.start_date <= p_start_date_to)
      and (p_end_date_from is null or p.end_date >= p_end_date_from)
      and (p_end_date_to is null or p.end_date <= p_end_date_to)
      and (
        not p_only_with_categories
        or exists (select 1 from project_services ps where ps.project_id = p.id)
      )
      and (
        not p_all_categories_archived
        or not exists (select 1 from project_services ps where ps.project_id = p.id)
      )
      and (
        not p_over_timesheets
        or exists (
          select 1
          from tasks t
          where t.project_id = p.id
            and t.allocated_time_minutes is not null
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
        p_only_mine_employee_id is null
        or p.account_manager_employee_id = p_only_mine_employee_id
        or p.project_manager_employee_id = p_only_mine_employee_id
        or p.social_specialist_id        = p_only_mine_employee_id
        or p.media_specialist_id         = p_only_mine_employee_id
        or p.seo_specialist_id           = p_only_mine_employee_id
        or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.employee_id = p_only_mine_employee_id
        )
      )
      -- Custom-filter pre-applied whitelist. When provided, every other
      -- filter still runs — this just additionally constrains the set.
      and (p_id_whitelist is null or p.id = any(p_id_whitelist))
  ),
  page_ids as (
    select id
    from filtered
    order by external_id desc nulls last
    offset v_offset
    limit p_page_size
  ),
  page_rows as (
    select
      p.id,
      p.name,
      p.description,
      p.color,
      p.is_favorite,
      p.store_name,
      p.target,
      p.last_update_status,
      p.last_update_color,
      p.start_date,
      p.end_date,
      p.external_id,
      -- PR-F (#3): origin so the projects card can render the "أودو" badge.
      p.external_source,
      case when c.id is null then null else
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'address', c.address,
          'external_id', c.external_id
        )
      end as client,
      case when pm_emp.id is null then null else
        jsonb_build_object(
          'id', pm_emp.id,
          'full_name', pm_emp.full_name,
          'external_id', pm_emp.external_id,
          'avatar_url', pm_emp.avatar_url
        )
      end as project_manager,
      case when am_emp.id is null then null else
        jsonb_build_object(
          'id', am_emp.id,
          'full_name', am_emp.full_name,
          'external_id', am_emp.external_id,
          'avatar_url', am_emp.avatar_url
        )
      end as account_manager,
      coalesce(tc.task_count, 0) as task_count,
      coalesce(tc.open_task_count, 0) as open_task_count,
      coalesce(tc.closed_task_count, 0) as closed_task_count,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'name', s.name,
              'external_id', s.external_id
            )
            order by s.name
          )
          from project_services ps
          join services s on s.id = ps.service_id
          where ps.project_id = p.id
        ),
        '[]'::jsonb
      ) as services,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'full_name', e.full_name,
              'avatar_url', e.avatar_url
            )
            order by e.full_name
          )
          from project_members pm
          join employee_profiles e on e.id = pm.employee_id
          where pm.project_id = p.id
        ),
        '[]'::jsonb
      ) as members
    from page_ids pi
    join projects p on p.id = pi.id
    left join clients c on c.id = p.client_id
    left join employee_profiles pm_emp on pm_emp.id = p.project_manager_employee_id
    left join employee_profiles am_emp on am_emp.id = p.account_manager_employee_id
    left join lateral (
      select
        count(*) as task_count,
        count(*) filter (where t.stage <> 'done'::task_stage) as open_task_count,
        count(*) filter (where t.stage =  'done'::task_stage) as closed_task_count
      from tasks t
      where t.project_id = p.id
    ) tc on true
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(pr) order by (pr.external_id is null), pr.external_id desc)
       from page_rows pr),
      '[]'::jsonb
    ),
    'total', (select count(*) from filtered),
    'totals', jsonb_build_object(
      'projects',    (select count(*) from projects where organization_id = p_org_id),
      'tasks',       (select count(*) from tasks    where organization_id = p_org_id),
      'withManager', (
        select count(*) from projects
        where organization_id = p_org_id
          and project_manager_employee_id is not null
      )
    )
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.list_projects_page_bundle(
  uuid, int, int, text, boolean, boolean, boolean, boolean, boolean,
  date, date, date, date, uuid, boolean, boolean, uuid[]
) to authenticated, service_role;
