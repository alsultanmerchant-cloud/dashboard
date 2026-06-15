-- 0173_contracts_target_normalize.sql
--
-- Normalize the phantom 'On-Target' spelling to 'On Target'. The source sheet's
-- col E (Target) never uses the hyphen variant; it crept in via import and made
-- SQL that filters `target in ('On Target','Overdue')` (0142/0168/0172) and the
-- TS bucket query undercount on-target rows.
--
-- Idempotent: the UPDATE is a no-op once clean; the constraint is dropped and
-- re-added each run.

update public.contracts set target = 'On Target' where target = 'On-Target';

-- Tighten the CHECK constraint: drop the hyphen variant from the allowed set so
-- it cannot be reintroduced.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'contracts_target_check') then
    alter table public.contracts drop constraint contracts_target_check;
  end if;
  alter table public.contracts add constraint contracts_target_check
    check (target is null or target = any (array[
      'Sales Deposit','On Target','Overdue','Lost','Renewed','Closed'
    ]));
end $$;
