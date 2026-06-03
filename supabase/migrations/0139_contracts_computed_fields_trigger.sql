-- 0139_contracts_computed_fields_trigger.sql
--
-- "Computed columns" so the sheet's derived numbers can never drift.
--
-- The Skylight sheet had three derived columns the team kept by hand:
--   Total Days        = end_date − start_date (calendar days)
--   Delays            = actual_end_date − end_date (working days, +ve)
--   Extention period  = end_date − original_end_date (Eid extensions etc.)
--
-- After cutover, the team is editing dates in the dashboard — so these
-- should refresh on every write, not be cached values someone can edit
-- out of sync. We implement them with a BEFORE INSERT/UPDATE trigger
-- that overwrites the three columns whenever any of the source dates
-- changes. The trigger uses the existing `working_days_between` helper
-- (migration 0055) for the Saudi working calendar.
--
-- Note: extension_days requires an "original" end date. We don't store
-- that explicitly today; instead we treat the FIRST end_date as the
-- baseline by capturing it on insert into a new contracts.original_end_date
-- column. Subsequent updates to end_date set extension_days = new − original.
-- If the team needs more sophistication (multiple extensions, each tracked),
-- that's a follow-up using contract_events instead of a single int.

alter table public.contracts
  add column if not exists original_end_date date;

-- Backfill: every existing row's original_end_date = current end_date
-- (best approximation now that we've already imported the data).
update public.contracts
   set original_end_date = end_date
 where original_end_date is null
   and end_date is not null;

create or replace function public.contracts_recompute_derived()
returns trigger language plpgsql as $$
declare
  v_orig date;
begin
  -- On insert, capture original_end_date.
  if (TG_OP = 'INSERT') then
    NEW.original_end_date := coalesce(NEW.original_end_date, NEW.end_date);
  end if;

  -- Total Days — simple calendar diff. Null-safe.
  if NEW.start_date is not null and NEW.end_date is not null then
    NEW.total_days_computed := (NEW.end_date - NEW.start_date)::int;
  else
    NEW.total_days_computed := null;
  end if;

  -- Delay days — working days between expected end and actual end.
  -- 0 (not null) when actual <= expected so the dashboard pill stays
  -- "no delay" rather than blank.
  if NEW.end_date is not null and NEW.actual_end_date is not null then
    if NEW.actual_end_date >= NEW.end_date then
      NEW.delay_days := public.working_days_between(
        NEW.organization_id, NEW.end_date, NEW.actual_end_date);
    else
      NEW.delay_days := 0;
    end if;
  end if;

  -- Extension days — calendar days the expected end was pushed forward
  -- from its original baseline. Captures Eid extensions and explicit
  -- team-grants. Stays null if we don't have a baseline.
  v_orig := NEW.original_end_date;
  if v_orig is not null and NEW.end_date is not null and NEW.end_date >= v_orig then
    NEW.extension_days := (NEW.end_date - v_orig)::int;
  end if;

  return NEW;
end $$;

drop trigger if exists trg_contracts_recompute_derived on public.contracts;
create trigger trg_contracts_recompute_derived
  before insert or update of start_date, end_date, actual_end_date, original_end_date
  on public.contracts
  for each row
  execute function public.contracts_recompute_derived();

-- Force a one-time recompute on the existing 197 rows so they reflect the
-- new formulas (the imported delay_days / extension_days were hand-entered
-- numbers from the sheet, some of which were stale).
update public.contracts
   set start_date = start_date
 where end_date is not null
    or actual_end_date is not null;

-- Helpful read-only comments so the team understands why these are
-- not directly editable from the grid.
comment on column public.contracts.total_days_computed is
  'Derived: end_date - start_date (calendar days). Maintained by trigger; do not edit directly.';
comment on column public.contracts.delay_days is
  'Derived: working days actual_end_date is past end_date. 0 means no delay. Maintained by trigger.';
comment on column public.contracts.extension_days is
  'Derived: calendar days end_date moved past original_end_date. Maintained by trigger.';
comment on column public.contracts.original_end_date is
  'Baseline end_date captured on insert. Drives extension_days calculation.';
