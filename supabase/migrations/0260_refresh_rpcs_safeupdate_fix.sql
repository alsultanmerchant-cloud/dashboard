-- 0260: make the two cache-refresh RPCs callable through PostgREST.
--
-- The `authenticator` role Supabase runs PostgREST under is configured with
-- `session_preload_libraries=safeupdate`, so ANY unqualified DELETE raises
-- "DELETE requires a WHERE clause". Both refresh RPCs wipe their cache table
-- with a bare `delete from ...`, which is fine from psql/the Management API
-- (different role) but fails from the app — the «تحديث البيانات» button on
-- /accountability could never refresh.
--
-- TRUNCATE is not intercepted by safeupdate, and is the right verb anyway:
-- these are full-rebuild cache tables with no FK children.

CREATE OR REPLACE FUNCTION public.refresh_accountability_scorecard()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
declare
  v_n int;
begin
  truncate table public.accountability_scorecard;

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
$function$;

CREATE OR REPLACE FUNCTION public.refresh_performance_snapshots()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
declare
  v_total int := 0;
  v_n int;
  g record;
begin
  create temp table _iv on commit drop as
  with attrib as (
    select ta.organization_id org, ta.task_id, ta.employee_id emp, 'agent'::text role
      from public.task_assignees ta where ta.role_type = 'agent'
    union
    select ta.organization_id, ta.task_id, ta.employee_id, 'account_manager'
      from public.task_assignees ta where ta.role_type = 'account_manager'
    union
    select ta.organization_id, ta.task_id, ta.team_manager_employee_id, 'team_manager'
      from public.task_assignees ta where ta.team_manager_employee_id is not null
  )
  select a.org, a.emp, h.entered_at::date entered_d, h.to_stage::text stage_key,
         h.exited_at,
         coalesce(d.dwell_business_minutes::numeric,
                  public.business_minutes_between(h.entered_at, coalesce(h.exited_at, now()))) dwell_min,
         s.max_minutes
    from attrib a
    join public.task_stage_history h on h.task_id = a.task_id
    left join public.task_stage_dwell d on d.history_id = h.id
    left join public.sla_rules s on s.organization_id = a.org and s.stage_key = h.to_stage::text
   where (
       (a.role = 'agent' and h.to_stage in ('in_progress','client_changes'))
    or (a.role = 'team_manager' and h.to_stage in ('manager_review'))
    or (a.role = 'account_manager' and h.to_stage in ('ready_to_send','sent_to_client'))
   )
     and a.emp is not null;

  create temp table _done on commit drop as
  select ta.organization_id org, ta.employee_id emp,
         coalesce(t.actual_done_date, t.completed_at::date) done_d
    from public.tasks t
    join public.task_assignees ta on ta.task_id = t.id and ta.role_type = 'agent'
   where coalesce(t.actual_done_date, t.completed_at::date) is not null
     and ta.employee_id is not null;

  -- actions = stage moves + Log Notes ATTRIBUTED TO THE REAL ACTOR, per day.
  create temp table _act on commit drop as
  select c.organization_id org, c.actor_employee_id emp,
         (timezone('Asia/Riyadh', c.created_at))::date d, count(*) cnt
    from public.task_comments c
   where c.actor_employee_id is not null   group by 1, 2, 3;

  truncate table public.performance_snapshots;

  for g in
    select 'month'::text grain, '1 month'::text step union all
    select 'week', '7 days'
  loop
    execute format($f$
      insert into public.performance_snapshots
        (organization_id, scope_type, scope_id, grain, period_start, period_end,
         on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sla_ok, sample_size,
         actions_count)
      with iv as (
        select org, emp,
               case when %1$L = 'month'
                    then date_trunc('month', entered_d)::date
                    else entered_d - extract(dow from entered_d)::int end as bstart,
               exited_at, dwell_min, max_minutes, stage_key
          from _iv
      ),
      dn as (
        select org, emp,
               case when %1$L = 'month'
                    then date_trunc('month', done_d)::date
                    else done_d - extract(dow from done_d)::int end as bstart,
               count(*) done
          from _done group by 1,2,3
      ),
      ac as (
        select org, emp,
               case when %1$L = 'month'
                    then date_trunc('month', d)::date
                    else d - extract(dow from d)::int end as bstart,
               sum(cnt) acts
          from _act group by 1,2,3
      ),
      im as (
        select org, emp, bstart,
               avg(dwell_min) filter (where exited_at is not null) avg_dwell,
               count(*) filter (where exited_at is not null) sample_size,
               count(*) filter (where max_minutes is not null
                                  and (exited_at is not null or dwell_min > max_minutes)) sla_n,
               count(*) filter (where max_minutes is not null
                                  and exited_at is not null and dwell_min <= max_minutes) sla_ok,
               count(*) filter (where stage_key = 'client_changes') rework
          from iv group by 1,2,3
      ),
      k as (
        select org, emp, bstart from im
        union select org, emp, bstart from dn
        union select org, emp, bstart from ac
      )
      select k.org, 'employee', k.emp, %1$L, k.bstart, (k.bstart + %2$L::interval)::date,
             case when im.sla_n > 0 then round(im.sla_ok::numeric / im.sla_n * 100) end,
             im.avg_dwell, coalesce(dn.done,0), coalesce(im.rework,0),
             coalesce(im.sla_n,0), coalesce(im.sla_ok,0), coalesce(im.sample_size,0),
             coalesce(ac.acts,0)
        from k
        left join im on im.org=k.org and im.emp=k.emp and im.bstart=k.bstart
        left join dn on dn.org=k.org and dn.emp=k.emp and dn.bstart=k.bstart
        left join ac on ac.org=k.org and ac.emp=k.emp and ac.bstart=k.bstart
        join public.employee_profiles e on e.id = k.emp and e.organization_id = k.org
    $f$, g.grain, g.step);
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    insert into public.performance_snapshots
      (organization_id, scope_type, scope_id, grain, period_start, period_end,
       on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sla_ok, sample_size,
       actions_count)
    select ps.organization_id, 'department', e.department_id, g.grain,
           ps.period_start, ps.period_end,
           case when sum(ps.sla_n) > 0 then round(sum(ps.sla_ok)::numeric / sum(ps.sla_n) * 100) end,
           case when sum(ps.sample_size) > 0
                then sum(ps.avg_dwell * ps.sample_size) / sum(ps.sample_size) end,
           sum(ps.completed_count), sum(ps.rework_count),
           sum(ps.sla_n), sum(ps.sla_ok), sum(ps.sample_size),
           sum(ps.actions_count)
      from public.performance_snapshots ps
      join public.employee_profiles e on e.id = ps.scope_id and e.organization_id = ps.organization_id
      left join public.positions pp on pp.id = e.position_id
     where ps.scope_type = 'employee' and ps.grain = g.grain
       and e.department_id is not null
       and coalesce(
             (pp.role in ('manager','team_lead','supporting_lead')
              or trim(pp.name) in ('مدير القسم التقني','مدير القسم الرئيسي',
                 'مدير القسم المساند','مدير قسم إدارة المبيعات',
                 'مدير قسم إدارة الحسابات','CSO')), false) = false
     group by ps.organization_id, e.department_id, g.grain, ps.period_start, ps.period_end;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    insert into public.performance_snapshots
      (organization_id, scope_type, scope_id, grain, period_start, period_end,
       on_time_pct, avg_dwell, completed_count, rework_count, sla_n, sla_ok, sample_size,
       actions_count)
    select ps.organization_id, 'company', ps.organization_id, g.grain,
           ps.period_start, ps.period_end,
           case when sum(ps.sla_n) > 0 then round(sum(ps.sla_ok)::numeric / sum(ps.sla_n) * 100) end,
           case when sum(ps.sample_size) > 0
                then sum(ps.avg_dwell * ps.sample_size) / sum(ps.sample_size) end,
           sum(ps.completed_count), sum(ps.rework_count),
           sum(ps.sla_n), sum(ps.sla_ok), sum(ps.sample_size),
           sum(ps.actions_count)
      from public.performance_snapshots ps
      join public.employee_profiles e on e.id = ps.scope_id and e.organization_id = ps.organization_id
      left join public.positions pp on pp.id = e.position_id
     where ps.scope_type = 'employee' and ps.grain = g.grain
       and coalesce(
             (pp.role in ('manager','team_lead','supporting_lead')
              or trim(pp.name) in ('مدير القسم التقني','مدير القسم الرئيسي',
                 'مدير القسم المساند','مدير قسم إدارة المبيعات',
                 'مدير قسم إدارة الحسابات','CSO')), false) = false
     group by ps.organization_id, g.grain, ps.period_start, ps.period_end;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end loop;

  return v_total;
end;
$function$;
