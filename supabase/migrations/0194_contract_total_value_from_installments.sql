-- 0194_contract_total_value_from_installments.sql
--
-- Sheet parity fix:
-- Clients Contracts.O / "Value of repeated services" and "Next Contract Value"
-- are renewal/requested amounts. They are NOT the total contract value.
--
-- For installment contracts, the full contract value lives on the Installments
-- Tracker as "قيمة العقد بالكامل (بدون ضرائب)"; in the normalized DB we can
-- recover the same value as the sum of expected installment amounts. For
-- complete-payment contracts, the actual paid value is the contract value.

do $$
begin
  update public.contracts c
  set
    total_value = i.expected_total,
    updated_at = now()
  from (
    select
      contract_id,
      sum(expected_amount)::numeric as expected_total
    from public.installments
    where expected_amount > 0
    group by contract_id
  ) i
  where c.id = i.contract_id
    and c.external_source = 'excel-acc-sheet'
    and c.payment_status = 'Installments'
    and i.expected_total > 0
    and c.total_value is distinct from i.expected_total;

  update public.contracts
  set
    total_value = paid_value,
    updated_at = now()
  where external_source = 'excel-acc-sheet'
    and payment_status = 'Complete'
    and paid_value is not null
    and total_value is distinct from paid_value;
end $$;
