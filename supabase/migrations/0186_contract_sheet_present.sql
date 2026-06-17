-- 0186_contract_sheet_present.sql
-- Sheet membership flag for the contracts grid.
--
-- The Google-sheet sync UPSERTS contracts by external_id (`Client ID|startdate`)
-- but never removed rows that disappear from the sheet — e.g. when a client
-- renews, their start date changes, a NEW external_id is written, and the OLD
-- version lingers in the DB forever. That made the grid over-count vs the sheet
-- (the sheet keeps one live row per client; the DB accumulated every version).
--
-- `sheet_present` mirrors "is this contract still a row in the source sheet?".
-- The sync sets it true for every row in the latest pull and false for the rest
-- (sheet-sourced rows only). The sheet-parity grid shows only present rows, so
-- its counts match the sheet exactly, while archived versions stay in the DB for
-- the contract detail page / installment history.

alter table public.contracts
  add column if not exists sheet_present boolean not null default true;

comment on column public.contracts.sheet_present is
  'True when the contract is still a row in the source Google sheet. Maintained by the sheet sync; the contracts grid hides rows where this is false (archived historical versions, e.g. pre-renewal contracts whose Client ID|start_date key was overwritten).';

-- Partial index: the grid always filters to present rows.
create index if not exists contracts_sheet_present_idx
  on public.contracts (organization_id)
  where sheet_present;
