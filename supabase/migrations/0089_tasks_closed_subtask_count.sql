-- 0089_tasks_closed_subtask_count.sql
--
-- Sky Light feedback #19: the team wants two task list columns — # designs
-- and # edits — plus a monthly filter. We already have `tasks.design_count`
-- (mirrored from the Odoo `project_customization` addon's manual integer).
-- This migration adds `tasks.closed_subtask_count` (mirrors Odoo's stock
-- `closed_subtask_count` computed field), trigger-maintained whenever a
-- sub-task changes its `parent_task_id` or transitions in/out of the `done`
-- stage. The team interprets each closed sub-task as one "edit/rework",
-- which is consistent with the Sky Light operations PDF flow (every revision
-- spawns a sub-task that closes when the revision ships).
--
-- Idempotent: column add via `if not exists`, trigger via `drop trigger if
-- exists` + recreate.

alter table public.tasks
  add column if not exists closed_subtask_count integer not null default 0;

comment on column public.tasks.closed_subtask_count is
  'Number of sub-tasks (parent_task_id = self.id) currently in stage=done. Maintained by recompute_parent_closed_subtask_count_tr trigger. Mirrors Odoo project.task.closed_subtask_count.';

-- Recomputes a single parent's closed_subtask_count from its sub-tasks.
-- Internal helper (not exposed via PostgREST) — called from the trigger only.
create or replace function public.recompute_closed_subtask_count(p_parent_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tasks t
     set closed_subtask_count = coalesce((
       select count(*) from public.tasks st
        where st.parent_task_id = t.id
          and st.stage = 'done'
     ), 0)
   where t.id = p_parent_id;
$$;

create or replace function public.recompute_parent_closed_subtask_count_tr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- INSERT/DELETE/UPDATE on a sub-task: recompute the parent we just
  -- attached to or detached from. On UPDATE that re-parents (parent_task_id
  -- changed), recompute both old and new parents.
  if (tg_op = 'INSERT') then
    if new.parent_task_id is not null then
      perform public.recompute_closed_subtask_count(new.parent_task_id);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.parent_task_id is not null then
      perform public.recompute_closed_subtask_count(old.parent_task_id);
    end if;
    return old;
  else
    -- UPDATE: only recompute when stage changed or parent changed.
    if (new.stage is distinct from old.stage)
       or (new.parent_task_id is distinct from old.parent_task_id) then
      if old.parent_task_id is not null
         and old.parent_task_id is distinct from new.parent_task_id then
        perform public.recompute_closed_subtask_count(old.parent_task_id);
      end if;
      if new.parent_task_id is not null then
        perform public.recompute_closed_subtask_count(new.parent_task_id);
      end if;
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists recompute_parent_closed_subtask_count on public.tasks;
create trigger recompute_parent_closed_subtask_count
  after insert or update or delete on public.tasks
  for each row execute function public.recompute_parent_closed_subtask_count_tr();

-- Backfill existing rows.
update public.tasks t
   set closed_subtask_count = coalesce((
     select count(*) from public.tasks st
      where st.parent_task_id = t.id
        and st.stage = 'done'
   ), 0)
 where exists (select 1 from public.tasks st where st.parent_task_id = t.id);

-- Index supports the new monthly filter UI: "tasks created in month M". A
-- plain btree on created_at suffices for range scans like
-- "created_at >= '2026-05-01' and created_at < '2026-06-01'".
create index if not exists idx_tasks_org_created_at
  on public.tasks(organization_id, created_at);
