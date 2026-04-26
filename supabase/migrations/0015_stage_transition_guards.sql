-- 0015_stage_transition_guards.sql
--
-- Enforce the role-aware stage-transition rules from the Sky Light
-- operations PDF (pages 3-5). Today the kanban lets anyone drag any
-- card; this trigger rejects illegal moves.
--
-- Allowed graph (from_stage → to_stage : allowed roles on this task):
--   new                → in_progress      : specialist | manager
--   in_progress        → manager_review   : agent | manager
--   manager_review     → specialist_review: manager
--   specialist_review  → ready_to_send    : specialist
--   ready_to_send      → sent_to_client   : account_manager
--   sent_to_client     → client_changes   : account_manager
--   sent_to_client     → done             : account_manager
--   client_changes     → in_progress      : specialist | manager
--   client_changes     → ready_to_send    : specialist
--   client_changes     → done             : account_manager
--
-- Backward moves (e.g. specialist_review → in_progress when rework is
-- needed) are allowed for any assignee on the task. This is the
-- "send it back" escape hatch the team needs in practice.
--
-- Override: users with a global role of owner, admin, or manager
-- (in user_roles + roles by key) can override any guard. This is the
-- "the system can't get permanently stuck" escape hatch.
--
-- The guard intentionally does NOT fire when stage is unchanged or
-- when stage is being set on INSERT. INSERT default is 'new'.

create or replace function public.assert_stage_transition_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_employee uuid;
  v_role_on_task task_role_type;
  v_has_override boolean;
  v_allowed boolean := false;
begin
  -- Service-role / no auth context (e.g. importer): allow.
  if v_user is null then
    return new;
  end if;

  -- Skip when stage is unchanged.
  if old.stage = new.stage then
    return new;
  end if;

  -- Global override: owner/admin/manager app roles can do anything.
  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = v_user
       and ur.organization_id = new.organization_id
       and r.key in ('owner', 'admin', 'manager')
  ) into v_has_override;
  if v_has_override then
    return new;
  end if;

  -- Resolve the actor's employee row in this org.
  select id into v_employee
    from public.employee_profiles
   where user_id = v_user
     and organization_id = new.organization_id;
  if v_employee is null then
    raise exception 'Stage change blocked: actor is not an employee in this organization'
      using errcode = '42501';
  end if;

  -- Pull every role this employee holds on this specific task.
  -- (A single person may hold multiple slots, e.g. specialist + manager
  --  on a small project, so we evaluate against the set.)
  perform 1;

  -- Walk the allow-list. Forward edges only — backward moves fall
  -- through to "any assignee on the task is fine."
  case
    when old.stage = 'new' and new.stage = 'in_progress' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type in ('specialist', 'manager')
      );
    when old.stage = 'in_progress' and new.stage = 'manager_review' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type in ('agent', 'manager')
      );
    when old.stage = 'manager_review' and new.stage = 'specialist_review' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'manager'
      );
    when old.stage = 'specialist_review' and new.stage = 'ready_to_send' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'specialist'
      );
    when old.stage = 'ready_to_send' and new.stage = 'sent_to_client' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'account_manager'
      );
    when old.stage = 'sent_to_client' and new.stage in ('client_changes', 'done') then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'account_manager'
      );
    when old.stage = 'client_changes' and new.stage = 'in_progress' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type in ('specialist', 'manager')
      );
    when old.stage = 'client_changes' and new.stage = 'ready_to_send' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'specialist'
      );
    when old.stage = 'client_changes' and new.stage = 'done' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'account_manager'
      );
    else
      -- Backward / rework: any assigned employee may move it back.
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
      );
  end case;

  if not v_allowed then
    raise exception
      'Stage transition % → % is not allowed for this user on task %',
      old.stage, new.stage, new.id
      using errcode = '42501',
            hint = 'Check that you hold the required task role (specialist / manager / agent / account_manager) for this transition.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_stage_guard on public.tasks;
create trigger trg_tasks_stage_guard
  before update of stage
  on public.tasks
  for each row
  when (old.stage is distinct from new.stage)
  execute function public.assert_stage_transition_allowed();

comment on function public.assert_stage_transition_allowed() is
  'Enforces the Sky Light PDF stage-transition matrix. Bypassed for '
  'service-role connections (auth.uid() is null) and for users with '
  'owner/admin/manager app roles. See migration 0015 header for the '
  'allowed graph.';
