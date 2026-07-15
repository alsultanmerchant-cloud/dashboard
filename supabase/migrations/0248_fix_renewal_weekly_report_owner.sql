-- 0248 — Renewal Social weekly reports are executed by the Specialist
-- =====================================================================
-- The Renewal Social Media template marked `تقارير الاسبوع للسوشيال` as
-- agent-owned during In Progress, but those tasks have no employee whose
-- position role is `agent`; the assigned Specialist is the executor. This left
-- two real tasks with no current-stage owner and understated the Specialist's
-- Team Pulse desk load (23 instead of 25 in the reported snapshot).
--
-- Correct the authoritative template and the existing Odoo-synced task
-- snapshots. Keep every other stage owner unchanged.
-- =====================================================================

update public.task_template_items tti
   set stage_owner_positions = jsonb_set(
         coalesce(tti.stage_owner_positions, public._default_stage_owner_positions()),
         '{in_progress}',
         '"specialist"'::jsonb,
         true
       )
  from public.task_templates tt
  join public.organizations o on o.id = tt.organization_id
 where tti.task_template_id = tt.id
   and o.slug = 'rawasm-demo'
   and tt.name = '🔵Renewal Social Media'
   and tti.title = 'تقارير الاسبوع للسوشيال'
   and coalesce(tti.stage_owner_positions ->> 'in_progress', '') <> 'specialist';

with target_services as (
  select distinct tt.organization_id, tt.service_id
    from public.task_templates tt
    join public.task_template_items tti on tti.task_template_id = tt.id
    join public.organizations o on o.id = tt.organization_id
   where o.slug = 'rawasm-demo'
     and tt.name = '🔵Renewal Social Media'
     and tti.title = 'تقارير الاسبوع للسوشيال'
)
update public.tasks t
   set stage_owner_positions = jsonb_set(
         coalesce(t.stage_owner_positions, public._default_stage_owner_positions()),
         '{in_progress}',
         '"specialist"'::jsonb,
         true
       )
  from target_services target
 where t.organization_id = target.organization_id
   and t.service_id = target.service_id
   and t.title = 'تقارير الاسبوع للسوشيال'
   and coalesce(t.stage_owner_positions ->> 'in_progress', '') <> 'specialist';

select public.refresh_team_activity();
