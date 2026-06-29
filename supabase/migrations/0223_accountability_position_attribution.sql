-- 0223 Position-based accountability attribution
-- =====================================================================
-- Refines 0222. Problem still open: Odoo lumps 5–8 people of DIFFERENT positions
-- (specialist, manager, team_lead, plus actual agents) under role_type='agent',
-- so role-level gating still charged all of them for the agents' execution
-- stages (e.g. غادة, a specialist, blamed for client_changes she didn't own).
--
-- Fix: attribute a task's stage to the assignee whose POSITION matches the
-- template's stage owner. Ownership comes from tasks.stage_owner_positions
-- (backfilled from the team's /task-templates), whose values ARE position
-- roles (specialist/agent/manager/account_manager/team_lead/supporting_*),
-- plus one specific-position key (pos_aef8f95c1e15, a review owner → manager).
--
-- role_type is no longer used for attribution; every assignee is matched by
-- their position.role against the per-stage owner. The scorecard `role` column
-- keeps the 3-value accountability taxonomy (collapsed from position) so the UI
-- and AccountabilityRole type are unchanged.
-- =====================================================================

-- Owner-key (raw template value or canonical fallback) → the positions.role that
-- is accountable. Identity for role-class keys; pos_* review owner → manager.
create or replace function public.accountable_position_for_stage(owners jsonb, stage text)
  returns text
  language sql
  immutable
as $$
  select case
    coalesce(
      owners ->> stage,
      case stage
        when 'new'               then 'specialist'
        when 'in_progress'       then 'agent'
        when 'specialist_review' then 'specialist'
        when 'client_changes'    then 'agent'
        when 'manager_review'    then 'manager'
        when 'ready_to_send'     then 'account_manager'
        when 'sent_to_client'    then 'account_manager'
        else null
      end
    )
    when 'pos_aef8f95c1e15' then 'manager'   -- specific review-owner position
    else coalesce(owners ->> stage,
      case stage
        when 'new'               then 'specialist'
        when 'in_progress'       then 'agent'
        when 'specialist_review' then 'specialist'
        when 'client_changes'    then 'agent'
        when 'manager_review'    then 'manager'
        when 'ready_to_send'     then 'account_manager'
        when 'sent_to_client'    then 'account_manager'
        else null
      end)
  end
$$;

-- Collapse a positions.role to the 3-value accountability role (UI/scoring).
create or replace function public.accountability_role_of_position(position_role text)
  returns text
  language sql
  immutable
as $$
  select case position_role
    when 'specialist'       then 'agent'
    when 'agent'            then 'agent'
    when 'supporting_agent' then 'agent'
    when 'manager'          then 'team_manager'
    when 'team_lead'        then 'team_manager'
    when 'supporting_lead'  then 'team_manager'
    when 'account_manager'  then 'account_manager'
    else null
  end
$$;

create or replace function public.refresh_accountability_scorecard()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
  set statement_timeout to '120s'
as $$
declare
  v_n int;
begin
  delete from public.accountability_scorecard;

  insert into public.accountability_scorecard
    (organization_id, employee_id, role, open_tasks, overdue_owned, avg_dwell,
     sample_size, sla_n, sla_ok, rework_30d, refreshed_at)
  with live as (
    select id, organization_id, is_overdue, stage, stage_owner_positions
      from public.tasks
     where archived_at is null
  ),
  -- One row per (task, assignee) carrying the assignee's POSITION role and the
  -- collapsed accountability role. role_type is ignored — every assignee is a
  -- candidate, matched to stages by position below.
  attrib as (
    select distinct ta.organization_id, ta.task_id, ta.employee_id,
           pos.role as position_role,
           public.accountability_role_of_position(pos.role) as role
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
      join public.employee_profiles e on e.id = ta.employee_id
      join public.positions pos on pos.id = e.position_id
     where public.accountability_role_of_position(pos.role) is not null
  ),
  open_counts as (
    select a.organization_id, a.employee_id, a.role,
           count(distinct a.task_id) filter (
             where lt.stage <> 'done'
               and a.position_role = public.accountable_position_for_stage(lt.stage_owner_positions, lt.stage::text)
           ) as open_tasks,
           count(distinct a.task_id) filter (
             where lt.stage <> 'done' and lt.is_overdue
               and a.position_role = public.accountable_position_for_stage(lt.stage_owner_positions, lt.stage::text)
           ) as overdue_owned
      from attrib a
      join live lt on lt.id = a.task_id
     group by 1, 2, 3
  ),
  intervals as (
    select a.organization_id, a.employee_id, a.role, h.to_stage::text as stage_key, h.exited_at,
           coalesce(d.dwell_business_minutes::numeric,
                    public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min
      from attrib a
      join live lt on lt.id = a.task_id
      join public.task_stage_history h on h.task_id = a.task_id
      left join public.task_stage_dwell d on d.history_id = h.id
     where a.position_role = public.accountable_position_for_stage(lt.stage_owner_positions, h.to_stage::text)
       and h.entered_at >= now() - interval '30 days'
  ),
  measured as (
    select i.organization_id, i.employee_id, i.role,
           avg(i.dwell_min) filter (where i.exited_at is not null) as avg_dwell,
           count(*) filter (where i.exited_at is not null) as sample_size,
           count(*) filter (where s.max_minutes is not null
                              and (i.exited_at is not null or i.dwell_min > s.max_minutes)) as sla_n,
           count(*) filter (where s.max_minutes is not null
                              and i.exited_at is not null
                              and i.dwell_min <= s.max_minutes) as sla_ok,
           count(*) filter (where i.role = 'agent' and i.stage_key = 'client_changes') as rework_30d
      from intervals i
      left join public.sla_rules s
        on s.organization_id = i.organization_id and s.stage_key = i.stage_key
     group by 1, 2, 3
  ),
  keys as (
    select organization_id, employee_id, role from open_counts
    union
    select organization_id, employee_id, role from measured
  )
  select k.organization_id, k.employee_id, k.role,
         coalesce(oc.open_tasks, 0)::int,
         coalesce(oc.overdue_owned, 0)::int,
         m.avg_dwell,
         coalesce(m.sample_size, 0)::int,
         coalesce(m.sla_n, 0)::int,
         coalesce(m.sla_ok, 0)::int,
         coalesce(m.rework_30d, 0)::int,
         now()
    from keys k
    join public.employee_profiles e
      on e.id = k.employee_id and e.organization_id = k.organization_id
    left join open_counts oc
      on oc.organization_id = k.organization_id and oc.employee_id = k.employee_id and oc.role = k.role
    left join measured m
      on m.organization_id = k.organization_id and m.employee_id = k.employee_id and m.role = k.role;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

select public.refresh_accountability_scorecard();
