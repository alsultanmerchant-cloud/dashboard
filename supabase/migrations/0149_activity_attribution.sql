-- =========================================================================
-- Migration 0149 — Activity attribution RPCs (Phase 3)
-- =========================================================================
-- The ownership-episode triggers (0147) capture timing + whether a stage was
-- answered, but the ACTOR for dashboard stage advances is null (moves run as
-- service-role; task_stage_history.moved_by is NULL). The dashboard DOES know
-- the actor in audit_logs (action='task.stage_change', actor_user_id). These
-- RPCs let the app stamp the real actor / credit owner comments. Called from
-- logAudit (best-effort) so there is no extra call-site wiring.
-- =========================================================================

-- Stamp the ACTUAL actor on the episode just closed by a stage advance.
create or replace function public.mark_episode_actor(p_org uuid, p_task uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_emp uuid;
begin
  select id into v_emp from public.employee_profiles
   where user_id = p_user and organization_id = p_org limit 1;
  if v_emp is null then return; end if;

  update public.ownership_episodes
     set answered_by_employee_id = v_emp,
         answered_kind = coalesce(answered_kind, 'stage_advance')
   where id = (
     select id from public.ownership_episodes
      where task_id = p_task
        and answered_by_employee_id is null
        and closed_at is not null
      order by closed_at desc
      limit 1
   );
end;
$$;

-- Credit a qualifying owner comment as "answered" on the currently-open stage
-- (only if the commenter OWNS that stage — prevents free engagement credit).
create or replace function public.mark_episode_comment(p_org uuid, p_task uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_resp int;
begin
  select id into v_emp from public.employee_profiles
   where user_id = p_user and organization_id = p_org limit 1;
  if v_emp is null then return; end if;

  update public.ownership_episodes e
     set answered_at = coalesce(e.answered_at, now()),
         answered_kind = coalesce(e.answered_kind, 'comment'),
         answered_by_employee_id = coalesce(e.answered_by_employee_id, v_emp),
         response_minutes = coalesce(
           e.response_minutes,
           public.working_minutes_between(p_org, e.opened_at, now())
         ),
         within_sla = case
           when e.within_sla is not null then e.within_sla
           when e.sla_minutes is null then null
           else public.working_minutes_between(p_org, e.opened_at, now()) <= e.sla_minutes
         end
   where e.task_id = p_task
     and e.closed_at is null
     and e.owner_employee_id = v_emp;
end;
$$;

comment on function public.mark_episode_actor(uuid, uuid, uuid) is
  'Stamps the real actor (from a dashboard stage advance) onto the just-closed ownership episode.';
comment on function public.mark_episode_comment(uuid, uuid, uuid) is
  'Credits a qualifying owner comment as answered on their currently-open stage episode.';
