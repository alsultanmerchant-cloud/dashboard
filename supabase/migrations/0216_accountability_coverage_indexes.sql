-- 0216: speed up the accountability coverage query (loadCoverage in
-- src/lib/data/accountability.ts), which intermittently hit the
-- agent_run_readonly_sql statement timeout and tripped the dashboard
-- نبض الفريق (PulseBand) section's error boundary.
--
-- loadCoverage runs several `count(distinct task_id)` subqueries:
--   • over task_stage_history scoped by organization_id
--   • over task_assignees scoped by (organization_id, role_type)
-- The existing indexes (idx_tsh_org = organization_id only; idx_task_assignees_role
-- = organization_id, role_type) don't carry task_id, so each distinct-count had to
-- heap-fetch task_id per row across 37k / 45k rows. Adding task_id as a trailing
-- column lets Postgres satisfy the distinct counts with an index-only scan.
--
-- Plain CREATE INDEX (not CONCURRENTLY): both tables are small (~37k / ~45k rows)
-- so the build + brief write-lock is sub-second on this single-tenant DB.
-- Idempotent.

create index if not exists idx_tsh_org_task
  on public.task_stage_history (organization_id, task_id);

create index if not exists idx_task_assignees_org_role_task
  on public.task_assignees (organization_id, role_type, task_id);
