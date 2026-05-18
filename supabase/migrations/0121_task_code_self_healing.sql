-- 0121_task_code_self_healing.sql
--
-- The Odoo importer's bulk task upsert failed with:
--   duplicate key value violates unique constraint "tasks_project_task_code_unique"
--
-- Root cause: `_next_task_code` (migration 0050) trusts `projects.task_seq`
-- as the sole source of the next per-project task number. That counter can
-- drift below the real `max(tasks.code_seq)` for a project — e.g. after the
-- `project_code` backfill (0071) or any partial/legacy task import that wrote
-- `code_seq` without advancing `task_seq`. When it drifts, the trigger hands
-- a fresh INSERT a `code_seq` that already exists → the `(project_id,
-- task_code)` unique index rejects the row and the whole bulk chunk aborts.
--
-- Fix: make the counter self-healing. The next number is computed as
-- `greatest(task_seq, max(existing code_seq)) + 1`, so it is always strictly
-- greater than every code already on the project — a collision is impossible
-- no matter how the counter drifted. Also one-shot reconcile `task_seq` for
-- every project so the stored counter is correct going forward.

create or replace function public._next_task_code(p_project uuid)
returns table(code text, seq int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
  v_pcode text;
begin
  update public.projects
     set task_seq = greatest(
                      task_seq,
                      coalesce(
                        (select max(code_seq) from public.tasks where project_id = p_project),
                        0
                      )
                    ) + 1
   where id = p_project
   returning task_seq, project_code into v_seq, v_pcode;
  if v_seq is null then
    raise exception 'project % not found', p_project using errcode = 'P0002';
  end if;
  return query select (coalesce(v_pcode, 'PRJ-?') || '-' || lpad(v_seq::text, 3, '0'))::text, v_seq;
end;
$$;

grant execute on function public._next_task_code(uuid) to authenticated;

-- Reconcile every project's stored counter with reality so the very first
-- insert after this migration is already starting from a safe value.
update public.projects p
   set task_seq = greatest(
                    p.task_seq,
                    coalesce(
                      (select max(t.code_seq) from public.tasks t where t.project_id = p.id),
                      0
                    )
                  );
