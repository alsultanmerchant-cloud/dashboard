-- 0138_contracts_sheet_parity_columns.sql
--
-- Bring the contracts table to feature-parity with the team's "Client's
-- Contracts" sheet so the new grid UI can round-trip every cell without
-- losing data. Seven columns the sheet has but the schema didn't:
--
--   payment_status         'Complete' | 'Installments' (Complete = lump-sum
--                          on contract start; Installments = scheduled
--                          payments tracked in the installments table)
--   renewed_status         'YES' | 'NO' | 'Closed' — set when the cycle
--                          ends; drives the row-color rule in the grid
--                          (NO = dark red, Closed = gray)
--   extension_days         integer — days the contract was extended past
--                          its expected end (Eid holidays, client request)
--   delay_days             integer — days the actual end ran past expected
--   actual_end_date        date — the real close date, distinct from
--                          end_date (which is "expected end") in the
--                          team's mental model. Existing end_date was
--                          populated from "Actual End Date OR Expected End
--                          Date" by the importer; splitting them lets the
--                          UI show both and compute delay_days correctly.
--   next_contract_value    numeric — the value carried into the next
--                          renewal cycle; tracked on the parent row so the
--                          team can see "what we expect this client to be
--                          worth next time" at a glance
--   renewal_paid_value     numeric — amount actually paid when the
--                          renewal landed (0 if not yet renewed)
--   repeated_services_value numeric — recurring monthly revenue, distinct
--                          from total_value which can include one-off
--                          setup fees
--
-- All nullable; existing rows keep working unchanged. Backfill happens
-- via a follow-up data-only pass (not in this migration) because the
-- source values live in the live Google sheet.

alter table public.contracts
  add column if not exists payment_status         text,
  add column if not exists renewed_status         text,
  add column if not exists extension_days         integer,
  add column if not exists delay_days             integer,
  add column if not exists actual_end_date        date,
  add column if not exists next_contract_value    numeric,
  add column if not exists renewal_paid_value     numeric,
  add column if not exists repeated_services_value numeric;

-- Enum-ish constraints (text + check, matching the existing target/status
-- pattern in this codebase) so typos don't sneak in via the API.
alter table public.contracts
  drop constraint if exists contracts_payment_status_check;
alter table public.contracts
  add constraint contracts_payment_status_check
  check (payment_status is null or payment_status in ('Complete', 'Installments'));

alter table public.contracts
  drop constraint if exists contracts_renewed_status_check;
alter table public.contracts
  add constraint contracts_renewed_status_check
  check (renewed_status is null or renewed_status in ('YES', 'NO', 'Closed'));

-- Lightweight indexes for the grid's most common filters.
create index if not exists contracts_renewed_status_idx
  on public.contracts (organization_id, renewed_status);
create index if not exists contracts_payment_status_idx
  on public.contracts (organization_id, payment_status);

-- Comment columns so generated TS types carry intent. (Supabase's type
-- generator picks these up as JSDoc on the Row type.)
comment on column public.contracts.payment_status is
  'Complete = lump-sum at contract start; Installments = scheduled payments.';
comment on column public.contracts.renewed_status is
  'YES = client renewed for next cycle; NO = client lost (drives red row); Closed = ended cleanly (gray row).';
comment on column public.contracts.extension_days is
  'Days the contract was extended past its expected end (e.g. Eid).';
comment on column public.contracts.delay_days is
  'Days actual end ran past expected end (working days; weekends ignored).';
comment on column public.contracts.actual_end_date is
  'Real close date; distinct from end_date (= expected).';
comment on column public.contracts.next_contract_value is
  'Expected value of the upcoming renewal cycle (parent-row denorm).';
comment on column public.contracts.renewal_paid_value is
  'Actual amount paid when the renewal landed (0 if not yet renewed).';
comment on column public.contracts.repeated_services_value is
  'Recurring monthly revenue (excludes one-off setup fees).';
