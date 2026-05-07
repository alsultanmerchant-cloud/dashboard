-- 0061_tasks_search_tsv.sql
-- Full-text search across task title + description, using the built-in
-- 'arabic' text search config. listTasks() previously fell back to ilike on
-- title only, missing matches buried in the description body.

alter table public.tasks
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'arabic',
      coalesce(title, '') || ' ' || coalesce(description, '')
    )
  ) stored;

create index if not exists tasks_search_tsv_idx
  on public.tasks using gin (search_tsv);

comment on column public.tasks.search_tsv is
  'Generated tsvector over title + description (arabic config). Used by listTasks() websearch.';
