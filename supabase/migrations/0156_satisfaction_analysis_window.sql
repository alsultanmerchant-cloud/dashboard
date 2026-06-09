-- 0156 Satisfaction analysis time-window.
--
-- The Sky Light team's review (2026-06-09): the satisfaction headline should
-- reflect the client's CURRENT status (last 7 days), not an all-time average
-- that surfaces months-old complaints as if they were live. They also want to
-- look back at how the client was doing in earlier periods.
--
-- Implementation: every analysis row now records the window it covers.
--   window_kind = 'week' → the rolling current-status analysis (feeds the board
--                          + executive index; only this kind sets is_current).
--   window_kind = 'all'  → an on-demand full-history analysis (stored as a
--                          historical snapshot, never is_current).
-- Existing rows were all full-history, so they default to 'all'.

alter table public.client_satisfaction_analyses
  add column if not exists window_kind text not null default 'all'
    check (window_kind in ('week', 'all')),
  add column if not exists window_start timestamptz,
  add column if not exists window_end timestamptz;

-- Reload PostgREST so the new columns are exposed over REST immediately.
notify pgrst, 'reload schema';
