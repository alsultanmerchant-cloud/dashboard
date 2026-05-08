-- 0068b_project_comments_external_uniq_full.sql
-- Replace the partial unique index from 0068 with a full one. PostgREST's
-- ON CONFLICT requires a full unique index (NULLS DISTINCT is fine), so
-- the partial index doesn't satisfy the upsert call from sync-project-chatter.
drop index if exists public.project_comments_external_uniq;
create unique index if not exists project_comments_external_uniq
  on public.project_comments(organization_id, external_source, external_id);
