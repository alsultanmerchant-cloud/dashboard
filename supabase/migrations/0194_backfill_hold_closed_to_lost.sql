-- 0194_backfill_hold_closed_to_lost.sql
--
-- Sky Light (2026-06-17): a Hold-type contract whose Contract Status (col N) is
-- Closed/Lost is a LOST client (held clients routinely churn to lost; the sheet
-- records it as Type=Hold + Status=Closed while the payment is still chased).
-- The sync now maps that to status='lost' (excel-parser.ts mapStatus). This
-- backfills rows already imported under the old rule (status='hold' but their
-- raw `contract_status_label` is Closed/Lost). Idempotent: once flipped they are
-- no longer status='hold', so a re-run is a no-op. The fixed parser keeps them
-- correct on the next "Pull from Sheet".

update public.contracts
set status = 'lost'
where status = 'hold'
  and lower(coalesce(contract_status_label, '')) in ('closed', 'lost');
