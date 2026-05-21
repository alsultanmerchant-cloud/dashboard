-- Speeds up count queries that filter on (organization_id, archived_at IS NULL).
-- Used heavily on the /tasks page toolbar (totalCount + noDeadlineCount).
-- Index-only scan ~8 ms vs prior seq scan ~31 ms on rawasm-demo (11.9k rows).

create index if not exists idx_tasks_org_active
  on public.tasks (organization_id)
  where archived_at is null;
