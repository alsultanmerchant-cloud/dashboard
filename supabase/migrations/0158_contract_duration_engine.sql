-- 0158_contract_duration_engine.sql
--
-- The sheet's contract-duration formula, ported verbatim (gap G1 in
-- docs/CONTRACTS_GAP_ANALYSIS.md). Reverse-engineered from the ARRAYFORMULA
-- in 'Client''s Contracts'!L3:
--
--   base days =
--     duration = 12 months           → 365
--     duration ≤ 0                   → 0
--     type matches RENEW|WIN[- ]?BACK → months × 30
--     otherwise (New / Upsell / …)   → 37 + (months − 1) × 30
--                                      (new clients get the first week free)
--
--   + service extras (the sheet's "Our Services" Extra Days column):
--     One-Time services (store build, branding…) → added in full
--     Monthly services                            → Σ capped at 15
--
--   + extension_days (manual, already exists)
--
--   expected end = start + total_days − 1
--
-- In the dashboard the sheet's "package chips" are rows in public.packages
-- (joined via contract_packages), so Extra Days / price type live there.

-- 1) Package metadata ---------------------------------------------------------
-- packages.price_type already exists (check constraint: 'Monthly' | 'One-Time')
-- alongside is_renewable. We only add extra_days.

alter table public.packages
  add column if not exists extra_days integer not null default 0;

-- Seed from the sheet's services table (CEO_Dashboared!A2:C23).
-- Idempotent: plain updates keyed on name patterns.
update public.packages set price_type = 'One-Time', extra_days = 15
 where name_ar like '%انشاء متجر سلة%' or name_ar like '%إنشاء متجر سلة%';
update public.packages set price_type = 'One-Time', extra_days = 30
 where name_ar like '%وورد بريس%' or name_ar like '%ووردبريس%';
update public.packages set price_type = 'One-Time', extra_days = 15
 where name_ar like '%انشاء بروفايل%' or name_ar like '%إنشاء بروفايل%';
update public.packages set price_type = 'One-Time', extra_days = 15
 where name_ar like '%براندنج%';
update public.packages set price_type = 'One-Time', extra_days = 15
 where name_ar like '%لاندينج%';
update public.packages set price_type = 'One-Time', extra_days = 15
 where name_ar like '%اعادة التهيئة%' or name_ar like '%إعادة التهيئة%';
update public.packages set price_type = 'One-Time', extra_days = 15
 where name_ar like '%فيديو برومو%';
update public.packages set extra_days = 1
 where name_ar like '%باقة المشاهير%';

-- 2) The engine ----------------------------------------------------------------

create or replace function public.contract_total_days(
  p_type_key    text,
  p_months      integer,
  p_package_ids uuid[]
) returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_base     integer;
  v_onetime  integer := 0;
  v_monthly  integer := 0;
begin
  if p_months is null then
    return null;
  end if;

  if p_months = 12 then
    v_base := 365;
  elsif p_months <= 0 then
    v_base := 0;
  elsif upper(coalesce(p_type_key, '')) ~ 'RENEW|WIN[- _]?BACK' then
    v_base := p_months * 30;
  else
    -- New / Upsell / anything else: first month = 37 days (free week).
    v_base := 37 + (p_months - 1) * 30;
  end if;

  if p_package_ids is not null and array_length(p_package_ids, 1) > 0 then
    select coalesce(sum(extra_days) filter (where price_type = 'One-Time'), 0),
           coalesce(sum(extra_days) filter (where price_type <> 'One-Time'), 0)
      into v_onetime, v_monthly
      from public.packages
     where id = any(p_package_ids);
  end if;

  -- Sheet rule: one-time extras count in full, monthly extras cap at 15.
  return v_base + v_onetime + least(15, v_monthly);
end;
$$;

comment on function public.contract_total_days(text, integer, uuid[]) is
  'Sheet-parity contract duration: 365 @12m; m×30 for Renew/Win-Back; 37+(m−1)×30 otherwise; + one-time package extra_days in full + monthly extras capped at 15.';

-- 3) Recompute RPC — called by createContractAction after the contract and its
--    contract_packages junction rows exist. Sets the expected end date (and
--    pins original_end_date so the 0139 trigger's extension math starts from
--    the engine's baseline).

create or replace function public.recompute_contract_end_date(p_contract uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.contracts%rowtype;
  v_pkgs uuid[];
  v_type text;
  v_days integer;
  v_end  date;
begin
  select * into v_row from public.contracts where id = p_contract;
  if not found or v_row.start_date is null or v_row.duration_months is null then
    return null;
  end if;

  select coalesce(array_agg(package_id), '{}'::uuid[])
    into v_pkgs
    from public.contract_packages
   where contract_id = p_contract;

  -- Fall back to the primary package when the junction is empty.
  if (v_pkgs is null or array_length(v_pkgs, 1) is null)
     and v_row.package_id is not null then
    v_pkgs := array[v_row.package_id];
  end if;

  select key into v_type from public.contract_types where id = v_row.contract_type_id;

  v_days := public.contract_total_days(v_type, v_row.duration_months, v_pkgs);
  if v_days is null then
    return null;
  end if;

  v_end := v_row.start_date + greatest(v_days - 1, 0);

  update public.contracts
     set end_date          = v_end,
         original_end_date = v_end
   where id = p_contract;

  return v_end;
end;
$$;

comment on function public.recompute_contract_end_date(uuid) is
  'Recomputes end_date from the sheet duration engine (contract_total_days). Resets original_end_date — call on create or when type/duration/packages change, NOT after manual extensions.';
