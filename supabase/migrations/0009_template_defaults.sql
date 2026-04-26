-- 0009_template_defaults.sql
-- Phase 5: Service-level defaults to feed auto-generation, plus the
-- per-task upload-offset rules from the Sky Light manual (pages 21-22).

-- 1. Service defaults
-- A service can declare:
--   * its owning department (head_employee_id of that department becomes
--     the default Specialist when a task is generated)
--   * an explicit default_specialist_employee_id (overrides the dept head)
alter table public.services
  add column if not exists default_department_id uuid
    references public.departments(id) on delete set null,
  add column if not exists default_specialist_employee_id uuid
    references public.employee_profiles(id) on delete set null;

create index if not exists idx_services_default_dept
  on public.services(default_department_id);

-- 2. Per-task upload-offset rules
-- The manual specifies how many days before a task's deadline the work
-- must be "uploaded" (i.e. moved out of New). Some Social Media tasks
-- repeat per week — week_index lets us stagger them.
alter table public.task_template_items
  add column if not exists upload_offset_days_before_deadline smallint,
  add column if not exists week_index smallint;
