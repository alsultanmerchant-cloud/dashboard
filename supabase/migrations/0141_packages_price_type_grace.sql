-- 0141_packages_price_type_grace.sql
--
-- Foundation for the monthly target engine: capture each service's
-- Price-Type (Monthly vs One-Time) and per-service grace days, straight
-- from the team's "Our Services" catalog (TARGET_CONTRACTS tab cols A-C).
--
-- WHY THIS MATTERS:
--   * Monthly services (نوفا، حملات، سوشيال، سيو…) renew — they belong in
--     the "expected to renew" target pool.
--   * One-Time services (انشاء متجر، براندنج، لاندينج، تصوير…) do NOT renew
--     — a contract that is purely One-Time must never count toward a future
--     renewal target, or the CEO's expected-revenue number is inflated.
--
-- The packages table already has `grace_days` (defaulted to 5 in seed 0136).
-- This migration:
--   1. adds `price_type` (text check Monthly|One-Time, default Monthly)
--   2. overwrites grace_days + price_type with the catalog's real values
--   3. adds an `is_renewable` generated column = (price_type = 'Monthly')
--      so downstream queries read intent without re-deriving.

alter table public.packages
  add column if not exists price_type text not null default 'Monthly';

alter table public.packages
  drop constraint if exists packages_price_type_check;
alter table public.packages
  add constraint packages_price_type_check
  check (price_type in ('Monthly', 'One-Time'));

-- Generated convenience column. STORED so it can be indexed/filtered.
alter table public.packages
  drop column if exists is_renewable;
alter table public.packages
  add column is_renewable boolean
  generated always as (price_type = 'Monthly') stored;

-- Apply the real catalog values, matched by name_ar. Names not present in
-- the catalog keep their defaults (Monthly, grace 5).
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
begin
  update public.packages p set price_type = v.ptype, grace_days = v.grace
  from (values
    ('نوفا',                'Monthly',  0),
    ('ذهبية',               'Monthly',  0),
    ('حملات',               'Monthly',  0),
    ('سوشيال',              'Monthly',  0),
    ('سيو',                 'Monthly',  0),
    ('انشاء متجر سلة/زد',   'One-Time', 15),
    ('انشاء بروفايل',       'One-Time', 15),
    ('Growth',              'Monthly',  0),
    ('🤖شات بوت',           'Monthly',  0),
    ('انشاء متجر وورد بريس','One-Time', 30),
    ('باقة المشاهير',       'Monthly',  1),
    ('اعادة التهيئة',       'One-Time', 15),
    ('باقة تصاميم',         'Monthly',  0),
    ('باقة فضية',           'Monthly',  0),
    ('براندنج',             'One-Time', 15),
    ('لاندينج بيدج',        'One-Time', 15),
    ('موديريشن',            'Monthly',  0),
    ('حملات lead generation','Monthly', 0),
    ('تيلي سيلز b2b',       'Monthly',  0),
    ('تصوير',               'One-Time', 0),
    ('اضافة منتجات',        'One-Time', 15)
  ) as v(name_ar, ptype, grace)
  where p.organization_id = v_org
    and p.name_ar = v.name_ar;
end $$;

comment on column public.packages.price_type is
  'Monthly = recurring/renewable service; One-Time = setup/non-renewable. From the team Our-Services catalog.';
comment on column public.packages.is_renewable is
  'Generated: true when price_type = Monthly. Drives the renewal target pool.';
