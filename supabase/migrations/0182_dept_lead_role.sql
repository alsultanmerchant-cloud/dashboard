-- =========================================================================
-- Migration 0182 — DEPARTMENT-LEAD ROLE (Head of Technical / Dept Manager)
-- =========================================================================
-- A single shared access tier for the Head of Technical and the Department
-- Manager. They run everything operational and see ALL performance data plus
-- the contracts roster, but must NOT see financial / secret CEO data:
--   • no finance.view / finance.manage  → /finance, /finance/expenses hidden
--   • no target.view                    → /targets hidden
--   • no settings/org/feature_flag/templates → no system config
-- On the executive dashboard they land on the org-wide CEO (performance) view
-- (see getDashboardScope keying on the `dept_lead` role key), but the CEO brief,
-- P&L summary, and contract-revenue card are gated by finance.view in the UI.
-- Idempotent — mirrors the applied SQL.
-- =========================================================================

-- 1. Role per organization (single-tenant today, loop-safe for the future).
insert into public.roles (organization_id, name, key, description, is_system)
select o.id, 'مدير القسم / رئيس القسم التقني', 'dept_lead',
       'قيادة تشغيلية: كل البيانات التشغيلية والأداء والعقود، دون البيانات المالية أو تحليلات الرئيس التنفيذي',
       true
from public.organizations o
on conflict (organization_id, key) do nothing;

-- 2. Grant the operational + performance + contracts-roster permission set.
--    Explicitly excludes finance.*, target.view, settings.manage, org.manage,
--    feature_flag.manage, templates.manage, category.manage_templates,
--    employees.manage.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = any (array[
  'projects.view', 'projects.manage',
  'tasks.view', 'tasks.manage',
  'clients.view', 'clients.manage',
  'handover.create', 'handover.manage',
  'contract.view',
  'notifications.view',
  'reports.view',
  'people.analytics.view',
  'employees.view',
  'escalation.view_own',
  'governance.view',
  'attendance.view',
  'warning.view'
])
where r.key = 'dept_lead'
on conflict do nothing;
