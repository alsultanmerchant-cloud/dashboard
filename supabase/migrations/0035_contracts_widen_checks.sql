-- 0035_contracts_widen_checks.sql
-- The Excel sheet uses "Sales Deposit" as a target value (clients on the
-- sales-team installment plan) and "expired" as a status. Widen both CHECK
-- constraints so the importer doesn't reject real data.

alter table public.contracts
  drop constraint if exists contracts_target_check;
alter table public.contracts
  add constraint contracts_target_check
  check (target is null or target in (
    'Sales Deposit', 'On-Target', 'Overdue', 'Lost', 'Renewed'
  ));

alter table public.contracts
  drop constraint if exists contracts_status_check;
alter table public.contracts
  add constraint contracts_status_check
  check (status in (
    'active', 'hold', 'lost', 'closed', 'expired', 'renewed'
  ));
