-- 0269 Correct the AM department head's position role
-- =====================================================================
-- Same class of bug 0227 fixed, one position it missed: «مدير قسم إدارة
-- الحسابات» (اية خفاجي) was seeded with role='account_manager' — the only
-- leadership position not roled as leadership.
--
-- Consequence: accountability_role_of_position('account_manager') =
-- 'account_manager', so the stage-ownership engine treated the department
-- HEAD as one more AM. She is co-assigned on her team's tasks for oversight
-- (23 open today), so every renewal/AM-stage task also attributed to her —
-- the same problem surfaced once per person on /accountability (client
-- confirmed the duplication: her card repeated سلمى تامر's case verbatim).
-- She owns ZERO contracts as account_manager_name, so nothing commercial
-- keys on her being an AM.
--
-- leadership.ts already matches this position by NAME, so performance
-- tables were unaffected; only position-role-driven attribution (stage
-- ownership, task-card role badges, generate-tasks resolution) was wrong.
--
-- Fix the DATA at the source (not the accountability logic), per the
-- established separation: PM source of truth = templates + Odoo + org
-- structure. Main-section department manager → 'manager'.
-- Idempotent: only rewrites the row while it is still misroled.
-- =====================================================================

update public.positions
   set role = 'manager'
 where trim(name) = 'مدير قسم إدارة الحسابات'
   and role <> 'manager';

-- Accountability consumes the corrected fact — rebuild the scorecard so the
-- head immediately leaves the AM execution pool.
select public.refresh_accountability_scorecard();
