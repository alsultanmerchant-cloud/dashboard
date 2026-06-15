-- 0170_installments_source_type.sql
--
-- The income engine must classify each installment's DEPARTMENT (Account vs
-- Sales) by the contract type recorded on the Installments Tracker row (col D),
-- NOT by the contract's current type. Reason: when a contract goes on Hold, our
-- schema overwrites contract_type_id with 'Hold' (the Hold-erases-type gotcha),
-- so a New contract on hold would drop out of the Sales bucket. The sheet reads
-- the tracker's own type column, which preserves New/Renewal/etc. through holds
-- and renewals — so we mirror that by storing it per installment.
--
--   account-credited: Renew (= Renewal/#Renewal#), WinBack, UPSELL (Upsell-Acc)
--   sales-credited:   New (Upsell-Sales folds to UPSELL→Account per owner choice)

alter table public.installments
  add column if not exists source_type_key text;
