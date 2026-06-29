-- 0222 Template-driven accountability: attribute by stage OWNERSHIP, not mere assignment
-- =====================================================================
-- Problem (reported by Sky Light): the scorecard blamed people for tasks they
-- only happen to be ASSIGNED to, not tasks/stages they are RESPONSIBLE for.
-- Odoo tasks carry 5–8 `agent` assignees + an account-manager + team-managers,
-- so a single overdue task at e.g. `sent_to_client` (the account-manager's
-- stage) counted against ~7 people. Measured on the live board: 44 overdue
-- tasks produced 321 (employee, task) blame rows — 7.3 per task.
--
-- Fix: an employee is accountable for a task only at the stages their ROLE
-- OWNS, where ownership comes from the task's `stage_owner_positions` map (the
-- per-stage responsible role the team organises in /task-templates), with a
-- canonical workflow fallback for tasks that carry no map. This is the single
-- source of truth used for BOTH the open board (overdue_owned / open_tasks) and
-- the historical SLA / dwell intervals — so the whole engine is template-driven
-- and consistent.
--
-- Net effect on the same 44 overdue tasks: 321 → 162 blame rows (−50%), with
-- every cross-role mis-attribution (agent blamed for an account-manager stage,
-- etc.) removed. SLA/dwell now also credits agents for `new` / `specialist_review`
-- intervals (the template assigns those to the specialist), which the old
-- hardcoded list ignored.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Single source of truth: the accountability role that owns a stage on a task.
-- `owners` is tasks.stage_owner_positions (jsonb: stage -> owner-key). Owner
-- keys map onto the three accountability roles; the canonical fallback mirrors
-- the uniform Rwasem workflow when a task has no map. `team_lead` / specific
-- position ids (`pos_*`) and `done` (null) have no accountability-role mapping
-- yet and resolve to NULL (no one is charged), which is the safe default.
-- ---------------------------------------------------------------------
create or replace function public.accountable_role_for_stage(owners jsonb, stage text)
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
    when 'agent'           then 'agent'
    when 'specialist'      then 'agent'
    when 'manager'         then 'team_manager'
    when 'account_manager' then 'account_manager'
    else null
  end
$$;

-- ---------------------------------------------------------------------
-- Recompute the scorecard with ownership-gated attribution. Body is identical
-- to 0193 except: `live` now also carries `stage_owner_positions`; `open_counts`
-- and `intervals` gate on `accountable_role_for_stage(...)` = the row's role.
-- ---------------------------------------------------------------------
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
  attrib as (
    select ta.organization_id, ta.task_id, ta.employee_id, 'agent'::text as role
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
     where ta.role_type = 'agent'
    union
    select ta.organization_id, ta.task_id, ta.employee_id, 'account_manager'
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
     where ta.role_type = 'account_manager'
    union
    select ta.organization_id, ta.task_id, ta.team_manager_employee_id, 'team_manager'
      from public.task_assignees ta
      join live lt on lt.id = ta.task_id
     where ta.team_manager_employee_id is not null
  ),
  open_counts as (
    -- Only count a task on someone's board when their role OWNS its CURRENT
    -- stage (template-driven). This is the core fix for over-attribution.
    select a.organization_id, a.employee_id, a.role,
           count(distinct a.task_id) filter (
             where lt.stage <> 'done'
               and a.role = public.accountable_role_for_stage(lt.stage_owner_positions, lt.stage::text)
           ) as open_tasks,
           count(distinct a.task_id) filter (
             where lt.stage <> 'done' and lt.is_overdue
               and a.role = public.accountable_role_for_stage(lt.stage_owner_positions, lt.stage::text)
           ) as overdue_owned
      from attrib a
      join live lt on lt.id = a.task_id
     group by 1, 2, 3
  ),
  intervals as (
    -- Historical SLA / dwell intervals, gated to the stages the role owns on
    -- that task (same template-driven ownership as the open board).
    select a.organization_id, a.employee_id, a.role, h.to_stage::text as stage_key, h.exited_at,
           coalesce(d.dwell_business_minutes::numeric,
                    public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) as dwell_min
      from attrib a
      join live lt on lt.id = a.task_id
      join public.task_stage_history h on h.task_id = a.task_id
      left join public.task_stage_dwell d on d.history_id = h.id
     where a.role = public.accountable_role_for_stage(lt.stage_owner_positions, h.to_stage::text)
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

-- Repopulate immediately with the new semantics.
select public.refresh_accountability_scorecard();
