-- 0117_task_search_trgm_fallback.sql
--
-- Sky Light feedback #5 (PR-C): "search needs to be flexible like Rwasem so
-- I can find a task fast by typing its name."
--
-- Odoo's built-in search matches substrings (ilike) AND ranks by relevance;
-- our migration 0061 added an `arabic` tsvector but `websearch_to_tsquery`
-- only matches WHOLE lexemes, so a 1-2 character fragment or a partial word
-- ("تصم" for "تصميم") returns nothing. This migration adds a `pg_trgm`
-- similarity fallback so short / partial inputs still find the task.
--
-- Two pieces:
--   1. enable pg_trgm + a GIN trigram index on tasks.title.
--   2. a `search_tasks_typeahead` RPC for the debounced autocomplete that
--      returns task rows (the old suggestion endpoint only searched
--      projects, so typing a task name never surfaced the task itself).
--   3. rebuild list_tasks_bundle so the visible search input also matches
--      via trigram similarity for short queries — same signature, body is
--      the 0106 body with one extended search clause.

create extension if not exists pg_trgm;

-- Trigram index supports both ILIKE substring scans and similarity().
create index if not exists tasks_title_trgm_idx
  on public.tasks using gin (title gin_trgm_ops);

-- ── Typeahead RPC ─────────────────────────────────────────────────────────
-- Forgiving task lookup for the search-bar autocomplete. Strategy mirrors
-- Odoo's name_search: substring match first (ilike), then ranked by trigram
-- similarity so the closest title floats to the top. The arabic tsvector is
-- folded in as an OR so whole-word matches in the description body still
-- surface. Archived tasks are excluded (Odoo hides active=false by default).
create or replace function public.search_tasks_typeahead(
  p_org_id uuid,
  p_query text,
  p_limit int default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_tsquery tsquery := null;
  v_result jsonb;
begin
  if v_query is null then
    return '[]'::jsonb;
  end if;

  -- websearch_to_tsquery can raise on odd input; guard it.
  begin
    v_tsquery := websearch_to_tsquery('arabic', v_query);
  exception when others then
    v_tsquery := null;
  end;

  select coalesce(jsonb_agg(row_obj order by rank desc, created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'taskCode', t.task_code,
        'stage', t.stage,
        'projectName', p.name,
        'clientName', c.name
      ) as row_obj,
      greatest(
        similarity(t.title, v_query),
        case when t.title ilike '%' || v_query || '%' then 0.9 else 0 end,
        case when v_tsquery is not null and t.search_tsv @@ v_tsquery then 0.8 else 0 end
      ) as rank,
      t.created_at as created_at
    from tasks t
    left join projects p on p.id = t.project_id
    left join clients  c on c.id = p.client_id
    where t.organization_id = p_org_id
      and t.archived_at is null
      and (
        t.title ilike '%' || v_query || '%'
        or (v_tsquery is not null and t.search_tsv @@ v_tsquery)
        or similarity(t.title, v_query) > 0.15
      )
    order by rank desc, created_at desc
    limit greatest(1, least(coalesce(p_limit, 8), 20))
  ) ranked;

  return v_result;
end;
$$;

grant execute on function public.search_tasks_typeahead(uuid, text, int)
  to authenticated, service_role;

-- ── list_tasks_bundle — add trigram fallback to the search clause ─────────
-- Same signature as 0106. The only change vs. 0106 is the `v_search` clause:
-- it now also matches tasks whose title is trigram-similar to the query, so
-- short / partial inputs from the visible search box still return results.
drop function if exists public.list_tasks_bundle(
  uuid, int, text[], text[], text[], uuid, boolean, boolean, boolean, boolean,
  boolean, text[], boolean, uuid, uuid, text, jsonb, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean
);

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
      -- Forgiving search: arabic tsvector (whole-word) OR substring match on
      -- the title OR trigram similarity (catches 1-2 char / partial inputs
      -- the tsvector misses) OR a match on the parent project name/store.
      and (
        v_search is null
        or (v_search_query is not null and t.search_tsv @@ v_search_query)
        or t.title ilike '%' || v_search || '%'
        or similarity(t.title, v_search) > 0.15
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
