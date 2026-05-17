-- 0120_employee_team_leader.sql
--
-- Sky Light feedback #11 (PR-D): "we need Team Leader and Department Head
-- on employees, like Odoo's hr.employee.parent_id / hr.department.manager_id."
--
-- Department Head already exists as `departments.head_employee_id`, so an
-- employee's department head is derivable from their department — no new
-- column needed for that. Team Leader is the genuinely missing field: a
-- nullable self-FK on employee_profiles, distinct from the existing
-- `manager_employee_id` chain. A cycle-prevention trigger (mirroring the
-- task-deps pattern in migration 0051) keeps the team-leader chain acyclic.

alter table public.employee_profiles
  add column if not exists team_leader_employee_id uuid
    references public.employee_profiles(id) on delete set null;

create index if not exists employee_profiles_team_leader_idx
  on public.employee_profiles(team_leader_employee_id);

-- Reject any assignment that would make an employee their own (transitive)
-- team leader. Walks the team_leader chain upward from the new value.
create or replace function public.assert_employee_team_leader_no_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle boolean;
begin
  if new.team_leader_employee_id is null then
    return new;
  end if;
  if new.team_leader_employee_id = new.id then
    raise exception 'employee cannot be their own team leader'
      using errcode = '23514';
  end if;
  with recursive chain(emp_id) as (
    select new.team_leader_employee_id
    union all
    select e.team_leader_employee_id
    from employee_profiles e
    join chain c on c.emp_id = e.id
    where e.team_leader_employee_id is not null
  )
  select exists(select 1 from chain where emp_id = new.id) into v_cycle;
  if v_cycle then
    raise exception 'team leader assignment would create a cycle'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employee_team_leader_no_cycle
  on public.employee_profiles;
create trigger trg_employee_team_leader_no_cycle
  before insert or update of team_leader_employee_id
  on public.employee_profiles
  for each row execute function public.assert_employee_team_leader_no_cycle();
