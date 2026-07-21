-- 0259 — index for OVERLAP scans of task_stage_history
-- =========================================================================
-- /accountability's period-trend query used to select stage intervals by
-- `entered_at BETWEEN window`, which quietly dropped the longest-held work: an
-- interval entered 13 Jul and exited 21 Jul was invisible to a 14–20 Jul
-- period even though the person held it all week, and anything still OPEN that
-- started before the window never appeared at all. The correct test is overlap:
--     entered_at < period_end  AND  (exited_at is null or exited_at >= period_start)
--
-- That predicate has no supporting index. `exited_at is null` is served by the
-- existing partial idx_tsh_open, but the `exited_at >= period_start` arm forced
-- a full seq scan (~630ms of a ~2s query, on top of the tasks + task_assignees
-- scans). This index lets the planner BitmapOr the two arms instead.
--
-- Idempotent (`if not exists`).
create index if not exists idx_tsh_exited_at
  on public.task_stage_history (exited_at)
  where exited_at is not null;

comment on index public.idx_tsh_exited_at is
  'Serves the exited_at >= period_start arm of the accountability overlap scan; pairs with the partial idx_tsh_open for the exited_at is null arm.';

-- The 0257 is_overdue backfill rewrote a large slice of public.tasks, leaving a
-- stale visibility map — index-only scans on task_assignees were doing 22k heap
-- fetches and the tasks scan ran 3.5x slower than it needed to. Refresh stats
-- and the VM for the tables this page joins.
analyze public.task_stage_history;
analyze public.tasks;
analyze public.task_assignees;
