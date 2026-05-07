-- 0063_seed_saudi_holidays.sql
-- Seeds the Saudi public-sector holidays Sky Light observes.
-- Idempotent via the (organization_id, holiday_date, name) unique constraint.
--
-- Recurring (Gregorian, every year same date):
--   - يوم التأسيس       — Feb 22 (decreed 2022)
--   - يوم العلم          — Mar 11 (since 2023)
--   - اليوم الوطني      — Sep 23 (already seeded by an earlier migration)
--
-- Lunar (year-specific, do NOT mark recurring; add new rows yearly):
--   - 2026 Eid al-Fitr  — Mar 19-22 (private/non-profit, 4 days)
--   - 2026 Eid al-Adha  — May 27-30 (private/non-profit, 4 days, tentative)

insert into public.holidays (organization_id, holiday_date, name, recurring)
select
  (select id from public.organizations where slug = 'rawasm-demo'),
  d.date::date,
  d.name,
  d.recurring
from (values
  -- Recurring
  ('2026-02-22', 'يوم التأسيس', true),
  ('2026-03-11', 'يوم العلم', true),
  -- 2026 Eid al-Fitr
  ('2026-03-19', 'عيد الفطر — اليوم 1', false),
  ('2026-03-20', 'عيد الفطر — اليوم 2', false),
  ('2026-03-21', 'عيد الفطر — اليوم 3', false),
  ('2026-03-22', 'عيد الفطر — اليوم 4', false),
  -- 2026 Eid al-Adha
  ('2026-05-27', 'عيد الأضحى — اليوم 1', false),
  ('2026-05-28', 'عيد الأضحى — اليوم 2', false),
  ('2026-05-29', 'عيد الأضحى — اليوم 3', false),
  ('2026-05-30', 'عيد الأضحى — اليوم 4', false)
) as d(date, name, recurring)
on conflict (organization_id, holiday_date, name) do nothing;
