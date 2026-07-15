-- 0251 — Active-member count for the executive Discipline index
-- =====================================================================
-- The «موظفون نشطون» tile on /dashboard (Team Discipline index) was reading
-- distinct actors from `task_stage_history.moved_by`, which the Odoo importer
-- never populates (0 / ~39k rows) → the tile rendered غير متاح permanently.
--
-- The real actor attribution lives in `task_comments.actor_employee_id`
-- (authored comments AND imported stage-changes both carry it — see the Team
-- Pulse action-attribution fix, migration 0229). This RPC returns the count of
-- distinct employees who took ANY attributed action inside a time window, so
-- the tile can show a real "active / total" figure.
--
-- A window can contain >1000 rows, so a plain PostgREST select would truncate
-- and undercount the distinct set; computing the distinct count server-side is
-- both accurate and a single round-trip.
-- =====================================================================

create or replace function public.dashboard_active_member_count(
  p_org  uuid,
  p_from timestamptz,
  p_to   timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct c.actor_employee_id)::int
    from public.task_comments c
   where c.organization_id = p_org
     and c.actor_employee_id is not null
     and c.created_at >= p_from
     and c.created_at <  p_to
$$;

grant execute on function public.dashboard_active_member_count(uuid, timestamptz, timestamptz)
  to anon, authenticated, service_role;
