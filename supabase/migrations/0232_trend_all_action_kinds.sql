-- 0232 Trend snapshot — count ALL authored action kinds (match 0231 table)
-- Mirrors 0231: the "كيف يتطوّر نشاط" trend now counts every action the person
-- authored (note + stage_move + created + assignee/edits), not just note+move,
-- so it agrees with the نبض الفريق table and Rwasem. Only the _act CTE changed.
create or replace function public.refresh_performance_snapshots()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
  set statement_timeout to '120s'
as $$
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

  delete from public.performance_snapshots;

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
$$;
