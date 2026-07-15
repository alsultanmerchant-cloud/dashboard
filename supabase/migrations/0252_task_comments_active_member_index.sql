-- 0252 — Index for dashboard_active_member_count (0251)
-- =====================================================================
-- dashboard_active_member_count() counts distinct actor_employee_id in
-- task_comments over a date window. task_comments has ~90k rows and the only
-- matching indexes are on organization_id alone or on actor_employee_id alone,
-- so the windowed distinct-count fell back to a heap scan and ran ~4s on the
-- /dashboard executive band.
--
-- A partial index on (organization_id, created_at) that INCLUDEs the actor lets
-- the count run as an index-only range scan (org + window), collecting distinct
-- actors without touching the heap. Partial on actor_employee_id IS NOT NULL so
-- it only carries attributed rows.
-- =====================================================================

create index if not exists idx_task_comments_org_created_actor
  on public.task_comments (organization_id, created_at)
  include (actor_employee_id)
  where actor_employee_id is not null;
