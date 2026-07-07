-- Satisfaction 2.0 — accountability-aware client audit.
-- Adds two frozen-snapshot columns to each satisfaction analysis so the audit
-- (complaint → responsible person/task) is reproducible and history stays
-- truthful (the UI renders from the stored snapshot, not a live recompute):
--   team_context   — the ClientTeamActivitySnapshot fed to the model at run time
--                    (service lines, overdue tasks + executor/AM/stage-owner,
--                     per-person 30-day activity, code-detected gaps).
--   accountability — the validated AI output: each material complaint tied to
--                    the service, the finding, the responsible people (names
--                    drawn from team_context only), and the evidencing tasks.
-- Same pattern as contract_context (0178). Idempotent.

alter table public.client_satisfaction_analyses
  add column if not exists team_context jsonb;

alter table public.client_satisfaction_analyses
  add column if not exists accountability jsonb;

comment on column public.client_satisfaction_analyses.team_context is
  'Frozen ClientTeamActivitySnapshot (services, overdue tasks, people roster, gaps) fed to the model at analysis time.';
comment on column public.client_satisfaction_analyses.accountability is
  'Validated AI accountability output: complaint → service → finding → responsible[] → taskCodes[]. Names/codes validated against team_context roster.';
