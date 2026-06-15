-- 0180_dashboard_roster_overview.sql
--
-- The CEO dashboard's top "Current Client Status" strip showed a LIVE Supabase
-- roster count (get_contracts_roster) that didn't match the sheet's
-- "Client Status Overview (Today)" block (e.g. live 102/65 vs sheet 85/57).
-- Per the parity decision (import the sheet's computed numbers, don't re-derive),
-- the sheet pull now stores that overview here, frozen with the rest of the
-- month's CEO numbers. cnt_total_clients already existed; these add the by-type
-- breakdown the strip renders.
--
-- Additive + nullable-with-default, so existing rows are unaffected.

alter table public.monthly_dashboard_totals
  add column if not exists cnt_roster_new      integer not null default 0,
  add column if not exists cnt_roster_renew    integer not null default 0,
  add column if not exists cnt_roster_hold     integer not null default 0,
  add column if not exists cnt_roster_upsell   integer not null default 0,
  add column if not exists cnt_roster_winback  integer not null default 0;

comment on column public.monthly_dashboard_totals.cnt_roster_new is
  'Sheet "Client Status Overview" New Contracts count (captured at pull). See 0180.';
