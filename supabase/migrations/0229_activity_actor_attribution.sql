-- 0229 Activity actor attribution — count actions by ACTOR, not task-assignee
-- =========================================================================
-- نبض الفريق / تفاصيل الإجراءات / "كيف يتطوّر نشاط X" counted a person's
-- "إجراءات" by TASK ASSIGNMENT: every stage move + comment on any task they
-- were an agent-assignee of, summed across their tasks — with NO actor filter.
-- The Sky Light team rejected the numbers (2026-07-01): co-assignees showed
-- identical counts, leads/heads assigned to thousands of tasks inherited the
-- whole team's volume (فدوى=3021 tasks, حسن=1455 → both 176 "today"), and a
-- single stage change was counted up to 3× (task_stage_history + its
-- notification-comment + once per co-assignee).
--
-- The real actor IS in the data. Every action — a human Log Note AND a stage
-- change — is an Odoo mail.message with an author, imported into task_comments
-- as external_author_name (94,178 rows, 99.98% populated; stage changes land
-- as `<strong>Stage:</strong> old → new` notification bodies). So we attribute
-- each comment to its real author and classify it, then recompute the action
-- metrics as "stage moves + log notes the person actually performed" — the
-- section's own definition (تحريك المهام بين المراحل + ملاحظات العمل).
--
-- task_stage_history is left UNTOUCHED: it stays the source for timing / dwell
-- / accountability (which are ownership-based, a different question). This
-- migration only changes the per-person ACTIVITY counts.
-- =========================================================================

-- ── 1. Classify every comment (generated → covers all past + future rows) ──
-- stage_move : `<strong>Stage:</strong> … → …`  (the tracked stage transition)
-- tracking   : any other field-change notification (assignee/state/deadline…)
-- created    : lifecycle label-only notification (e.g. "Task Created")
-- note       : everything else = a genuine human Log Note
-- Only note + stage_move are counted as "actions". `~`/`like` are immutable so
-- this is valid in a STORED generated column.
alter table public.task_comments
  add column if not exists action_kind text
  generated always as (
    case
      when body like '%<strong>Stage:</strong>%' then 'stage_move'
      when body like '%→%' and body like '%</strong>%' then 'tracking'
      when body ~ '^\s*<p><strong>[^<]+</strong></p>\s*$' then 'created'
      else 'note'
    end
  ) stored;

-- ── 2. Actor resolution: Odoo author display-name → employee ──
-- Exact (whitespace-normalized) full_name match first; a hand-seeded alias
-- table covers names that don't map 1:1 (departed staff / spelling drift).
-- Unmatched authors resolve to NULL (uncredited) — never mis-attributed.
create table if not exists public.activity_actor_aliases (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_name     text not null,
  employee_id     uuid not null references public.employee_profiles(id) on delete cascade,
  primary key (organization_id, author_name)
);
alter table public.activity_actor_aliases enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'activity_actor_aliases'
       and policyname = 'activity_actor_aliases_read'
  ) then
    create policy activity_actor_aliases_read on public.activity_actor_aliases
      for select using (public.has_org_access(organization_id));
  end if;
end $$;

create or replace function public.resolve_activity_actor(p_org uuid, p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p_name is null then null else coalesce(
    (select e.id from public.employee_profiles e
      where e.organization_id = p_org
        and regexp_replace(btrim(e.full_name), '\s+', ' ', 'g')
          = regexp_replace(btrim(p_name), '\s+', ' ', 'g')
      limit 1),
    (select a.employee_id from public.activity_actor_aliases a
      where a.organization_id = p_org and a.author_name = p_name
      limit 1)
  ) end
$$;

alter table public.task_comments
  add column if not exists actor_employee_id uuid
    references public.employee_profiles(id) on delete set null;

-- Backfill the resolved actor for every existing imported comment.
update public.task_comments c
   set actor_employee_id = public.resolve_activity_actor(c.organization_id, c.external_author_name)
 where c.external_author_name is not null;

-- Keep it fresh: re-resolve on insert / author change (no importer wiring).
create or replace function public.tg_set_comment_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.actor_employee_id := public.resolve_activity_actor(new.organization_id, new.external_author_name);
  return new;
end
$$;

drop trigger if exists set_comment_actor on public.task_comments;
create trigger set_comment_actor
  before insert or update of external_author_name on public.task_comments
  for each row execute function public.tg_set_comment_actor();

create index if not exists idx_task_comments_actor_kind
  on public.task_comments (actor_employee_id, action_kind, created_at)
  where actor_employee_id is not null;

-- ── 3. Rebuild نبض الفريق cache: action counts are now AUTHOR-based ──
-- Action counts (actions_today/7/prev, last_action/move/update, updates7) come
-- from comments the person AUTHORED. Workload (open_wip/stalled/done7/no_update)
-- stays task-based (their assigned live tasks) — that's a legitimately
-- different lens. "today" is a real Asia/Riyadh calendar day (matches the
-- تفاصيل الإجراءات "اليوم" filter), not a rolling 24h.
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
begin
  -- Serialize concurrent runs (manual call vs the 10-min cron) so the
  -- delete-then-insert can't race into a duplicate-key collision.
  perform pg_advisory_xact_lock(hashtext('refresh_team_activity'));
  delete from public.team_activity_cache;

  insert into public.team_activity_cache
    (organization_id, employee_id, last_action, last_move, last_update,
     actions_today, actions7, actions_prev, open_wip, stalled, done7,
     updates7, no_update, refreshed_at)
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
  -- Union the key sets (a person may have workload, authored actions, or both)
  -- so every employee yields exactly one cache row — no dup-key risk.
  keys as (
    select org, employee_id from workload
    union
    select org, employee_id from authored
  )
  select k.org, k.employee_id,
         a.last_action, a.last_move, a.last_update,
         coalesce(a.actions_today, 0), coalesce(a.actions7, 0), coalesce(a.actions_prev, 0),
         coalesce(w.open_wip, 0), coalesce(w.stalled, 0), coalesce(w.done7, 0),
         coalesce(a.updates7, 0), coalesce(w.no_update, 0), now()
    from keys k
    left join authored a on a.org = k.org and a.employee_id = k.employee_id
    left join workload w on w.org = k.org and w.employee_id = k.employee_id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 4. Rebuild the activity-trend snapshot: actions_count is AUTHOR-based ──
-- Only the `_act` source changes (from assignee-join to author-attributed
-- note + stage_move). SLA / dwell / completion stay ownership-based. Historical
-- (no archive filter) so past activity on since-archived tasks still shows.
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
   where c.actor_employee_id is not null
     and c.action_kind in ('note', 'stage_move')
   group by 1, 2, 3;

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
