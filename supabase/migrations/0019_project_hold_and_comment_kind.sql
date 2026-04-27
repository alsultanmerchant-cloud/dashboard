-- =========================================================================
-- Migration 0019 — Project HOLD audit fields + Log Note comment kind
-- =========================================================================
-- Adds:
--   * projects.hold_reason text + projects.held_at timestamptz so HOLD has a
--     why and a timestamp the dashboard can surface.
--   * task_comments.kind enum ('note','requirements','modification') so the
--     activity feed can pin "Requirements" (initial Specialist brief) and
--     visually group "Modifications" (AM client-change requests) — matching
--     the Sky Light "Log Note" workflow described in the operations manual.
-- All additive + idempotent. Safe to re-run.
-- =========================================================================

-- 1. Project HOLD bookkeeping ------------------------------------------------
alter table public.projects
  add column if not exists hold_reason text,
  add column if not exists held_at timestamptz;

create index if not exists idx_projects_held
  on public.projects(organization_id, held_at)
  where held_at is not null;

-- 2. Comment kind ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_comment_kind') then
    create type public.task_comment_kind as enum (
      'note',
      'requirements',
      'modification'
    );
  end if;
end$$;

alter table public.task_comments
  add column if not exists kind public.task_comment_kind not null default 'note';

create index if not exists idx_task_comments_kind
  on public.task_comments(task_id, kind)
  where kind <> 'note';
