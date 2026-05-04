-- 0033_contract_text_meta.sql
-- The Excel importer brings in 1000+ contracts with Arabic-named account
-- managers and package names that won't always match existing
-- employee_profiles / packages rows. Rather than reject the import or
-- silently null these out, we keep the original strings on the contract
-- so nothing is lost. The structured FKs (account_manager_id, package_id)
-- can be filled in later by a mapping pass.

alter table public.contracts
  add column if not exists account_manager_name text,
  add column if not exists package_name text,
  add column if not exists contract_status_label text;  -- raw status from Excel (e.g. "SOON TO BE Renewed")

-- Idempotent index on the Excel "Key" so re-uploads update in place
create unique index if not exists uq_contracts_external_key
  on public.contracts (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

-- Same idea on clients
create unique index if not exists uq_clients_external_key
  on public.clients (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;
