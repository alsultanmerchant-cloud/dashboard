-- =========================================================================
-- Migration 0146 — Permission keys for the Head / Team-Leader surfaces
-- =========================================================================
-- The Head/Team-Leader DASHBOARD VIEW is chosen structurally (see
-- getDashboardScope in src/lib/auth-server.ts) and needs no permission.
-- These keys gate only the manual DATA-ENTRY surfaces (attendance, warnings,
-- targets) and their nav items, plus the monthly-closing read.
--
-- There is no `head`/`team_lead` RBAC role in this org — the Head-equivalent
-- is `manager`. We grant to owner/admin/manager. (owner/admin must be granted
-- explicitly: has_permission() reads role_permissions, it has no wildcard.)
-- =========================================================================

insert into public.permissions (key, description) values
  ('attendance.view',          'عرض سجلات الحضور والانصراف'),
  ('attendance.manage',        'تسجيل وتعديل الحضور والانصراف'),
  ('warning.view',             'عرض الإنذارات'),
  ('warning.manage',           'إصدار وتعديل الإنذارات'),
  ('target.view',              'عرض الأهداف الشهرية'),
  ('target.manage',            'تعديل الأهداف الشهرية للموظفين والأقسام'),
  ('department.dashboard.view','عرض لوحة رئيس القسم / قائد الفريق'),
  ('monthly_closing.view',     'عرض تقرير الإقفال الشهري')
on conflict (key) do nothing;

-- View + read keys → owner, admin, manager (Head-equivalent)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager')
  and p.key in (
    'attendance.view', 'attendance.manage',
    'warning.view', 'warning.manage',
    'target.view',
    'department.dashboard.view',
    'monthly_closing.view'
  )
on conflict do nothing;

-- target.manage → owner, admin, manager (Head sets targets)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager')
  and p.key = 'target.manage'
on conflict do nothing;
