-- 0227 Correct misroled leadership positions
-- =====================================================================
-- Separation of concerns (per the team): Project Management is driven by the
-- task templates + Odoo + the ORG STRUCTURE; accountability is a separate
-- derived layer that consumes those facts. `positions` is part of the PM
-- source of truth, so a position's `role` must reflect its real org rank.
--
-- Several *manager* positions were seeded with an executor `role`
-- (positions.role), which made their holders render as "المنفذ" on task cards,
-- get charged for execution/overdue in the accountability scorecard, and
-- resolve as executors in generate-tasks. Concretely: مدير القسم المساند →
-- 'agent' (محمد عادل, عمر الخيام, each co-assigned to ~970 tasks) and
-- مدير القسم التقني / الرئيسي / إدارة المبيعات → 'specialist'.
--
-- Fix the DATA at the source (not the accountability logic): give each a
-- leadership role so leadership.ts recognises it by role, accountability
-- collapses it to team_manager, and the PM card shows a manager — not an
-- executor. Supporting-section managers → supporting_lead (they own supporting
-- work, never the main-section execution/review defaults); main-section /
-- department managers → manager.
-- Idempotent: only rewrites rows that are still misroled.
-- =====================================================================

update public.positions
   set role = 'supporting_lead'
 where trim(name) = 'مدير القسم المساند'
   and role <> 'supporting_lead';

update public.positions
   set role = 'manager'
 where trim(name) in ('مدير القسم التقني', 'مدير القسم الرئيسي', 'مدير قسم إدارة المبيعات')
   and role <> 'manager';

-- Accountability consumes the corrected facts — rebuild the scorecard now so the
-- four managers immediately leave the executor pool.
select public.refresh_accountability_scorecard();
