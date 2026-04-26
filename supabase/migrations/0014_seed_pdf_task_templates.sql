-- 0014_seed_pdf_task_templates.sql
--
-- Replace the generic placeholder task_template_items seeded in 0006/0009
-- with items that match the Sky Light operations PDF (pages 21-22):
-- specifically the upload-offset rules per service and the weekly
-- batching for social-media-management.
--
-- Source: /Users/mahmoudmac/Downloads/النظام التشغيلي وإدارة سير العمل
-- للمتدربين في شركة سكاي لايت.pdf
--
-- The PDF defines what the Specialist must "upload" (rfa3) into the
-- task's Log Note before the contract Deadline. We encode that as
-- upload_offset_days_before_deadline. week_index lets us split the
-- monthly Social Media work into 3 weekly batches as the manual
-- describes.

do $do$
declare
  v_org uuid;
  v_tmpl_sm uuid;
  v_tmpl_mb uuid;
  v_tmpl_seo uuid;
  v_dept_sm uuid;
  v_dept_mb uuid;
  v_dept_seo uuid;
  v_dept_design uuid;
  v_dept_am uuid;
begin
  -- Resolve the single tenant + key departments. Future multi-tenant
  -- deployments would replace this with a per-org loop.
  select id into v_org from public.organizations where slug = 'rawasm-demo';
  if v_org is null then
    raise notice 'rawasm-demo org not found; skipping seed';
    return;
  end if;

  select id into v_dept_sm from public.departments
    where organization_id = v_org and slug = 'social-media';
  select id into v_dept_mb from public.departments
    where organization_id = v_org and slug = 'media-buying';
  select id into v_dept_seo from public.departments
    where organization_id = v_org and slug = 'seo';
  select id into v_dept_design from public.departments
    where organization_id = v_org and slug = 'graphic-design';
  select id into v_dept_am from public.departments
    where organization_id = v_org and slug = 'account-management';

  -- Resolve templates by service slug.
  select tt.id into v_tmpl_sm
    from public.task_templates tt
    join public.services s on s.id = tt.service_id
    where tt.organization_id = v_org and s.slug = 'social-media-management';
  select tt.id into v_tmpl_mb
    from public.task_templates tt
    join public.services s on s.id = tt.service_id
    where tt.organization_id = v_org and s.slug = 'media-buying';
  select tt.id into v_tmpl_seo
    from public.task_templates tt
    join public.services s on s.id = tt.service_id
    where tt.organization_id = v_org and s.slug = 'seo';

  -- Wipe placeholder items so we can re-seed cleanly. Tasks already
  -- created from these template items are preserved (FK is set null on
  -- delete in the schema).
  delete from public.task_template_items
   where organization_id = v_org
     and task_template_id in (v_tmpl_sm, v_tmpl_mb, v_tmpl_seo);

  -- ============================================================
  -- MEDIA BUYING — PDF page 22
  -- "كتابة المحتوى → ميديا باينج: قبل الديدلاين بيومين"
  -- "الجرافيك → ميديا باينج: قبل الديدلاين بـ 3 أيام"
  -- ============================================================
  insert into public.task_template_items
    (organization_id, task_template_id, title, default_department_id,
     default_role_key, duration_days, upload_offset_days_before_deadline,
     week_index, order_index, priority)
  values
    (v_org, v_tmpl_mb, 'الوصول للحسابات الإعلانية',
     v_dept_am, 'account_manager', 1, null, null, 1, 'medium'),
    (v_org, v_tmpl_mb, 'إعداد البيكسل والتتبع',
     v_dept_mb, 'specialist', 2, null, null, 2, 'high'),
    (v_org, v_tmpl_mb, 'استراتيجية الحملة',
     v_dept_mb, 'specialist', 2, null, null, 3, 'high'),
    (v_org, v_tmpl_mb, 'كتابة المحتوى الإعلاني',
     v_dept_mb, 'specialist', 2, 2, null, 4, 'high'),
    (v_org, v_tmpl_mb, 'تصميم المواد الإبداعية',
     v_dept_design, 'agent', 3, 3, null, 5, 'high'),
    (v_org, v_tmpl_mb, 'إطلاق الحملة',
     v_dept_mb, 'specialist', 1, null, null, 6, 'urgent'),
    (v_org, v_tmpl_mb, 'مراجعة وتحسين',
     v_dept_mb, 'specialist', 2, null, null, 7, 'medium'),
    (v_org, v_tmpl_mb, 'تقرير الأداء الأسبوعي',
     v_dept_mb, 'specialist', 1, null, null, 8, 'medium');

  -- ============================================================
  -- SOCIAL MEDIA — PDF pages 21-22
  -- 3 weekly batches × {writing, design}
  -- Writing offsets:  W1=2, W2=3, W3=4
  -- Design offsets:   W1=3, W2=4, W3=5
  -- Stories/videos: 4 days before deadline
  -- ============================================================
  insert into public.task_template_items
    (organization_id, task_template_id, title, default_department_id,
     default_role_key, duration_days, upload_offset_days_before_deadline,
     week_index, order_index, priority)
  values
    (v_org, v_tmpl_sm, 'تهيئة العميل (Onboarding)',
     v_dept_am, 'account_manager', 2, null, null, 1, 'medium'),
    (v_org, v_tmpl_sm, 'استراتيجية المحتوى الشهرية',
     v_dept_sm, 'specialist', 3, null, null, 2, 'high'),

    (v_org, v_tmpl_sm, 'كتابة محتوى الأسبوع الأول',
     v_dept_sm, 'specialist', 2, 2, 1, 3, 'high'),
    (v_org, v_tmpl_sm, 'تصميم الأسبوع الأول',
     v_dept_design, 'agent', 2, 3, 1, 4, 'high'),

    (v_org, v_tmpl_sm, 'كتابة محتوى الأسبوع الثاني',
     v_dept_sm, 'specialist', 2, 3, 2, 5, 'high'),
    (v_org, v_tmpl_sm, 'تصميم الأسبوع الثاني',
     v_dept_design, 'agent', 2, 4, 2, 6, 'high'),

    (v_org, v_tmpl_sm, 'كتابة محتوى الأسبوع الثالث',
     v_dept_sm, 'specialist', 2, 4, 3, 7, 'high'),
    (v_org, v_tmpl_sm, 'تصميم الأسبوع الثالث',
     v_dept_design, 'agent', 2, 5, 3, 8, 'high'),

    (v_org, v_tmpl_sm, 'استوريز / فيديوهات',
     v_dept_design, 'agent', 3, 4, null, 9, 'medium'),
    (v_org, v_tmpl_sm, 'اعتماد المحتوى الشهري',
     v_dept_am, 'account_manager', 1, null, null, 10, 'medium'),
    (v_org, v_tmpl_sm, 'جدولة المنشورات',
     v_dept_sm, 'specialist', 1, null, null, 11, 'medium'),
    (v_org, v_tmpl_sm, 'التقرير الشهري',
     v_dept_sm, 'specialist', 1, null, null, 12, 'medium');

  -- ============================================================
  -- SEO — PDF page 22
  -- "محتوى المنتجات والمقالات: نفس يوم الديدلاين الخاص بمهمتي
  --  الكلمات المفتاحية" (offset = 0 for content)
  -- "تصميم بنرات الواجهة: قبل الديدلاين بـ 4 أيام"
  -- "تصميم بنرات المقالات: قبل الديدلاين بـ 5 أيام"
  -- ============================================================
  insert into public.task_template_items
    (organization_id, task_template_id, title, default_department_id,
     default_role_key, duration_days, upload_offset_days_before_deadline,
     week_index, order_index, priority)
  values
    (v_org, v_tmpl_seo, 'جمع صلاحيات الموقع',
     v_dept_am, 'account_manager', 2, null, null, 1, 'medium'),
    (v_org, v_tmpl_seo, 'تدقيق تقني للموقع',
     v_dept_seo, 'specialist', 3, null, null, 2, 'high'),
    (v_org, v_tmpl_seo, 'بحث الكلمات المفتاحية — 30 منتج',
     v_dept_seo, 'specialist', 3, null, null, 3, 'high'),
    (v_org, v_tmpl_seo, 'بحث الكلمات المفتاحية — 10 مقالات',
     v_dept_seo, 'specialist', 3, null, null, 4, 'high'),
    (v_org, v_tmpl_seo, 'كتابة محتوى المنتجات',
     v_dept_seo, 'specialist', 5, 0, null, 5, 'high'),
    (v_org, v_tmpl_seo, 'كتابة محتوى المقالات',
     v_dept_seo, 'specialist', 5, 0, null, 6, 'high'),
    (v_org, v_tmpl_seo, 'تصميم بنرات الواجهة',
     v_dept_design, 'agent', 3, 4, null, 7, 'high'),
    (v_org, v_tmpl_seo, 'تصميم بنرات المقالات',
     v_dept_design, 'agent', 4, 5, null, 8, 'high'),
    (v_org, v_tmpl_seo, 'تحسين الصفحات (On-Page)',
     v_dept_seo, 'specialist', 4, null, null, 9, 'medium'),
    (v_org, v_tmpl_seo, 'خطة الروابط الخلفية',
     v_dept_seo, 'specialist', 5, null, null, 10, 'medium'),
    (v_org, v_tmpl_seo, 'تقرير SEO الشهري',
     v_dept_seo, 'specialist', 1, null, null, 11, 'medium');

  raise notice 'Seeded PDF-aligned task templates for org %', v_org;
end$do$;
