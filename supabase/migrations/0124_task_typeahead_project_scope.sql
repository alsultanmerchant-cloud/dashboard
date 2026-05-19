-- 0124_task_typeahead_project_scope.sql
--
-- Search UX (Rwasem parity): when the /tasks view is scoped to one project
-- (?projectId=…) the autocomplete should surface that project's matches in
-- a dedicated "In this project" section, with everything else grouped under
-- "Other projects".
--
-- To support that the typeahead RPC now:
--   1. returns `projectId` on every row so the API can split results, and
--   2. accepts an optional `p_project_id` that FILTERS results to a single
--      project (used for the "In this project" section query).
--
-- The old 3-arg signature is dropped first so the new 4-arg form (the extra
-- param has a default) is unambiguous — existing 3-arg callers keep working.

drop function if exists public.search_tasks_typeahead(uuid, text, int);

create or replace function public.search_tasks_typeahead(
  p_org_id uuid,
  p_query text,
  p_limit int default 8,
  p_project_id uuid default null
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
        'projectId', t.project_id,
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
      and (p_project_id is null or t.project_id = p_project_id)
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

grant execute on function public.search_tasks_typeahead(uuid, text, int, uuid)
  to authenticated, service_role;
