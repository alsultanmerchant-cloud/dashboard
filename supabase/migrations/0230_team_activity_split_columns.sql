-- 0230 نبض الفريق — split the action / completed counters the team asked for
-- =========================================================================
-- Sky Light review (2026-07-01) of the pulse table:
--   • "إجراءات اليوم" should show HOW MANY stage moves vs HOW MANY Log Notes,
--     not just a combined total.
--   • "أُنجزت" should split into اليوم / هذا الأسبوع.
-- (Status tiers نشط/خامل/غير نشط are derived in TS from last_action, no column.)
-- Adds three cached counters and repopulates. Builds on refresh_team_activity
-- from 0229 (author-based actions, Riyadh "today", advisory lock, keys-union).
-- =========================================================================

alter table public.team_activity_cache
  add column if not exists moves_today int not null default 0,   -- stage moves the person made today
  add column if not exists notes_today int not null default 0,   -- Log Notes the person wrote today
  add column if not exists done_today  int not null default 0;   -- tasks completed today (assigned)

create or replace function public.refresh_team_activity()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
  set statement_timeout to '120s'
as $$
declare
  v_n int;
  v_today timestamptz := (date_trunc('day', timezone('Asia/Riyadh', now())) at time zone 'Asia/Riyadh');
  v_today_d date := (timezone('Asia/Riyadh', now()))::date;
begin
  perform pg_advisory_xact_lock(hashtext('refresh_team_activity'));
  delete from public.team_activity_cache;

  insert into public.team_activity_cache
    (organization_id, employee_id, last_action, last_move, last_update,
     actions_today, actions7, actions_prev, open_wip, stalled, done7,
     updates7, no_update, moves_today, notes_today, done_today, refreshed_at)
  with agent_live as (
    select distinct ta.organization_id org, ta.employee_id, ta.task_id, t.stage,
           coalesce(t.actual_done_date, t.completed_at::date) done_date
      from public.task_assignees ta
      join public.tasks t on t.id = ta.task_id
     where ta.role_type = 'agent' and ta.employee_id is not null
       and t.archived_at is null
  ),
  relevant as (select distinct task_id from agent_live),
  tmove as (
    select h.task_id, max(h.entered_at) last_move
      from public.task_stage_history h
     where h.task_id in (select task_id from relevant)
     group by 1
  ),
  tnote as (
    select c.task_id, max(c.created_at) last_c
      from public.task_comments c
     where c.task_id in (select task_id from relevant)
       and c.action_kind = 'note'
     group by 1
  ),
  workload as (
    select al.org, al.employee_id,
           count(*) filter (where al.stage <> 'done') open_wip,
           count(*) filter (where al.stage <> 'done'
             and (tm.last_move is null or tm.last_move < now() - interval '3 days')) stalled,
           count(*) filter (where al.done_date >= current_date - 7) done7,
           count(*) filter (where al.done_date = v_today_d) done_today,
           count(*) filter (where al.stage <> 'done'
             and (tn.last_c is null or tn.last_c < now() - interval '3 days')) no_update
      from agent_live al
      left join tmove tm on tm.task_id = al.task_id
      left join tnote tn on tn.task_id = al.task_id
     group by al.org, al.employee_id
  ),
  authored as (
    select c.organization_id org, c.actor_employee_id employee_id,
           max(c.created_at) last_action,
           max(c.created_at) filter (where c.action_kind = 'stage_move') last_move,
           max(c.created_at) filter (where c.action_kind = 'note') last_update,
           count(*) filter (where c.created_at >= v_today) actions_today,
           count(*) filter (where c.action_kind = 'stage_move' and c.created_at >= v_today) moves_today,
           count(*) filter (where c.action_kind = 'note' and c.created_at >= v_today) notes_today,
           count(*) filter (where c.created_at >= now() - interval '7 days') actions7,
           count(*) filter (where c.created_at >= now() - interval '14 days'
                             and c.created_at <  now() - interval '7 days') actions_prev,
           count(*) filter (where c.action_kind = 'note'
                             and c.created_at >= now() - interval '7 days') updates7
      from public.task_comments c
      join public.tasks t on t.id = c.task_id and t.archived_at is null
     where c.actor_employee_id is not null
       and c.action_kind in ('note', 'stage_move')
     group by c.organization_id, c.actor_employee_id
  ),
  keys as (
    select org, employee_id from workload
    union
    select org, employee_id from authored
  )
  select k.org, k.employee_id,
         a.last_action, a.last_move, a.last_update,
         coalesce(a.actions_today, 0), coalesce(a.actions7, 0), coalesce(a.actions_prev, 0),
         coalesce(w.open_wip, 0), coalesce(w.stalled, 0), coalesce(w.done7, 0),
         coalesce(a.updates7, 0), coalesce(w.no_update, 0),
         coalesce(a.moves_today, 0), coalesce(a.notes_today, 0), coalesce(w.done_today, 0),
         now()
    from keys k
    left join authored a on a.org = k.org and a.employee_id = k.employee_id
    left join workload w on w.org = k.org and w.employee_id = k.employee_id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
