-- =========================================================================
-- Migration 0162 — PEOPLE ANALYTICS PERMISSION (accountability page gate)
-- =========================================================================
-- The /accountability scorecards are a management evidence tool (owner
-- decision 2026-06-10: CEO + department heads only). reports.view is too
-- broad — it is also granted to `viewer`. This adds a dedicated key and
-- grants it to owner/admin/manager (manager = department head tier per the
-- Sky Light ops manual).
-- =========================================================================

insert into public.permissions (key, description)
values ('people.analytics.view', 'View employee accountability analytics (SLA breaches, reviewer rigor, rework attribution)')
on conflict (key) do nothing;

do $$
declare
  v_perm uuid;
  v_role uuid;
  r text;
begin
  select id into v_perm from public.permissions where key = 'people.analytics.view';
  foreach r in array array['owner','admin','manager'] loop
    select id into v_role from public.roles where key = r;
    if v_role is not null then
      insert into public.role_permissions (role_id, permission_id)
      values (v_role, v_perm)
      on conflict do nothing;
    end if;
  end loop;
end $$;
