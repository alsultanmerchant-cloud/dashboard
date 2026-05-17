-- 0119_project_task_count_excludes_archived.sql
--
-- Sky Light feedback #4 (PR-B): "the project card task count includes
-- archived tasks — PRJ-01587 shows 177 when only 28 are live."
--
-- Stock Odoo's `project.task_count` counts only `active = True` tasks; our
-- `list_projects_page_bundle` lateral `tc` subquery counted every task on
-- the project, archived or not. This migration recreates the RPC (same
-- signature as 0118) with one change: the `tc` per-card task counts and the
-- org-wide `totals.tasks` KPI now exclude `archived_at is not null` tasks.

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
        -- #4: mirror stock Odoo `active = True` — archived tasks do not count.
        and t.archived_at is null
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
      'tasks',       (
        select count(*) from tasks
        where organization_id = p_org_id
          and archived_at is null
      ),
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
