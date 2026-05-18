-- 0123_task_sequence.sql
--
-- Sky Light feedback — kanban cards inside a column were not in the same
-- order as Rwasem (the "Done" column read upside-down).
--
-- Rwasem's `project.task` kanban orders each column by
--   `priority desc, sequence asc, date_deadline asc, id desc`.
-- We already store priority / planned_date / external_id; the missing piece
-- is Odoo's manual `sequence` field. Add it so the board can reproduce the
-- exact in-column order. Default 10 mirrors Odoo's own default.

alter table public.tasks
  add column if not exists sequence integer not null default 10;
