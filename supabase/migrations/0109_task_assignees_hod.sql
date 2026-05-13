-- 0109_task_assignees_hod.sql
-- Track both team leader (existing team_manager_employee_id) and head of
-- department per task-assignee row, linked to the org chart.

alter table public.task_assignees
  add column if not exists head_of_dept_employee_id uuid
    references public.employee_profiles(id) on delete set null;

create index if not exists idx_task_assignees_head_of_dept
  on public.task_assignees(head_of_dept_employee_id)
  where head_of_dept_employee_id is not null;
