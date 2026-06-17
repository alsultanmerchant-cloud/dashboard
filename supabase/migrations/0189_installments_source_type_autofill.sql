-- 0189_installments_source_type_autofill.sql
--
-- installments.source_type_key (added 0170) classifies each payment's collecting
-- DEPARTMENT for the income engine: 'New' → Sales; Renew/WinBack/UPSELL →
-- Account (see 0168/0172). The manual new-contract action sets it, but the
-- Google-sheet importer never did — and the Installments Tracker tab has no
-- per-row type column to read. So contracts synced from the sheet land with
-- source_type_key = null, which (a) renders the dashboard "installments due"
-- department pill as «—» and (b) silently drops the payment from BOTH the Sales
-- and Account income totals. Example hit: لغة الأرقام (C188), a New contract
-- whose SR 6,000 installment showed no department and wasn't counted as Sales.
--
-- Fix: a trigger that fills source_type_key from the contract's REVENUE type
-- whenever it's null — only when null, so a value already captured from the
-- tracker is preserved (honoring 0170's "use the tracker's type, not the
-- contract's current type" rule through Hold/renewal). For a contract currently
-- typed Hold/Lost (the Hold-erases-type gotcha), we fall back to its
-- type_before_hold so a New-on-hold contract still credits Sales.

create or replace function public.fill_installment_source_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_type_key is null then
    select case
             when ct.key in ('Hold', 'Lost') then ctb.key
             else ct.key
           end
      into new.source_type_key
      from public.contracts c
      left join public.contract_types ct  on ct.id  = c.contract_type_id
      left join public.contract_types ctb on ctb.id = c.type_before_hold_id
     where c.id = new.contract_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_installment_source_type on public.installments;
create trigger trg_fill_installment_source_type
  before insert or update on public.installments
  for each row
  execute function public.fill_installment_source_type();

-- Backfill the rows that slipped through before the trigger existed.
update public.installments i
   set source_type_key = case
                           when ct.key in ('Hold', 'Lost') then ctb.key
                           else ct.key
                         end
  from public.contracts c
  left join public.contract_types ct  on ct.id  = c.contract_type_id
  left join public.contract_types ctb on ctb.id = c.type_before_hold_id
 where i.contract_id = c.id
   and i.source_type_key is null
   and coalesce(
         case when ct.key in ('Hold', 'Lost') then ctb.key else ct.key end,
         ''
       ) <> '';
