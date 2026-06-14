-- 0165 — Fix قائد الفريق links on existing task_assignees rows.
--
-- The Odoo importer used to fill task_assignees.team_manager_employee_id from
-- the PROJECT's specialist/PM slot, which disagreed with the org chart. The
-- card display and the accountability engine both read this column, so it must
-- mirror each assignee's OWN قائد الفريق exactly as it appears on
-- /organization/employees.
--
-- Source of truth: employee_profiles.team_leader_employee_id ONLY.
--   * NO fallback to المدير (manager_employee_id): المدير is the manager of the
--     department heads — a higher level, not the person's team leader. A team
--     leader / head simply has no team leader, so the column is nulled.
--   * Self-references are nulled (nobody leads themselves).
-- Applies to ALL role types: the importer wrote this column for both agent and
-- account_manager rows, and the dashboard's AM assignment lives in employee_id
-- (not team_manager_employee_id), so re-pointing it here is safe.
--
-- Idempotent: the `is distinct from` guard makes re-runs no-ops.

update task_assignees ta
   set team_manager_employee_id =
       nullif(ep.team_leader_employee_id, ta.employee_id)
  from employee_profiles ep
 where ep.id = ta.employee_id
   and nullif(ep.team_leader_employee_id, ta.employee_id)
       is distinct from ta.team_manager_employee_id;
