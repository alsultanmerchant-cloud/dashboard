-- 0237 Hide non-action departments from نبض الفريق
-- =====================================================================
-- These teams currently do not depend on taking operational actions inside
-- Rwasem, so they should not appear in نبض الفريق department cards or the
-- cross-department employee activity table.
-- =====================================================================
alter table public.departments
  add column if not exists show_in_team_pulse boolean not null default true;

update public.departments
   set show_in_team_pulse = false
 where slug in (
        'sales-group',
        'sales-team',
        'sales',
        'telesales',
        'tele-sales',
        'hr',
        'sl-hr',
        'hr-department',
        'quality-control'
      )
    or trim(name) in (
        'إدارة المبيعات',
        'المبيعات',
        'الموارد البشرية',
        'الموادر البشرية',
        'البيع الهاتفي',
        'ضبط الجودة',
        'SALES'
      );
