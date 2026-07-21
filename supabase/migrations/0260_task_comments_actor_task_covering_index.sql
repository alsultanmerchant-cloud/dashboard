-- 0260 — covering index so the accountability silence query stays index-only
-- =========================================================================
-- getAccountabilitySilence counts, per (employee, day), how many authored
-- actions were on a still-LIVE (non-archived) task — the نبض الفريق definition
-- feeding the modal's «إجراءات» cell and actionsInPeriod. That needs each
-- comment's task_id to look up archived status.
--
-- The existing partial index idx_task_comments_org_created_actor covers the
-- (organization_id, created_at) filter and INCLUDEs actor_employee_id, but NOT
-- task_id — so the moment the query joined tasks it fell to a 26k-row heap
-- fetch. On a 90-day window that pushed the query (running alongside five other
-- live accountability queries) past the 12s agent_run_readonly_sql ceiling and
-- tripped the whole page's error boundary.
--
-- Adding task_id to the INCLUDE lets the scan stay index-only; the archived
-- split is then a tiny hash join against the ~1.4k non-archived tasks (90% of
-- tasks here are archived Odoo history). Verified: 90-day silence went from a
-- timeout to ~0.9s, index-only scan.
--
-- Idempotent (`if not exists`).
create index if not exists idx_task_comments_org_created_actor_task
  on public.task_comments (organization_id, created_at)
  include (actor_employee_id, task_id)
  where actor_employee_id is not null;

comment on index public.idx_task_comments_org_created_actor_task is
  'Covering index for the accountability silence/actions query: (org, created_at) filter with actor_employee_id + task_id inlined, so the non-archived-task action count is an index-only scan. See migration 0260.';

analyze public.task_comments;
