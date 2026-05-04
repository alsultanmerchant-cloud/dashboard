-- 0036_contracts_target_actual_values.sql
-- After running the seed against the actual Acc SHEET, the target column
-- has 4 real values: "Overdue", "Sales Deposit", "On Target" (no hyphen),
-- and "Closed". Migration 0035 had "On-Target" with a hyphen and was
-- missing "Closed" entirely. Replace the constraint with the real domain.

alter table public.contracts
  drop constraint if exists contracts_target_check;
alter table public.contracts
  add constraint contracts_target_check
  check (target is null or target in (
    'Sales Deposit', 'On Target', 'On-Target', 'Overdue', 'Lost',
    'Renewed', 'Closed'
  ));
