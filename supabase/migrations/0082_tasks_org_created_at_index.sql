-- Tasks list (and the tasks page) sorts by created_at DESC scoped to
-- organization_id. Without a matching index, the planner does a seq scan +
-- top-N heapsort on the whole tasks table (~9ms today, scales linearly with
-- row count). This btree on (organization_id, created_at desc) lets the
-- limit-200 read use a plain index scan (~0.5ms).
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction; the migration
-- runner already executes each file as its own statement, so plain DDL is
-- fine here. Keep it idempotent for re-runs.
create index if not exists idx_tasks_org_created_at
  on public.tasks (organization_id, created_at desc);
