-- 0160_total_days_inclusive.sql
--
-- Sheet parity fix: the sheet's Total Days column is INCLUSIVE
-- (L = Expected End − Start + 1; a 1-month new contract = 37 days,
-- ending day 37). 0139 computed the exclusive diff, so the grid showed 66
-- for a 37+30-day contract. Only the counting convention changes; end-date
-- math (start + days − 1, migration 0158) was already correct.
--
-- Applied to the live project on 2026-06-10. Existing rows keep their
-- imported values until a date edit re-fires the trigger (intentional —
-- we don't churn imported history).

create or replace function public.contracts_recompute_derived()
returns trigger language plpgsql as $$
declare
  v_orig date;
begin
  if (TG_OP = 'INSERT') then
    NEW.original_end_date := coalesce(NEW.original_end_date, NEW.end_date);
  end if;

  -- Total Days — INCLUSIVE like the sheet (L = M − D + 1).
  if NEW.start_date is not null and NEW.end_date is not null then
    NEW.total_days_computed := (NEW.end_date - NEW.start_date)::int + 1;
  else
    NEW.total_days_computed := null;
  end if;

  if NEW.end_date is not null and NEW.actual_end_date is not null then
    if NEW.actual_end_date >= NEW.end_date then
      NEW.delay_days := public.working_days_between(
        NEW.organization_id, NEW.end_date, NEW.actual_end_date);
    else
      NEW.delay_days := 0;
    end if;
  end if;

  v_orig := NEW.original_end_date;
  if v_orig is not null and NEW.end_date is not null and NEW.end_date >= v_orig then
    NEW.extension_days := (NEW.end_date - v_orig)::int;
  end if;

  return NEW;
end $$;
