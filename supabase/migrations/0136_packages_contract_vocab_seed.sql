-- 0136_packages_contract_vocab_seed.sql
--
-- Seed the `packages` catalog so the contracts UI has the exact set of
-- options the Skylight team uses in their "Clients Contracts" sheet.
--
-- The team's sheet has a free-text "Package" column where rows are either
-- one of 8 named bundles ("نوفا", "باقة فضية", …) or one of 13 atomic add-ons
-- ("حملات", "سوشيال", …) — and combos are written comma-joined. We model
-- every one of those 21 entries as a row in `packages` so the dropdown maps
-- 1:1 with the team's existing vocabulary. Multi-package support (a single
-- contract carrying multiple packages) is a follow-up junction-table change;
-- for now the existing `contracts.package_id` + `package_name` denorm holds.
--
-- Idempotent: re-running this migration is a no-op (matches on
-- organization_id + key). Safe to re-apply after the team adds packages
-- through the UI.
--
-- Background discovery (counts from the live sheet, 194 contract rows):
--   نوفا 51 · حملات 61 · سوشيال 45 · سيو 24 · باقة فضية 14 ·
--   انشاء متجر سلة/زد 11 · ذهبية 8 · انشاء متجر وورد بريس 8 ·
--   براندنج 5 · انشاء بروفايل 5 · تيلي سيلز b2b 5 · تصوير 4 ·
--   🤖شات بوت 4 · اعادة التهيئة 3 · لاندينج بيدج 3 · باقة المشاهير 3 ·
--   موديريشن 2 · باقة تصاميم 1 · حملات lead generation 1 · Growth 1 ·
--   اضافة منتجات 1.

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.packages (organization_id, key, name_ar, active, grace_days)
  values
    -- Named bundles (the team's "باقات" — typically sold as a single SKU)
    (v_org, 'nova',            'نوفا',              true, 5),
    (v_org, 'silver',          'باقة فضية',         true, 5),
    (v_org, 'gold',            'ذهبية',             true, 5),
    (v_org, 'influencers',     'باقة المشاهير',     true, 5),
    (v_org, 'designs',         'باقة تصاميم',       true, 5),
    -- Atomic services (also sold standalone in the sheet; combos are
    -- comma-joined in the source, e.g. "حملات, سوشيال")
    (v_org, 'campaigns',       'حملات',             true, 5),
    (v_org, 'social',          'سوشيال',            true, 5),
    (v_org, 'seo',             'سيو',               true, 5),
    (v_org, 'salla_zid_store', 'انشاء متجر سلة/زد', true, 5),
    (v_org, 'wordpress_store', 'انشاء متجر وورد بريس', true, 5),
    (v_org, 'branding',        'براندنج',           true, 5),
    (v_org, 'profile_create',  'انشاء بروفايل',     true, 5),
    (v_org, 'telesales_b2b',   'تيلي سيلز b2b',     true, 5),
    (v_org, 'photography',     'تصوير',             true, 5),
    (v_org, 'chatbot',         '🤖شات بوت',         true, 5),
    (v_org, 'reonboarding',    'اعادة التهيئة',     true, 5),
    (v_org, 'landing_page',    'لاندينج بيدج',      true, 5),
    (v_org, 'moderation',      'موديريشن',          true, 5),
    (v_org, 'leadgen',         'حملات lead generation', true, 5),
    (v_org, 'growth',          'Growth',            true, 5),
    (v_org, 'add_products',    'اضافة منتجات',      true, 5)
  on conflict (organization_id, key) do update
    set name_ar = excluded.name_ar,
        active  = excluded.active;
end $$;

-- Sanity check: every contract that was imported with a free-text
-- `package_name` like "نوفا" or "حملات, سوشيال" should now be linkable to
-- one of these rows. Backfill `package_id` for the simple single-package
-- case (one of the 21 names appears verbatim in package_name).
-- For comma-joined combos, leave package_id NULL — those need the junction
-- table change in a follow-up migration.
update public.contracts c
   set package_id = p.id
  from public.packages p
 where c.organization_id = p.organization_id
   and c.package_id is null
   and c.package_name is not null
   and btrim(c.package_name) = p.name_ar;
