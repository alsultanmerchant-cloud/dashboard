-- 0225 Departments: per-department نبض الفريق visibility toggle
-- =====================================================================
-- The team wants to add/remove departments from نبض الفريق as the org changes,
-- without a code deploy. Replaces the hardcoded HIDDEN_DEPARTMENTS list with a
-- per-department flag editable from the departments admin.
-- Default true (visible); الإخراج الفني والتصميمات starts hidden (no Rwasem
-- actions) to preserve current behaviour.
-- =====================================================================
alter table public.departments
  add column if not exists show_in_team_pulse boolean not null default true;

update public.departments
   set show_in_team_pulse = false
 where trim(name) = 'الإخراج الفني والتصميمات';
