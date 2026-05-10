-- Single-roundtrip RPC for the /projects page. Replaces 5 sequential PostgREST
-- queries (main page + counts + services + members + 3 org-wide counts) with
-- one function call. The filter logic mirrors listProjectsPaged() in
-- src/lib/data/projects.ts.
--
-- Returns: { rows: [...], total: int, totals: { projects, tasks, withManager } }
-- Row shape mirrors the projects-list mapper input — keep this in sync with
-- the ProjectRow / LiveProject mapper there.

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
  p_only_mine_employee_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with filtered as (
  select p.id, p.external_id
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
  order by external_id desc nulls last
  offset greatest(0, (p_page - 1) * p_page_size)
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
  left join project_task_counts tc on tc.project_id = p.id
)
select jsonb_build_object(
  'rows', coalesce(
    (select jsonb_agg(to_jsonb(pr) order by (pr.external_id is null), pr.external_id desc)
     from page_rows pr),
    '[]'::jsonb
  ),
  'total', (select count(*) from filtered),
  'totals', jsonb_build_object(
    'projects', (select count(*) from projects where organization_id = p_org_id),
    'tasks',    (select count(*) from tasks    where organization_id = p_org_id),
    'withManager', (
      select count(*) from projects
      where organization_id = p_org_id
        and project_manager_employee_id is not null
    )
  )
);
$$;

grant execute on function public.list_projects_page_bundle(
  uuid, int, int, text, boolean, boolean, boolean, boolean, boolean,
  date, date, date, date, uuid
) to authenticated, service_role;
