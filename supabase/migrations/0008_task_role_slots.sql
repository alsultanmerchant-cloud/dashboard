-- 0008_task_role_slots.sql
-- Phase 3: Sky Light multi-role task assignment.
-- Splits task_assignees into 4 named slots per the manual:
--   * specialist       — defines requirements, final review
--   * manager          — distributes work, reviews quality
--   * agent            — executes the task
--   * account_manager  — talks to client, handles changes / approval
--
-- Each task can have at most one employee per slot. Existing rows are
-- backfilled into the "agent" slot since they represent the executor.

-- 1. Enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_role_type') then
    create type public.task_role_type as enum (
      'specialist',
      'manager',
      'agent',
      'account_manager'
    );
  end if;
end$$;

-- 2. Add column with default 'agent', then drop the default.
alter table public.task_assignees
  add column if not exists role_type public.task_role_type not null default 'agent';

alter table public.task_assignees alter column role_type drop default;

-- 3. Replace the legacy unique(task_id, employee_id) constraint —
-- a single person can hold multiple slots on the same task (uncommon
-- but allowed; e.g. a small agency where the AM is also the specialist).
-- The new uniqueness rule is "one assignee per (task, role)".
alter table public.task_assignees drop constraint if exists task_assignees_task_id_employee_id_key;

create unique index if not exists uq_task_assignees_task_role
  on public.task_assignees (task_id, role_type);

create index if not exists idx_task_assignees_role
  on public.task_assignees (organization_id, role_type);
