-- 0075_project_code_skip_existing.sql
-- The auto-counter (org_project_counters.last_seq) advances naively. After
-- the Odoo backfill (migration 0071) some sequence positions are now
-- occupied by manually-created stub projects (PRJ-001/002/082/128/...) so
-- the next-code call sometimes lands on an existing code and the unique
-- constraint blows up. Patch the function to loop until it finds a free
-- slot. Cheap (max ~10 iterations in practice), keeps callers idempotent.
create or replace function public._next_project_code(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
  v_code text;
  v_taken boolean;
  v_iter int := 0;
begin
  loop
    insert into public.org_project_counters as c (organization_id, last_seq)
         values (p_org, 1)
    on conflict (organization_id) do update
         set last_seq = c.last_seq + 1,
             updated_at = now()
    returning c.last_seq into v_seq;
    v_code := 'PRJ-' || lpad(v_seq::text, 3, '0');
    select exists(
      select 1 from public.projects
       where organization_id = p_org and project_code = v_code
    ) into v_taken;
    exit when not v_taken;
    v_iter := v_iter + 1;
    if v_iter > 1000 then
      raise exception 'project_code generator exhausted after 1000 iterations';
    end if;
  end loop;
  return v_code;
end;
$$;

grant execute on function public._next_project_code(uuid) to authenticated;
