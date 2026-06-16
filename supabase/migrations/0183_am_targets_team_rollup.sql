-- 0183_am_targets_team_rollup.sql
--
-- Team-leader & department-manager target rollups, sourced from the sheet's
-- "Acc_Target_Breakdown" tab (the TEAM_TARGET columns to the right of each
-- account-manager's individual target).
--
-- In that tab:
--   • A 🌟-prefixed name is a TEAM LEADER. They carry their own individual
--     target (Total Expected / Actual Achieved) AND a team rollup = the sum of
--     their team members' individual targets (their own individual line is NOT
--     folded into the team rollup; it lands in the department total instead).
--   • One un-starred row with no individual target but a team rollup is the
--     ACCOUNT DEPARTMENT MANAGER — team = the whole department (every AM).
--
-- We store the team rollup on the same am_targets row as the leader/manager's
-- own individual target (they're already employees with a row here). Columns
-- stay null for plain account managers. Mirrors the sheet verbatim per the
-- team's request — no live recompute (the importer fills these on each pull).

alter table public.am_targets
  add column if not exists team_expected numeric,
  add column if not exists team_achieved numeric,
  add column if not exists team_role text
    check (team_role in ('team_lead', 'dept_manager'));

comment on column public.am_targets.team_expected is
  'Sheet TEAM_TARGET Expected — set only on team-lead / dept-manager rows.';
comment on column public.am_targets.team_achieved is
  'Sheet TEAM_TARGET Achieved — set only on team-lead / dept-manager rows.';
comment on column public.am_targets.team_role is
  'team_lead (🌟 in sheet) or dept_manager; null for plain account managers.';
