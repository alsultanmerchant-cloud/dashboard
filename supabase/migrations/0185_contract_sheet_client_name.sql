-- 0185_contract_sheet_client_name.sql
-- The sheet can display different row labels for repeated Client IDs
-- (for example the same client split by service/package). `clients.name` is
-- one shared entity name, so preserve the row-level sheet label on contracts.

alter table public.contracts
  add column if not exists sheet_client_name text;

comment on column public.contracts.sheet_client_name is
  'Row-level Client Name as shown in the source contracts sheet. Used for sheet-parity display when repeated Client IDs have service-specific labels.';
