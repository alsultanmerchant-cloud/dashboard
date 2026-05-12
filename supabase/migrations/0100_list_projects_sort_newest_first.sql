-- 0100_list_projects_sort_newest_first.sql
--
-- Sky Light feedback §2.4: newly-created projects appear to "show 0 tasks" —
-- root cause was the bundle RPC's sort `external_id desc nulls last` placing
-- dashboard-created projects (external_id=null) at the bottom of the list,
-- below 76 Odoo-imported projects. Users hit the top of the list, saw Odoo
-- projects with unsynced tasks (legitimate 0-task rows), and concluded that
-- their newly-created project was broken.
--
-- Fix: sort by created_at desc. Dashboard-created and Odoo-imported projects
-- intermix by chronology — newest at top regardless of origin. external_id
-- becomes the tiebreaker so the prior ordering is preserved within a single
-- day's Odoo batch.

drop function if exists public.list_projects_page_bundle(
  uuid, int, int, text, boolean, boolean, boolean, boolean, boolean,
  date, date, date, date, uuid, boolean, boolean
);

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
  p_over_timesheets boolean default false
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
      p.external_id,
      p.created_at
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
  ),
  page_ids as (
    select id
    from filtered
    -- Newest first. external_id tiebreaks so a same-day Odoo batch keeps
    -- its prior intra-day order.
    order by created_at desc, external_id desc nulls last
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
      p.created_at,
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
      (
        -- Re-apply ordering to the assembled rows so the aggregate matches
        -- the page_ids order (newest first).
        select jsonb_agg(to_jsonb(pr) order by pr.created_at desc, pr.external_id desc nulls last)
        from page_rows pr
      ),
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
  date, date, date, date, uuid, boolean, boolean
) to authenticated, service_role;
