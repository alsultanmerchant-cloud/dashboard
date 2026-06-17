-- 0196 — Realign task_assignees.team_manager_employee_id to قائد الفريق.
--
-- The accountability engine and the task card both read
-- `task_assignees.team_manager_employee_id` as "قائد الفريق". Its single source
-- of truth is `employee_profiles.team_leader_employee_id` (set on
-- /organization/employees). The Odoo team-manager sync had regressed to
-- preferring `manager_employee_id` (المدير / manager-of-heads, e.g. احمد حبيب,
-- مدير التقني), injecting a higher-level manager as a "team leader" on ~64% of
-- assignee rows. المدير is NOT a team leader; a head / team-lead simply has no
-- team leader (field stays empty).
--
-- This re-applies the 0165 rule (`nullif(team_leader_employee_id, employee_id)`)
-- which the sync had since overwritten. The sync itself is fixed in
-- src/lib/odoo/syncs/task-assignee-managers.ts to mirror team_leader going
-- forward. Idempotent via `is distinct from`.

update task_assignees ta
   set team_manager_employee_id = nullif(e.team_leader_employee_id, ta.employee_id)
  from employee_profiles e
 where e.id = ta.employee_id
   and e.organization_id = ta.organization_id
   and ta.team_manager_employee_id
       is distinct from nullif(e.team_leader_employee_id, ta.employee_id);
