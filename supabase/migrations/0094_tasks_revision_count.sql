-- 0094 — Sky Light feedback (designer reporting):
-- Mirror Odoo's design count with a paired "revision_count" field so the
-- manager can close the month with two distinct totals per designer:
--   • design_count   — designs produced (already exists from migration 0069)
--   • revision_count — edits/revisions on existing designs
--
-- The /reports page will aggregate both per assignee for a given month so
-- monthly closing matches Rwasem's flow.

alter table public.tasks
  add column if not exists revision_count integer not null default 0;

comment on column public.tasks.revision_count is
  'Designer revision/edit count for this task. Paired with design_count for the monthly closing report.';

-- Composite index so the monthly-totals report (filter by completed_at month)
-- doesn't fall back to a sequential scan. Partial index avoids bloating the
-- table for the vast majority of rows that never get a count set.
create index if not exists idx_tasks_completed_with_counts
  on public.tasks (organization_id, completed_at)
  where completed_at is not null
    and (design_count > 0 or revision_count > 0);
