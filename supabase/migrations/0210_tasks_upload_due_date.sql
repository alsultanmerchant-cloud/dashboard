-- 0210 — Sky Light feedback ("اليوم — رفع المهام" page was empty): the upload
-- queue only derived an upload date from a template offset
-- (task_template_items.upload_offset_days_before_deadline), which is set on
-- just 13/124 templates — so design/content tasks never surfaced there.
--
-- Add an explicit, per-task upload deadline the specialist can set directly on
-- a task (design/content). `listMyUploadQueue` uses it with precedence over the
-- template-derived date. Nullable; no backfill.
alter table public.tasks
  add column if not exists upload_due_date date;

comment on column public.tasks.upload_due_date is
  'Explicit per-task upload deadline (موعد الرفع) set by the specialist; takes precedence over the template-derived upload date in the uploads queue.';
