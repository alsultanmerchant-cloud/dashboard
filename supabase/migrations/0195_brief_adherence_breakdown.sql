-- 0195 — Brief-adherence breakdown.
--
-- briefAdherenceScore was stored as a bare 0-100 number, so the UI could show
-- "40%" but never explain WHICH documented brief requirements were/weren't met
-- — and the dashboard assistant had no per-item data to answer "why 40?". The
-- analysis prompt already reasons per brief clause ("link any reduction to a
-- specific brief item"); that reasoning was discarded.
--
-- This adds a jsonb column capturing the per-item breakdown the model now emits:
--   { reason: string, items: [{ requirement, status, note }] }
--   status ∈ delivered | partial | not_delivered | no_evidence
-- NULL when no readable brief document was available (score stays null too).

alter table public.client_satisfaction_analyses
  add column if not exists brief_adherence jsonb;
