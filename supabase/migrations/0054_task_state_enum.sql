-- 0054_task_state_enum.sql
-- Adds the 4-value Odoo task.state field (01_in_progress / 02_changes_requested
-- / 03_approved / 04_waiting_normal) parallel to tasks.stage. Many Sky Light
-- saved filters key on this field, so we need it for filter parity.
--
-- A trigger maps stage transitions to state values:
--   stage = new                                                 → 04_waiting_normal
--   stage = client_changes                                       → 02_changes_requested
--   stage = done                                                 → 03_approved
--   stage in (in_progress, manager_review, specialist_review,
--            ready_to_send, sent_to_client)                       → 01_in_progress

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_state') then
    create type public.task_state as enum (
      '01_in_progress',
      '02_changes_requested',
      '03_approved',
      '04_waiting_normal'
    );
  end if;
end$$;

alter table public.tasks
  add column if not exists state public.task_state not null default '04_waiting_normal';

create index if not exists idx_tasks_state
  on public.tasks(organization_id, state);

create or replace function public.derive_task_state(p_stage public.task_stage)
returns public.task_state
language sql
immutable
as $$
  select case p_stage
    when 'new'                then '04_waiting_normal'::public.task_state
    when 'client_changes'     then '02_changes_requested'::public.task_state
    when 'done'               then '03_approved'::public.task_state
    else '01_in_progress'::public.task_state
  end;
$$;

create or replace function public.tg_sync_task_state()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.state := public.derive_task_state(new.stage);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_sync_state on public.tasks;
create trigger trg_tasks_sync_state
  before insert or update of stage on public.tasks
  for each row
  execute function public.tg_sync_task_state();

update public.tasks set state = public.derive_task_state(stage);
