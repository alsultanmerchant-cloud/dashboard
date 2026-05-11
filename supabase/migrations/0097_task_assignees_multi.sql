-- 0097_task_assignees_multi.sql
-- Lift the "one employee per (task, role_type)" constraint so a task can have
-- as many assignees as needed, with the same role used by multiple people.
-- Each assignee row now also carries an optional team_manager_employee_id —
-- the manager the executor reports to for *this* task (Sky Light/Rwasem
-- requirement: an agent may belong to a different department than the
-- specialist driving the task, so the manager isn't derivable from the
-- employee record alone).
--
-- Compatibility:
--   • Legacy single-slot writers (tasks/_actions.ts → setAssigneeAction) keep
--     working because they still upsert one row per (task, role_type); the
--     uniqueness they assumed is now enforced at (task, employee, role).
--   • STAGE_EXIT_ROLE gating (.some(role_type === requiredRole)) keeps working
--     — any matching assignee satisfies the gate.
--   • The stage-owner widget that does .find((s) => s.role_type === ownerPos)
--     now returns the first match; multi-assignee surface lives in the new
--     panel, not in that widget.

-- 1. Drop role-uniqueness; allow multiple people per role on a task.
drop index if exists public.uq_task_assignees_task_role;

-- 2. Re-add the pre-0008 uniqueness so a single person can't be added in the
-- same role twice (still allowed to hold multiple distinct roles).
create unique index if not exists uq_task_assignees_task_employee_role
  on public.task_assignees (task_id, employee_id, role_type);

-- 3. Optional team manager for this assignee — separate from the employee's
-- own department head because the dashboard mirrors per-task ownership.
alter table public.task_assignees
  add column if not exists team_manager_employee_id uuid
  references public.employee_profiles(id) on delete set null;

create index if not exists idx_task_assignees_team_manager
  on public.task_assignees (team_manager_employee_id);
