-- 0175_contracts_target_by_month.sql
--
-- Mirror the source sheet's col V "Target_ByMonth" — the month-aware contract
-- status the sheet's CEO dashboard computes from. It is only populated for the
-- sheet's currently-selected month (blank for every other month), so it is an
-- audit/reconciliation field, NOT the basis for historical recompute. The
-- engine classifies by expected-end-date vs the selected month (see 0172),
-- which agrees with col V for the current month and works for any month.
--
-- No CHECK constraint: it is a raw mirror that can legitimately be blank.

alter table public.contracts add column if not exists target_by_month text;

comment on column public.contracts.target_by_month is
  'Sheet col V Target_ByMonth: month-aware status, only populated for the sheet''s currently-selected month. Audit/reconciliation mirror; not used for historical recompute.';
