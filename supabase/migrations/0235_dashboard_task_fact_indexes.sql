-- Speed up the CEO dashboard executive-indicator fact loader.
-- It reads two task sets: still-open tasks (`completed_at is null`) and tasks
-- completed since the previous comparison window.

create index if not exists idx_tasks_org_open_fact_page
  on public.tasks (organization_id, id)
  where completed_at is null;

create index if not exists idx_tasks_org_completed_fact_window
  on public.tasks (organization_id, completed_at, id)
  where completed_at is not null;
