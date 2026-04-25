-- 0006_seed.sql
-- Seed data for the Rawasm Demo Agency single-tenant MVP.

-- =========================================================================
-- Organization
-- =========================================================================
insert into public.organizations (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'وكالة رواسم — العرض التجريبي', 'rawasm-demo')
on conflict (slug) do nothing;

-- =========================================================================
-- Departments
-- =========================================================================
insert into public.departments (organization_id, name, slug, description) values
  ('11111111-1111-1111-1111-111111111111', 'الإدارة العامة', 'management', 'الإدارة التنفيذية للوكالة'),
  ('11111111-1111-1111-1111-111111111111', 'المبيعات', 'sales', 'فريق المبيعات الميداني'),
  ('11111111-1111-1111-1111-111111111111', 'تيلي سيلز', 'tele-sales', 'فريق المبيعات الهاتفية'),
  ('11111111-1111-1111-1111-111111111111', 'إدارة الحسابات', 'account-management', 'مديرو الحسابات وفريق إدارة المشاريع'),
  ('11111111-1111-1111-1111-111111111111', 'السوشيال ميديا', 'social-media', 'إدارة منصات التواصل الاجتماعي'),
  ('11111111-1111-1111-1111-111111111111', 'تحسين محركات البحث', 'seo', 'فريق SEO'),
  ('11111111-1111-1111-1111-111111111111', 'الإعلانات الممولة', 'media-buying', 'فريق Media Buying'),
  ('11111111-1111-1111-1111-111111111111', 'التصميم الجرافيكي', 'graphic-design', 'فريق التصميم'),
  ('11111111-1111-1111-1111-111111111111', 'الموارد البشرية', 'hr', 'الموارد البشرية والشؤون الإدارية'),
  ('11111111-1111-1111-1111-111111111111', 'المالية', 'finance', 'الإدارة المالية والمحاسبة')
on conflict (organization_id, slug) do nothing;

-- =========================================================================
-- Services
-- =========================================================================
insert into public.services (id, organization_id, name, slug, description) values
  ('22222222-1111-1111-1111-000000000001', '11111111-1111-1111-1111-111111111111', 'إدارة منصات التواصل الاجتماعي', 'social-media-management', 'إدارة شاملة لحسابات العميل على منصات التواصل الاجتماعي'),
  ('22222222-1111-1111-1111-000000000002', '11111111-1111-1111-1111-111111111111', 'تحسين محركات البحث', 'seo', 'تدقيق وتحسين تقني وكتابة محتوى وروابط خلفية'),
  ('22222222-1111-1111-1111-000000000003', '11111111-1111-1111-1111-111111111111', 'الإعلانات الممولة', 'media-buying', 'إنشاء وإدارة الحملات الإعلانية الممولة')
on conflict (organization_id, slug) do nothing;

-- =========================================================================
-- Permissions catalog
-- =========================================================================
insert into public.permissions (key, description) values
  ('org.view', 'عرض إعدادات المنظمة'),
  ('org.manage', 'إدارة إعدادات المنظمة'),
  ('employees.view', 'عرض الموظفين'),
  ('employees.manage', 'إدارة الموظفين'),
  ('clients.view', 'عرض العملاء'),
  ('clients.manage', 'إدارة العملاء'),
  ('projects.view', 'عرض المشاريع'),
  ('projects.manage', 'إدارة المشاريع'),
  ('tasks.view', 'عرض المهام'),
  ('tasks.manage', 'إدارة المهام'),
  ('handover.create', 'إرسال نموذج تسليم من المبيعات'),
  ('handover.manage', 'إدارة نماذج التسليم'),
  ('notifications.view', 'عرض التنبيهات'),
  ('reports.view', 'عرض التقارير'),
  ('settings.manage', 'إدارة إعدادات النظام'),
  ('templates.manage', 'إدارة قوالب المهام')
on conflict (key) do nothing;

-- =========================================================================
-- Roles
-- =========================================================================
insert into public.roles (id, organization_id, name, key, description, is_system) values
  ('33333333-1111-1111-1111-000000000001', '11111111-1111-1111-1111-111111111111', 'المالك', 'owner', 'الصلاحية الكاملة على النظام', true),
  ('33333333-1111-1111-1111-000000000002', '11111111-1111-1111-1111-111111111111', 'مسؤول النظام', 'admin', 'إدارة شاملة باستثناء بعض إعدادات المالك', true),
  ('33333333-1111-1111-1111-000000000003', '11111111-1111-1111-1111-111111111111', 'مدير', 'manager', 'إدارة الفرق والمشاريع', true),
  ('33333333-1111-1111-1111-000000000004', '11111111-1111-1111-1111-111111111111', 'مبيعات', 'sales', 'فريق المبيعات وتسليم العملاء', true),
  ('33333333-1111-1111-1111-000000000005', '11111111-1111-1111-1111-111111111111', 'مدير حساب', 'account_manager', 'إدارة الحسابات والمشاريع', true),
  ('33333333-1111-1111-1111-000000000006', '11111111-1111-1111-1111-111111111111', 'متخصص', 'specialist', 'تنفيذ المهام التشغيلية', true),
  ('33333333-1111-1111-1111-000000000007', '11111111-1111-1111-1111-111111111111', 'مصمم', 'designer', 'فريق التصميم الجرافيكي', true),
  ('33333333-1111-1111-1111-000000000008', '11111111-1111-1111-1111-111111111111', 'قارئ فقط', 'viewer', 'صلاحيات قراءة فقط', true)
on conflict (organization_id, key) do nothing;

-- =========================================================================
-- Role <-> Permission matrix
-- =========================================================================
-- owner: all permissions
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000001', p.id from public.permissions p
on conflict do nothing;

-- admin: all except some settings if needed (full for MVP)
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000002', p.id from public.permissions p
on conflict do nothing;

-- manager
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000003', p.id from public.permissions p
where p.key in (
  'employees.view','clients.view','clients.manage','projects.view','projects.manage',
  'tasks.view','tasks.manage','handover.manage','notifications.view','reports.view','templates.manage'
)
on conflict do nothing;

-- sales
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000004', p.id from public.permissions p
where p.key in (
  'clients.view','clients.manage','projects.view','tasks.view',
  'handover.create','notifications.view'
)
on conflict do nothing;

-- account_manager
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000005', p.id from public.permissions p
where p.key in (
  'clients.view','clients.manage','projects.view','projects.manage',
  'tasks.view','tasks.manage','handover.manage','notifications.view'
)
on conflict do nothing;

-- specialist
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000006', p.id from public.permissions p
where p.key in (
  'projects.view','tasks.view','tasks.manage','notifications.view'
)
on conflict do nothing;

-- designer
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000007', p.id from public.permissions p
where p.key in (
  'projects.view','tasks.view','tasks.manage','notifications.view'
)
on conflict do nothing;

-- viewer
insert into public.role_permissions (role_id, permission_id)
select '33333333-1111-1111-1111-000000000008', p.id from public.permissions p
where p.key in (
  'employees.view','clients.view','projects.view','tasks.view','notifications.view','reports.view'
)
on conflict do nothing;

-- =========================================================================
-- Task templates — Social Media Management
-- =========================================================================
insert into public.task_templates (id, organization_id, service_id, name, description) values
  ('44444444-1111-1111-1111-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-1111-1111-1111-000000000001', 'سير عمل إدارة السوشيال ميديا', 'تسلسل المهام الافتراضي لكل مشروع سوشيال ميديا')
on conflict (id) do nothing;

insert into public.task_template_items (organization_id, task_template_id, title, description, default_role_key, offset_days_from_project_start, duration_days, priority, order_index) values
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','تهيئة العميل (Onboarding)','جمع البيانات والوصول وأسلوب العلامة','account_manager',0,2,'high',1),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','استراتيجية المحتوى','وضع خطة المحتوى الشهرية','specialist',1,2,'high',2),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','كتابة المحتوى','إنتاج النصوص والكابشن','specialist',2,2,'medium',3),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','اعتماد المحتوى','مراجعة وتأكيد العميل','account_manager',3,1,'medium',4),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','طلب التصاميم','تسليم بريف للمصممين','specialist',4,2,'medium',5),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','تسليم التصاميم','استلام التصاميم النهائية','designer',6,1,'medium',6),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','جدولة المنشورات','جدولة المنشورات على المنصات','specialist',7,1,'medium',7),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000001','التقرير الشهري','إعداد تقرير الأداء الشهري','specialist',30,1,'high',8)
on conflict do nothing;

-- =========================================================================
-- Task templates — Media Buying
-- =========================================================================
insert into public.task_templates (id, organization_id, service_id, name, description) values
  ('44444444-1111-1111-1111-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-1111-1111-1111-000000000003', 'سير عمل الإعلانات الممولة', 'تسلسل المهام الافتراضي لكل مشروع Media Buying')
on conflict (id) do nothing;

insert into public.task_template_items (organization_id, task_template_id, title, description, default_role_key, offset_days_from_project_start, duration_days, priority, order_index) values
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','الوصول للحسابات الإعلانية','استلام صلاحيات Meta و Google وغيرها','account_manager',0,1,'high',1),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','إعداد البيكسل والتتبع','تثبيت بيكسل ميتا و Google Tag','specialist',1,2,'high',2),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','استراتيجية الحملة','تحديد الجمهور والميزانية والأهداف','specialist',2,2,'high',3),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','طلب المواد الإبداعية','بريف للتصاميم والفيديوهات','specialist',3,2,'medium',4),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','إطلاق الحملة','رفع الحملة وبدء البث','specialist',5,1,'urgent',5),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','مراجعة وتحسين','مراجعة الأداء وتحسين الإعلانات','specialist',8,1,'high',6),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000002','تقرير الأداء الأسبوعي','تقرير أداء الحملة','specialist',7,1,'high',7)
on conflict do nothing;

-- =========================================================================
-- Task templates — SEO
-- =========================================================================
insert into public.task_templates (id, organization_id, service_id, name, description) values
  ('44444444-1111-1111-1111-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-1111-1111-1111-000000000002', 'سير عمل تحسين محركات البحث', 'تسلسل المهام الافتراضي لكل مشروع SEO')
on conflict (id) do nothing;

insert into public.task_template_items (organization_id, task_template_id, title, description, default_role_key, offset_days_from_project_start, duration_days, priority, order_index) values
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','جمع صلاحيات الموقع','الحصول على وصول للموقع وأدوات التحليل','account_manager',0,2,'high',1),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','تدقيق تقني للموقع','مراجعة بنية الموقع والأداء','specialist',3,3,'high',2),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','بحث الكلمات المفتاحية','تحديد الكلمات المستهدفة','specialist',4,3,'high',3),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','تحسين الصفحات','On-page SEO للصفحات الأساسية','specialist',7,4,'medium',4),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','خطة المحتوى','جدول محتوى تحريري','specialist',10,4,'medium',5),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','خطة الروابط الخلفية','استراتيجية بناء الروابط','specialist',14,5,'medium',6),
  ('11111111-1111-1111-1111-111111111111','44444444-1111-1111-1111-000000000003','تقرير SEO الشهري','تقرير أداء شامل','specialist',30,1,'high',7)
on conflict do nothing;
