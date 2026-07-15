-- 0250 — Reconcile tasks.stage_entered_at with the real Odoo transition date
-- =====================================================================
-- The 0059 stage-change trigger stamps `stage_entered_at := now()` whenever a
-- task's stage changes. For dashboard-native moves that is correct. For Odoo
-- tasks it is not: the importer flips the stage 1-3 days AFTER the change
-- actually happened in Odoo, so `stage_entered_at` lands at sync time and the
-- current-stage badge (and the pending_late SLA clock) read short by that lag.
--
-- The genuine Odoo `stage_in_date` is already mirrored into
-- `task_stage_history.entered_at` by the stage-history sync. This function
-- copies that value back onto `tasks.stage_entered_at` for the OPEN history row
-- (exited_at is null), but only when its stage matches the task's current stage
-- so a mid-sync disagreement never silently rewrites the clock.
--
-- Updating only stage_entered_at does NOT re-fire the 0059 trigger (it guards
-- on `new.stage is distinct from old.stage`), so this is side-effect free.
--
-- Called after syncStageHistory on both sync paths (full cron + single-task
-- pull); the tail `select` backfills existing production data once.
-- =====================================================================

create or replace function public.reconcile_stage_entered_at(p_task_ids uuid[] default null)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_n int;
begin
  update public.tasks t
     set stage_entered_at = h.entered_at
    from (
      select distinct on (task_id) task_id, entered_at, to_stage
        from public.task_stage_history
       where exited_at is null
       order by task_id, entered_at desc
    ) h
   where h.task_id = t.id
     and t.external_source = 'odoo'
     and h.to_stage = t.stage
     and t.stage_entered_at is distinct from h.entered_at
     and (p_task_ids is null or t.id = any (p_task_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.reconcile_stage_entered_at(uuid[]) is
  'Copies the real Odoo stage_in_date (task_stage_history open row) back onto tasks.stage_entered_at so stage-dwell matches Rwasem. Pass task ids to scope, or null for a full backfill.';

-- One-time backfill of existing production data.
select public.reconcile_stage_entered_at();
