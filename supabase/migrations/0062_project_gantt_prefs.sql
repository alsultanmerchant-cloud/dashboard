-- 0062_project_gantt_prefs.sql
-- Per-project tunable knobs for the SVG Gantt at /projects/[id]/gantt.
-- Stored as a JSONB blob so future toggles don't require new columns.
-- Recognised keys (all optional, defaults applied client-side):
--   show_today_line       boolean   — red 'today' marker
--   show_dependency_arrows boolean  — FS/SS/FF/SF link arrows
--   show_weekend_shading  boolean   — tint columns for days in weekend_days
--   weekend_days          string[]  — subset of {sun,mon,tue,wed,thu,fri,sat}

alter table public.projects
  add column if not exists gantt_prefs jsonb not null default '{}'::jsonb;

comment on column public.projects.gantt_prefs is
  'Per-project Gantt rendering toggles (see migration 0062 for recognised keys).';
