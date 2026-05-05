-- 0038_stage_guards_governance.sql
-- Replace the stage-transition guard from 0015 with one that matches the
-- governance rules from the Sky Light owner-system MD (Rule 2: each stage
-- has exactly one role allowed to move out of it).
--
-- Deltas from 0015:
--   * new → in_progress: was {specialist, manager}; now {specialist} only.
--   * in_progress → manager_review: was {agent, manager}; now {agent,
--     supporting_agent} (supporting_agent if the task was delegated).
--   * Added manager_review → in_progress (rework): {manager}.
--   * Added specialist_review → manager_review (rework): {specialist}.
--   * client_changes branch: removed the four permissive paths that let
--     specialist/manager/agent advance the card during the revision loop.
--     Per MD section 9, agent NEVER changes stage during Client Changes —
--     agent silently executes via Log Note, then AM moves the card.
--     Only allowed transitions out of client_changes are now:
--       client_changes → ready_to_send : {account_manager}
--       client_changes → done          : {account_manager}
--   * Removed the permissive backward fallback ("any assigned employee
--     can move backward") — it let agents drag cards backward, violating
--     "agent never moves stages."
--   * Override list narrowed from {owner, admin, manager} to {owner, admin}.
--     A global "manager" app role no longer bypasses task-level slot checks;
--     they must hold the manager slot on the specific task. This closes the
--     loophole where any dept manager could move any task they don't own.
--
-- Allowed graph after this migration:
--   new                → in_progress      : specialist
--   in_progress        → manager_review   : agent | supporting_agent
--   manager_review     → specialist_review: manager
--   manager_review     → in_progress      : manager  (rework)
--   specialist_review  → ready_to_send    : specialist
--   specialist_review  → manager_review   : specialist  (rework)
--   ready_to_send      → sent_to_client   : account_manager
--   sent_to_client     → done             : account_manager
--   sent_to_client     → client_changes   : account_manager
--   client_changes     → ready_to_send    : account_manager
--   client_changes     → done             : account_manager
--   any                → cancelled        : owner/admin only (override path)
--
-- Service-role connections (importer, cron, Edge functions) still bypass
-- the guard via the auth.uid() is null check.

create or replace function public.assert_stage_transition_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_employee uuid;
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

  -- Global override: only owner/admin app roles bypass slot checks.
  -- Was {owner, admin, manager} in 0015 — manager removed because it
  -- conflated the global app role with the per-task manager slot.
  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = v_user
       and ur.organization_id = new.organization_id
       and r.key in ('owner', 'admin')
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

  -- Walk the allow-list. No permissive fallback — every transition must
  -- be explicitly listed and the actor must hold the required slot on
  -- this specific task.
  case
    when old.stage = 'new' and new.stage = 'in_progress' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'specialist'
      );
    when old.stage = 'in_progress' and new.stage = 'manager_review' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type in ('agent', 'supporting_agent')
      );
    when old.stage = 'manager_review' and new.stage = 'specialist_review' then
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'manager'
      );
    when old.stage = 'manager_review' and new.stage = 'in_progress' then
      -- Rework: manager kicks task back for re-execution.
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
    when old.stage = 'specialist_review' and new.stage = 'manager_review' then
      -- Rework: specialist kicks task back to manager review.
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
    when old.stage = 'client_changes' and new.stage in ('ready_to_send', 'done') then
      -- Per MD section 9: only AM moves stage during the revision loop.
      -- Agent silently executes via Log Note, never moves the card.
      v_allowed := exists (
        select 1 from public.task_assignees
         where task_id = new.id and employee_id = v_employee
           and role_type = 'account_manager'
      );
    else
      -- Any other transition (including all backward moves not listed
      -- above) is rejected. There is no permissive fallback — closing
      -- the "agent drags backward" loophole from 0015.
      v_allowed := false;
  end case;

  if not v_allowed then
    raise exception
      'Stage transition % → % is not allowed for this user on task %',
      old.stage, new.stage, new.id
      using errcode = '42501',
            hint = 'Check that you hold the required task role slot for this transition. '
                   'Owners/admins can override via the dashboard escalation flow.';
  end if;

  return new;
end;
$$;

comment on function public.assert_stage_transition_allowed() is
  'Sky Light stage-transition guard, governance-tightened. '
  'See 0038 header for the allowed graph and the 0015 → 0038 deltas.';
